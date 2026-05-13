import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { RuntimeEntity } from '../database/runtime.entity.js';
import {
  MICROSANDBOX_ADAPTER,
  type MicrosandboxAdapter,
  type RuntimeSecretInput,
} from '../microsandbox/microsandbox-adapter.interface.js';
import { RuntimeRegistryService } from '../runtime-registry/runtime-registry.service.js';
import {
  EnsureRuntimeDto,
  RuntimeFileDto,
  RuntimePortDto,
  RuntimeSecretDto,
} from './dto/ensure-runtime.dto.js';
import { RuntimeIdentityService } from './runtime-identity.service.js';

@Injectable()
export class RuntimeControlService {
  constructor(
    private readonly config: AppConfigService,
    private readonly registry: RuntimeRegistryService,
    private readonly identity: RuntimeIdentityService,
    @Inject(MICROSANDBOX_ADAPTER)
    private readonly microsandbox: MicrosandboxAdapter,
  ) {}

  async ensure(input: EnsureRuntimeDto): Promise<Record<string, unknown>> {
    const sandboxId = this.identity.normalizeSandboxId(input.sandboxId);
    let runtime = await this.registry.findRuntime(sandboxId);
    const files = this.buildRuntimeFiles(input.files ?? []);
    const secrets = this.buildRuntimeSecrets(input.secrets ?? []);
    const port = this.resolvePort(input.port);
    const nextImage = input.image?.trim() || this.config.defaultImage;
    const nextCommand = input.command?.length ? input.command : null;
    const nextEnv = input.env ?? {};
    const nextWorkingDir = input.workingDir?.trim() || null;
    const nextVolumeMountPath =
      input.persistentVolume === false
        ? null
        : input.volumeMountPath?.trim() || this.config.defaultVolumeMountPath;

    if (
      runtime &&
      (input.forceRecreate ||
        this.requiresRecreate(runtime, {
          image: nextImage,
          command: nextCommand,
          env: nextEnv,
          secrets,
          workingDir: nextWorkingDir,
          containerPort: port.containerPort,
          protocol: port.protocol,
          volumeMountPath: nextVolumeMountPath,
          persistentVolume: input.persistentVolume !== false,
        }))
    ) {
      await this.microsandbox.remove(runtime.sandboxName, runtime.volumeName);
      await this.registry.deleteRuntime(runtime);
      runtime = null;
    }

    if (runtime) {
      const status = await this.microsandbox.getStatus(runtime.sandboxName);
      if (
        status === 'running' &&
        runtime.primaryPort === port.containerPort &&
        (await this.waitForHealthy(runtime.hostPort))
      ) {
        if (files.length > 0) {
          await this.microsandbox.writeFiles(runtime.sandboxName, files);
        }
        if (input.refreshActivity !== false) {
          runtime = await this.registry.updateRuntime(runtime, {
            lastActiveAt: new Date(),
            status: 'running',
            statusReason:
              files.length > 0
                ? 'config_synced_existing'
                : runtime.statusReason,
          });
        }
        return this.registry.runtimeStatusSummary(runtime);
      }

      if (
        status === 'running' ||
        status === 'stopped' ||
        status === 'draining'
      ) {
        runtime = await this.reviveRuntime(runtime, files, status);
        return this.registry.runtimeStatusSummary(runtime);
      }
    }

    if (!runtime) {
      const persistentVolume = input.persistentVolume !== false;
      runtime = await this.registry.saveRuntime({
        sandboxId,
        sandboxName: this.registry.sandboxName(sandboxId),
        volumeName: persistentVolume
          ? this.registry.volumeName(sandboxId)
          : null,
        volumeMountPath: nextVolumeMountPath,
        runtimeHostId: this.registry.localHostId,
        hostPort: 0,
        primaryPort: port.containerPort,
        primaryPortProtocol: port.protocol,
        status: 'provisioning',
        image: nextImage,
        command: nextCommand,
        environment: nextEnv,
        secrets,
        workingDir: nextWorkingDir,
        lastActiveAt: new Date(),
      });
      const hostPort = await this.registry.leasePort(runtime.id);
      runtime = await this.registry.updateRuntime(runtime, { hostPort });
    }

    await this.microsandbox.createDetachedRuntime({
      sandboxName: runtime.sandboxName,
      volumeName: runtime.volumeName,
      volumeMountPath: runtime.volumeMountPath,
      image: nextImage,
      command: nextCommand ?? runtime.command,
      workingDir: nextWorkingDir ?? runtime.workingDir,
      ports: [
        {
          hostPort: runtime.hostPort,
          containerPort: runtime.primaryPort,
          protocol: runtime.primaryPortProtocol,
        },
      ],
      cpu: input.resources?.cpu ?? this.config.defaultCpu,
      memoryMiB: input.resources?.memoryMiB ?? this.config.defaultMemoryMiB,
      diskGiB: input.resources?.diskGiB ?? this.config.defaultDiskGiB,
      env: nextEnv,
      secrets,
      files,
    });

    const healthy = await this.waitForHealthy(runtime.hostPort);
    runtime = await this.registry.updateRuntime(runtime, {
      status: healthy ? 'running' : 'error',
      statusReason: healthy ? 'provisioned' : 'runtime_unhealthy',
      image: nextImage,
      command: nextCommand ?? runtime.command,
      environment: nextEnv,
      secrets,
      workingDir: nextWorkingDir ?? runtime.workingDir,
      lastActiveAt: new Date(),
    });
    return this.registry.runtimeStatusSummary(runtime);
  }

