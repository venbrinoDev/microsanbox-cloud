import { Injectable } from '@nestjs/common';
import { MiB, Sandbox, Image, type SandboxHandle } from 'microsandbox';
import { execFile as execFileCallback } from 'node:child_process';
import { posix as pathPosix } from 'node:path';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
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

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);

@Injectable()
export class MicrosandboxAdapterService implements MicrosandboxAdapter {
  constructor(private readonly config: AppConfigService) {}

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

  async pullImage(reference: string): Promise<{
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
      await execFile(
        process.execPath,
        [this.resolveMicrosandboxCliPath(), 'pull', normalized],
        {
          env: process.env,
        },
      );
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

  async getSandboxHandle(name: string): Promise<SandboxHandle | null> {
    try {
      return await Sandbox.get(name);
    } catch {
      return null;
    }
  }

  async createDetachedRuntime(input: CreateRuntimeInput): Promise<void> {
    const builder = Sandbox.builder(input.sandboxName)
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

    for (const port of input.ports) {
      if (port.protocol === 'udp') {
        builder.portUdp(port.hostPort, port.containerPort);
      } else {
        builder.port(port.hostPort, port.containerPort);
      }
    }

    for (const secret of input.secrets) {
      builder.secret((entry: SecretBuilder) => this.applySecret(entry, secret));
    }
    if (input.workingDir) {
      builder.workdir(input.workingDir);
    }
    for (const mount of input.mounts) {
      builder.volume(
        mount.mountPath,
        (builderInstance: { bind(host: string): { readonly(): unknown } }) => {
          const base = builderInstance.bind(mount.hostPath);
          return mount.readOnly ? base.readonly() : base;
        },
      );
    }

    const sandbox = await builder.createDetached();
    try {
      await this.launchManagedCommand(sandbox, input.command, input.workingDir);
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

  private resolveMicrosandboxCliPath(): string {
    const packageJsonPath = require.resolve('microsandbox/package.json');
    return join(dirname(packageJsonPath), 'bin', 'microsandbox.cjs');
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
    const handle = await this.getSandboxHandle(name);
    if (handle) {
      try {
        await handle.stop();
      } catch {
        // The sandbox may already be stopped or unavailable; removal below is still attempted.
      }
      await this.waitForSandboxStop(name);
      await handle.remove();
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
      if (!status || status === 'stopped' || status === 'draining') {
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

  private async launchManagedCommand(
    sandbox: Sandbox,
    command?: string[] | null,
    workingDir?: string | null,
  ): Promise<void> {
    if (!command || command.length === 0) {
      return;
    }
    const launchScript = this.buildLaunchScript(command, workingDir);
    await sandbox.exec('sh', ['-lc', launchScript]);
  }

  private buildLaunchScript(
    command: string[],
    workingDir?: string | null,
  ): string {
    const steps: string[] = [];
    if (workingDir?.trim()) {
      steps.push(`cd ${this.shellEscape(workingDir.trim())}`);
    }
    steps.push(
      `${this.toShellCommand(command)} >/tmp/microsandbox-app.log 2>&1 &`,
    );
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
