import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { WinstonLoggerService } from '../logger/winston-logger.service.js';
import { SshService } from '../ssh/ssh.service.js';
import {
  MiB,
  Sandbox,
  Image,
  Volume,
  VolumeBuilder,
  isInstalled,
  type Sandbox as MicrosandboxRuntime,
  type SandboxHandle,
} from 'microsandbox';
import { spawn } from 'node:child_process';
import { posix as pathPosix } from 'node:path';
import { AppConfigService } from '../config/app-config.service.js';
import { RuntimeFileDto } from '../runtime-control/dto/ensure-runtime.dto.js';
import type {
  CreateRuntimeInput,
  MicrosandboxAdapter,
  RuntimeSecretInput,
} from './microsandbox-adapter.interface.js';

type BootstrapPatchBuilder = {
  mkdir(
    path: string,
    opts?: {
      mode?: number;
    },
  ): BootstrapPatchBuilder;
  text(
    path: string,
    content: string,
    opts?: {
      mode?: number;
      replace?: boolean;
    },
  ): BootstrapPatchBuilder;
};

type SecretBuilder = {
  env(value: string): SecretBuilder;
  value(value: string): SecretBuilder;
  placeholder(value: string): SecretBuilder;
  allowHost(value: string): SecretBuilder;
  allowHostPattern(value: string): SecretBuilder;
  allowAnyHostDangerous(value: boolean): SecretBuilder;
  requireTlsIdentity(value: boolean): SecretBuilder;
  injectHeaders(value: boolean): SecretBuilder;
  injectBasicAuth(value: boolean): SecretBuilder;
  injectQuery(value: boolean): SecretBuilder;
  injectBody(value: boolean): SecretBuilder;
};

type RegistryConfigBuilderLike = {
  auth(auth: {
    kind: string;
    username: string;
    password: string;
  }): RegistryConfigBuilderLike;
};

type BoundVolumeHandleLike = {
  readonly(): unknown;
};

type VolumeBinderLike = {
  bind(host: string): BoundVolumeHandleLike;
  named(name: string): BoundVolumeHandleLike;
};

type SandboxBuilderLike = {
  replace(): SandboxBuilderLike;
  image(value: string): SandboxBuilderLike;
  cpus(value: number): SandboxBuilderLike;
  memory(value: unknown): SandboxBuilderLike;
  patch(
    callback: (patch: BootstrapPatchBuilder) => BootstrapPatchBuilder,
  ): SandboxBuilderLike;
  envs(values: Record<string, string>): SandboxBuilderLike;
  registry(
    callback: (
      registry: RegistryConfigBuilderLike,
    ) => RegistryConfigBuilderLike,
  ): SandboxBuilderLike;
  port(hostPort: number, containerPort: number): SandboxBuilderLike;
  portUdp(hostPort: number, containerPort: number): SandboxBuilderLike;
  secret(callback: (entry: SecretBuilder) => SecretBuilder): SandboxBuilderLike;
  workdir(value: string): SandboxBuilderLike;
  volume(
    mountPath: string,
    callback: (builderInstance: VolumeBinderLike) => unknown,
  ): SandboxBuilderLike;
  createDetached(): Promise<MicrosandboxRuntime>;
};