  async get(sandboxId: string): Promise<Record<string, unknown>> {
    let runtime = await this.requireRuntime(sandboxId);
    const status = await this.microsandbox.getStatus(runtime.sandboxName);
    if (status && status !== runtime.status) {
      runtime = await this.registry.updateRuntime(runtime, {
        status: this.normalizeStatus(status),
      });
    }
    return this.registry.runtimeStatusSummary(runtime);
  }

  async power(
    sandboxId: string,
    action: 'start' | 'stop',
  ): Promise<Record<string, unknown>> {
    let runtime = await this.requireRuntime(sandboxId);
    if (action === 'start') {
      await this.microsandbox.start(runtime.sandboxName);
      runtime = await this.registry.setRuntimeStatus(
        runtime,
        'running',
        'manual:start',
      );
    } else {
      await this.microsandbox.stop(runtime.sandboxName);
      runtime = await this.registry.setRuntimeStatus(
        runtime,
        'stopped',
        'manual:stop',
      );
    }
    return this.registry.runtimeStatusSummary(runtime);
  }

  async delete(sandboxId: string): Promise<Record<string, unknown>> {
    const runtime = await this.requireRuntime(sandboxId);
    await this.registry.setRuntimeStatus(
      runtime,
      'deleting',
      'delete_requested',
    );
    await this.microsandbox.remove(runtime.sandboxName, runtime.volumeName);
    await this.registry.deleteRuntime(runtime);
    return {
      sandboxId: runtime.sandboxId,
      deleted: true,
    };
  }

  async exec(
    sandboxId: string,
    command: string,
    args: string[] = [],
  ): Promise<Record<string, unknown>> {
    const runtime = await this.requireRuntime(sandboxId);
    const result = await this.microsandbox.exec(
      runtime.sandboxName,
      command,
      args,
    );
    await this.registry.updateRuntime(runtime, {
      lastActiveAt: new Date(),
      status: 'running',
    });
    return {
      sandboxId: runtime.sandboxId,
      sandboxName: runtime.sandboxName,
      ...result,
    };
  }

  async refreshActivity(sandboxId: string): Promise<Record<string, unknown>> {
    const runtime = await this.requireRuntime(sandboxId);
    await this.registry.updateRuntime(runtime, { lastActiveAt: new Date() });
    return this.registry.runtimeStatusSummary(runtime);
  }

  async writeFiles(
    sandboxId: string,
    files: RuntimeFileDto[],
  ): Promise<Record<string, unknown>> {
    const runtime = await this.requireRuntime(sandboxId);
    await this.microsandbox.writeFiles(
      runtime.sandboxName,
      this.buildRuntimeFiles(files),
    );
    await this.registry.updateRuntime(runtime, { lastActiveAt: new Date() });
    return this.registry.runtimeStatusSummary(runtime);
  }

  async connection(sandboxId: string): Promise<RuntimeEntity> {
    const runtime = await this.requireRuntime(sandboxId);
    return this.ensureConnectable(runtime);
  }

  private async requireRuntime(sandboxId: string): Promise<RuntimeEntity> {
    const normalizedSandboxId = this.identity.normalizeSandboxId(sandboxId);
    const runtime = await this.registry.findRuntime(normalizedSandboxId);
    if (!runtime) {
      throw new NotFoundException(
        `Runtime not found for sandboxId=${normalizedSandboxId}`,
      );
    }
    return runtime;
  }

  private async ensureConnectable(
    runtime: RuntimeEntity,
  ): Promise<RuntimeEntity> {
    const status = await this.microsandbox.getStatus(runtime.sandboxName);
    if (status === 'running' && (await this.waitForHealthy(runtime.hostPort))) {
      if (runtime.status !== 'running') {
        return this.registry.setRuntimeStatus(runtime, 'running', 'healthy');
      }
      return runtime;
    }

    if (status === 'running' || status === 'stopped' || status === 'draining') {
      return this.reviveRuntime(runtime, [], status);
    }

    if (status === null) {
      await this.registry.setRuntimeStatus(runtime, 'error', 'sandbox_missing');
      throw new ServiceUnavailableException(
        `Runtime sandbox missing for sandboxId=${runtime.sandboxId}`,
      );
    }

    await this.registry.setRuntimeStatus(
      runtime,
      'error',
      `runtime_unavailable:${status}`,
    );
    throw new ServiceUnavailableException(
      `Runtime is unavailable for sandboxId=${runtime.sandboxId}`,
    );
  }

