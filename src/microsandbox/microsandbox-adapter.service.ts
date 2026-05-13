import { Injectable } from '@nestjs/common';
import {
  MiB,
  Sandbox,
  type SandboxHandle,
  Volume,
  type VolumeHandle,
} from 'microsandbox';
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

@Injectable()
export class MicrosandboxAdapterService implements MicrosandboxAdapter {
  constructor(private readonly config: AppConfigService) {}

  async getSandboxHandle(name: string): Promise<SandboxHandle | null> {
    try {
      return await Sandbox.get(name);
    } catch {
      return null;
    }
  }

  async ensureVolume(
    name: string,
    quotaMiB: number,
  ): Promise<Volume | VolumeHandle> {
    try {
      return await Volume.get(name);
    } catch {
      return Volume.builder(name).quota(MiB(quotaMiB)).create();
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
          input.volumeMountPath,
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

    if (input.command && input.command.length > 0) {
      builder.entrypoint(input.command);
    }
    for (const secret of input.secrets) {
      builder.secret((entry: SecretBuilder) => this.applySecret(entry, secret));
    }
    if (input.workingDir) {
      builder.workdir(input.workingDir);
    }
    if (input.volumeName && input.volumeMountPath) {
      await this.ensureVolume(
        input.volumeName,
        Math.max(128, input.diskGiB * 1024),
      );
      builder.volume(
        input.volumeMountPath,
        (mount: { named(name: string): unknown }) =>
          mount.named(input.volumeName as string),
      );
    }

    const sandbox = await builder.createDetached();
    await sandbox.detach();
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

  async start(name: string): Promise<void> {
    const handle = await Sandbox.get(name);
    const sandbox = await handle.startDetached();
    await sandbox.detach();
  }

  async stop(name: string): Promise<void> {
    const handle = await Sandbox.get(name);
    await handle.stop();
  }

  async remove(name: string, volumeName?: string | null): Promise<void> {
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
    if (volumeName) {
      try {
        await Volume.remove(volumeName);
      } catch {
        // Missing volumes are acceptable during idempotent deletion.
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
    volumeMountPath?: string | null,
  ) {
    for (const dir of this.bootstrapDirectories(workingDir, volumeMountPath)) {
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
    volumeMountPath?: string | null,
  ): string[] {
    const dirs = new Set<string>();
    if (workingDir) {
      for (const dir of this.parentDirectories(`${workingDir}/.keep`)) {
        dirs.add(dir);
      }
      dirs.add(pathPosix.normalize(workingDir));
    }
    if (volumeMountPath) {
      for (const dir of this.parentDirectories(`${volumeMountPath}/.keep`)) {
        dirs.add(dir);
      }
      dirs.add(pathPosix.normalize(volumeMountPath));
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