@Injectable()
export class MicrosandboxAdapterService implements MicrosandboxAdapter {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: WinstonLoggerService,
    private readonly sshService: SshService,
  ) {}

  async listCachedImages(): Promise<
    Array<{
      reference: string;
      architecture: string | null;
      os: string | null;
      sizeBytes: number | null;
      layerCount: number;
    }>
  > {
    const images = await Image.list();
    return images.map((image) => ({
      reference: image.reference,
      architecture: image.architecture,
      os: image.os,
      sizeBytes: image.sizeBytes,
      layerCount: image.layerCount,
    }));
  }

  async pullImage(
    reference: string,
    registryAuth?: {
      server: string;
      username: string;
      password: string;
    } | null,
  ): Promise<{
    reference: string;
    architecture: string | null;
    os: string | null;
    sizeBytes: number | null;
    layerCount: number;
    cached: boolean;
  }> {
    const normalized = String(reference ?? '').trim();
    if (!normalized) {
      throw new Error('Image reference is required');
    }

    try {
      const cached = await Image.get(normalized);
      return {
        reference: cached.reference,
        architecture: cached.architecture,
        os: cached.os,
        sizeBytes: cached.sizeBytes,
        layerCount: cached.layerCount,
        cached: true,
      };
    } catch {
      this.ensureMicrosandboxRuntimeInstalled();
      try {
        await this.runMicrosandboxCli(['pull', normalized]);
      } catch (anonymousError) {
        if (!registryAuth) {
          throw anonymousError;
        }
        await this.loginRegistry(registryAuth);
        try {
          await this.runMicrosandboxCli(['pull', normalized]);
        } finally {
          await this.logoutRegistry(registryAuth.server).catch(() => {
            // Best effort only; a failed logout must not mask the pull result.
          });
        }
      }
      const pulled = await Image.get(normalized);
      return {
        reference: pulled.reference,
        architecture: pulled.architecture,
        os: pulled.os,
        sizeBytes: pulled.sizeBytes,
        layerCount: pulled.layerCount,
        cached: false,
      };
    }
  }

  async ensureVolume(name: string, quotaMiB?: number | null): Promise<void> {
    try {
      await Volume.get(name);
      return;
    } catch {
      const builder = new VolumeBuilder(name);
      if (
        typeof quotaMiB === 'number' &&
        Number.isFinite(quotaMiB) &&
        quotaMiB > 0
      ) {
        builder.quota(Math.trunc(quotaMiB));
      }
      await builder.create();
    }
  }

  async removeVolume(name: string): Promise<void> {
    try {
      await Volume.remove(name);
    } catch {
      // Ignore missing or already-removed volumes.
    }
  }

  async getSandboxHandle(name: string): Promise<SandboxHandle | null> {
    try {
      return await Sandbox.get(name);
    } catch {
      return null;
    }
  }

  async createDetachedRuntime(input: CreateRuntimeInput): Promise<void> {
    this.logger.log(
      `Creating detached runtime: sandboxName=${input.sandboxName}, image=${input.image}`,
    );
    const builder = Sandbox.builder(
      input.sandboxName,
    ) as unknown as SandboxBuilderLike;
    const configuredBuilder = builder
      .replace()
      .image(input.image)
      .cpus(input.cpu)
      .memory(MiB(input.memoryMiB))
      .patch((patch: BootstrapPatchBuilder) =>
        this.buildBootstrapPatch(
          patch,
          input.files,
          input.workingDir,
          input.mounts,
        ),
      )
      .envs({
        ...input.env,
      });

    const registryAuth = input.registryAuth;
    if (registryAuth) {
      configuredBuilder.registry((registry: RegistryConfigBuilderLike) =>
        registry.auth({
          kind: 'basic',
          username: registryAuth.username,
          password: registryAuth.password,
        }),
      );
    }

    for (const port of input.ports) {
      if (port.protocol === 'udp') {
        configuredBuilder.portUdp(port.hostPort, port.containerPort);
      } else {
        configuredBuilder.port(port.hostPort, port.containerPort);
      }
    }

    for (const secret of input.secrets) {
      configuredBuilder.secret((entry: SecretBuilder) =>
        this.applySecret(entry, secret),
      );
    }
    if (input.workingDir) {
      configuredBuilder.workdir(input.workingDir);
    }
    for (const mount of input.mounts) {
      configuredBuilder.volume(
        mount.mountPath,
        (builderInstance: VolumeBinderLike) => {
          const base = builderInstance.named(mount.volumeName);
          return mount.readOnly ? base.readonly() : base;
        },
      );
    }

    const sandbox = await configuredBuilder.createDetached();
    try {
      if (input.ssh?.enabled) {
        await this.injectSshBinary(sandbox, input.ssh);
      }
      await this.launchManagedCommand(
        sandbox,
        input.command,
        input.workingDir,
        input.ssh,
      );
    } finally {
      await sandbox.detach();
    }
  }

  private applySecret(
    builder: SecretBuilder,
    secret: RuntimeSecretInput,
  ): SecretBuilder {
    let current = builder.env(secret.env).value(secret.value);
    if (secret.placeholder) {
      current = current.placeholder(secret.placeholder);
    }
    for (const host of secret.allowedHosts) {
      current = current.allowHost(host);
    }
    for (const pattern of secret.allowedHostPatterns) {
      current = current.allowHostPattern(pattern);
    }
    if (secret.allowAnyHostDangerous === true) {
      current = current.allowAnyHostDangerous(true);
    }
    if (typeof secret.requireTlsIdentity === 'boolean') {
      current = current.requireTlsIdentity(secret.requireTlsIdentity);
    }
    if (typeof secret.injectHeaders === 'boolean') {
      current = current.injectHeaders(secret.injectHeaders);
    }
    if (typeof secret.injectBasicAuth === 'boolean') {
      current = current.injectBasicAuth(secret.injectBasicAuth);
    }
    if (typeof secret.injectQuery === 'boolean') {
      current = current.injectQuery(secret.injectQuery);
    }
    if (typeof secret.injectBody === 'boolean') {
      current = current.injectBody(secret.injectBody);
    }
    return current;
  }

  private ensureMicrosandboxRuntimeInstalled(): void {
    if (!isInstalled()) {
      throw new ServiceUnavailableException(
        'Microsandbox runtime is not installed on this host. Install Microsandbox before pulling or provisioning images.',
      );
    }
  }

  private async loginRegistry(registryAuth: {
    server: string;
    username: string;
    password: string;
  }): Promise<void> {
    await this.runMicrosandboxCli(
      [
        'registry',
        'login',
        '--username',
        registryAuth.username,
        '--password-stdin',
        registryAuth.server,
      ],
      registryAuth.password,
    );
  }

  private async logoutRegistry(server: string): Promise<void> {
    await this.runMicrosandboxCli(['registry', 'logout', server]);
  }

  private async runMicrosandboxCli(
    args: string[],
    stdin?: string,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('msb', args, {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(
            new ServiceUnavailableException(
              'Microsandbox CLI is not installed on this host. Install the microsandbox package so image warming can run.',
            ),
          );
          return;
        }
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new ServiceUnavailableException(
            `Microsandbox CLI command failed: ${stderr.trim() || args.join(' ')}`,
          ),
        );
      });

      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
  }

  async start(
    name: string,
    command?: string[] | null,
    workingDir?: string | null,
  ): Promise<void> {
    const handle = await Sandbox.get(name);
    const sandbox = await handle.startDetached();
    try {
      await this.launchManagedCommand(sandbox, command, workingDir);
    } finally {
      await sandbox.detach();
    }
  }

  async stop(name: string): Promise<void> {
    const handle = await Sandbox.get(name);
    await handle.stop();
    await this.waitForSandboxStop(name);
  }

  async remove(name: string): Promise<void> {
    this.logger.log(`Removing sandbox: sandboxName=${name}`);
    const handle = await this.getSandboxHandle(name);
    if (handle) {
      try {
        await handle.stop();
      } catch {
        // The sandbox may already be stopped or unavailable; removal below is still attempted.
      }
      await this.waitForSandboxStop(name);
      try {
        await handle.remove();
      } catch {
        await this.runMicrosandboxCli(['remove', '--force', name]);
      }
    }
  }

  async exec(
    name: string,
    command: string,
    args: string[] = [],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const handle = await Sandbox.get(name);
    const sandbox =
      handle.status === 'running'
        ? await handle.connect()
        : await handle.startDetached();
    try {
      const output = await sandbox.exec(command, args);
      return {
        stdout: output.stdout(),
        stderr: output.stderr(),
        exitCode: output.code ?? 0,
      };
    } finally {
      await sandbox.detach();
    }
  }

  async writeFiles(name: string, files: RuntimeFileDto[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const handle = await Sandbox.get(name);
    const sandbox =
      handle.status === 'running'
        ? await handle.connect()
        : await handle.startDetached();
    try {
      await this.writeFilesToSandbox(sandbox, files);
    } finally {
      await sandbox.detach();
    }
  }

  async readFiles(
    name: string,
    paths: string[],
  ): Promise<Array<{ path: string; content: string }>> {
    if (paths.length === 0) {
      return [];
    }
    const handle = await Sandbox.get(name);
    const sandbox =
      handle.status === 'running'
        ? await handle.connect()
        : await handle.startDetached();
    try {
      const fs = sandbox.fs();
      const results: Array<{ path: string; content: string }> = [];
      for (const filePath of paths) {
        const content = await fs.readToString(filePath);
        results.push({ path: filePath, content });
      }
      return results;
    } finally {
      await sandbox.detach();
    }
  }

  async getStatus(name: string): Promise<string | null> {
    const handle = await this.getSandboxHandle(name);
    return handle?.status ?? null;
  }

  async isHealthy(port: number): Promise<boolean> {
    const { Socket } = await import('node:net');
    return new Promise((resolve) => {
      const socket = new Socket();
      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(this.config.healthcheckTimeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, '127.0.0.1');
    });
  }

  private async waitForSandboxStop(name: string): Promise<void> {
    const deadline = Date.now() + this.config.runtimeReadyTimeoutMs;
    do {
      const status = await this.getStatus(name);
      if (!status || status === 'stopped') {
        return;
      }
      if (Date.now() >= deadline) {
        const handle = await this.getSandboxHandle(name);
        if (handle) {
          await handle.kill().catch(() => undefined);
        }
        return;
      }
      await this.delay(this.config.runtimeReadyPollIntervalMs);
    } while (Date.now() < deadline);
  }

  private async writeFilesToSandbox(
    sandbox: Sandbox,
    files: RuntimeFileDto[],
  ): Promise<void> {
    const fs = sandbox.fs();
    for (const file of files) {
      await this.ensureParentDirs(fs, file.path);
      await fs.write(file.path, file.content);
    }
  }

  private buildBootstrapPatch(
    patch: BootstrapPatchBuilder,
    files: RuntimeFileDto[],
    workingDir?: string | null,
    mounts: Array<{
      mountPath: string;
    }> = [],
  ) {
    for (const dir of this.bootstrapDirectories(workingDir, mounts)) {
      patch.mkdir(dir, { mode: 0o755 });
    }
    for (const file of files) {
      for (const dir of this.parentDirectories(file.path)) {
        patch.mkdir(dir, { mode: 0o755 });
      }
      patch.text(file.path, file.content, { mode: 0o644, replace: true });
    }
    return patch;
  }

  private bootstrapDirectories(
    workingDir?: string | null,
    mounts: Array<{
      mountPath: string;
    }> = [],
  ): string[] {
    const dirs = new Set<string>();
    if (workingDir) {
      for (const dir of this.parentDirectories(`${workingDir}/.keep`)) {
        dirs.add(dir);
      }
      dirs.add(pathPosix.normalize(workingDir));
    }
    for (const mount of mounts) {
      for (const dir of this.parentDirectories(`${mount.mountPath}/.keep`)) {
        dirs.add(dir);
      }
      dirs.add(pathPosix.normalize(mount.mountPath));
    }
    return [...dirs];
  }

  private parentDirectories(filePath: string): string[] {
    const normalized = pathPosix.normalize(filePath);
    const dirs: string[] = [];
    let current = pathPosix.dirname(normalized);
    while (current && current !== '.' && current !== '/') {
      dirs.push(current);
      current = pathPosix.dirname(current);
    }
    return dirs.reverse();
  }

  private async ensureParentDirs(
    fs: Awaited<ReturnType<Sandbox['fs']>>,
    filePath: string,
  ): Promise<void> {
    for (const dir of this.parentDirectories(filePath)) {
      await fs.mkdir(dir).catch(() => undefined);
    }
  }

  private async injectSshBinary(
    sandbox: Sandbox,
    ssh: NonNullable<CreateRuntimeInput['ssh']>,
  ): Promise<void> {
    this.logger.log('Injecting SSH binary into sandbox');

    const binaryContent = this.sshService.readBinary();
    if (binaryContent.length === 0) {
      this.logger.warn('SSH binary not found, skipping injection');
      return;
    }

    const fs = sandbox.fs();
    const userHome = ssh.user === 'root' ? '/root' : `/home/${ssh.user}`;

    await fs.write('/usr/local/sbin/inject-sshd', binaryContent);
    await sandbox.exec('chmod', ['+x', '/usr/local/sbin/inject-sshd']);

    const allKeys = [...ssh.publicKeys];
    const gatewayKey = this.sshService.readGatewayPublicKey();
    if (gatewayKey) {
      allKeys.push(gatewayKey);
    }

    const authKeysContent = this.sshService.buildAuthorizedKeysContent(allKeys);

    await fs.mkdir(`${userHome}/.ssh`).catch(() => undefined);
    await fs.write(`${userHome}/.ssh/authorized_keys`, authKeysContent);

    if (ssh.user !== 'root') {
      await fs.mkdir('/root/.ssh').catch(() => undefined);
      await fs.write('/root/.ssh/authorized_keys', authKeysContent);
    }

    try {
      await sandbox.exec('ssh-keygen', [
        '-t',
        'ed25519',
        '-f',
        '/etc/ssh/host_key',
        '-N',
        '',
      ]);
    } catch {
      this.logger.warn(
        'ssh-keygen not available, inject-sshd will auto-generate host key',
      );
    }
  }

  private async launchManagedCommand(
    sandbox: Sandbox,
    command?: string[] | null,
    workingDir?: string | null,
    ssh?: CreateRuntimeInput['ssh'],
  ): Promise<void> {
    if ((!command || command.length === 0) && !ssh?.enabled) {
      return;
    }
    const launchScript = this.buildLaunchScript(command, workingDir, ssh);
    await sandbox.exec('sh', ['-lc', launchScript]);
  }

  private buildLaunchScript(
    command: string[] | null | undefined,
    workingDir?: string | null,
    ssh?: CreateRuntimeInput['ssh'],
  ): string {
    const steps: string[] = [];

    if (ssh?.enabled) {
      const sshPort = ssh.containerPort || 22;
      const authKeysPath =
        ssh.user === 'root'
          ? '/root/.ssh/authorized_keys'
          : `/home/${ssh.user}/.ssh/authorized_keys`;
      steps.push(
        `SSHD_PORT=${sshPort} SSHD_HOST_KEY=/etc/ssh/host_key SSHD_AUTHORIZED_KEYS=${authKeysPath} /usr/local/sbin/inject-sshd >/dev/null 2>&1 &`,
      );
      steps.push('sleep 0.5');
    }

    if (workingDir?.trim()) {
      steps.push(`cd ${this.shellEscape(workingDir.trim())}`);
    }
    if (command && command.length > 0) {
      steps.push(
        `${this.toShellCommand(command)} >/tmp/microsandbox-app.log 2>&1 &`,
      );
    }
    return steps.join(' && ');
  }

  private toShellCommand(command: string[]): string {
    return command.map((part) => this.shellEscape(part)).join(' ');
  }

  private shellEscape(value: string): string {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
      return value;
    }
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