  private async reviveRuntime(
    runtime: RuntimeEntity,
    files: RuntimeFileDto[],
    status: string,
  ): Promise<RuntimeEntity> {
    if (status === 'running') {
      await this.microsandbox.stop(runtime.sandboxName).catch(() => undefined);
    }
    await this.microsandbox.start(runtime.sandboxName);
    if (files.length > 0) {
      await this.microsandbox.writeFiles(runtime.sandboxName, files);
    }
    const healthy = await this.waitForHealthy(runtime.hostPort);
    if (!healthy) {
      return this.registry.setRuntimeStatus(
        runtime,
        'error',
        'runtime_unhealthy_after_restart',
      );
    }
    return this.registry.updateRuntime(runtime, {
      status: 'running',
      statusReason: 'restarted',
      lastActiveAt: new Date(),
    });
  }

  private async waitForHealthy(hostPort: number): Promise<boolean> {
    const deadline = Date.now() + this.config.runtimeReadyTimeoutMs;
    do {
      if (await this.microsandbox.isHealthy(hostPort)) {
        return true;
      }
      await this.delay(this.config.runtimeReadyPollIntervalMs);
    } while (Date.now() < deadline);
    return false;
  }

  private resolvePort(port?: RuntimePortDto): {
    containerPort: number;
    protocol: 'tcp' | 'udp';
  } {
    return {
      containerPort: port?.containerPort ?? this.config.defaultExposedPort,
      protocol: port?.protocol ?? 'tcp',
    };
  }

  private buildRuntimeFiles(files: RuntimeFileDto[]): RuntimeFileDto[] {
    return files
      .map((file) => ({
        path: String(file.path ?? '').trim(),
        content: String(file.content ?? ''),
      }))
      .filter((file) => file.path.length > 0);
  }

  private buildRuntimeSecrets(
    secrets: RuntimeSecretDto[],
  ): RuntimeSecretInput[] {
    return secrets
      .map((secret) => ({
        env: String(secret.env ?? '').trim(),
        value: String(secret.value ?? ''),
        placeholder: String(secret.placeholder ?? '').trim() || undefined,
        allowedHosts: (secret.allowedHosts ?? [])
          .map((host) => String(host ?? '').trim())
          .filter((host) => host.length > 0),
        allowedHostPatterns: (secret.allowedHostPatterns ?? [])
          .map((pattern) => String(pattern ?? '').trim())
          .filter((pattern) => pattern.length > 0),
        allowAnyHostDangerous: secret.allowAnyHostDangerous === true,
        requireTlsIdentity: secret.requireTlsIdentity,
        injectHeaders: secret.injectHeaders,
        injectBasicAuth: secret.injectBasicAuth,
        injectQuery: secret.injectQuery,
        injectBody: secret.injectBody,
      }))
      .filter((secret) => secret.env.length > 0 && secret.value.length > 0);
  }

  private normalizeStatus(status: string): RuntimeEntity['status'] {
    if (status === 'running') return 'running';
    if (status === 'stopped') return 'stopped';
    if (status === 'draining') return 'draining';
    if (status === 'crashed') return 'error';
    return 'error';
  }

  private requiresRecreate(
    runtime: RuntimeEntity,
    next: {
      image: string;
      command: string[] | null;
      env: Record<string, string>;
      secrets: RuntimeSecretInput[];
      workingDir: string | null;
      containerPort: number;
      protocol: 'tcp' | 'udp';
      volumeMountPath: string | null;
      persistentVolume: boolean;
    },
  ): boolean {
    if (runtime.image !== next.image) return true;
    if (!this.stringArrayEquals(runtime.command ?? null, next.command))
      return true;
    if (
      this.stableStringify(runtime.environment ?? {}) !==
      this.stableStringify(next.env)
    ) {
      return true;
    }
    if (
      this.stableStringify(runtime.secrets ?? []) !==
      this.stableStringify(next.secrets)
    ) {
      return true;
    }
    if ((runtime.workingDir ?? null) !== next.workingDir) return true;
    if (runtime.primaryPort !== next.containerPort) return true;
    if ((runtime.primaryPortProtocol ?? 'tcp') !== next.protocol) return true;
    if (Boolean(runtime.volumeName) !== next.persistentVolume) return true;
    if ((runtime.volumeMountPath ?? null) !== next.volumeMountPath) return true;
    return false;
  }

  private stringArrayEquals(
    left: string[] | null,
    right: string[] | null,
  ): boolean {
    if (!left && !right) return true;
    if (!left || !right) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.toStableValue(value));
  }

  private toStableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.toStableValue(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = this.toStableValue(record[key]);
    }
    return out;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
