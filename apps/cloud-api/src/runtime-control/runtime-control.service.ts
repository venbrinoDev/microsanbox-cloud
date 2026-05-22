import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service.js';
import { WinstonLoggerService } from '../logger/winston-logger.service.js';
import {
  RuntimeEntity,
  type RuntimePortBindingRecord,
  type RuntimeSecretRecord,
  type RuntimeVolumeMountRecord,
} from '../database/runtime.entity.js';
import { VolumeEntity } from '../database/volume.entity.js';
import {
  MICROSANDBOX_ADAPTER,
  type CreateRuntimeInput,
  type MicrosandboxAdapter,
  type RuntimeRegistryAuthInput,
} from '../microsandbox/microsandbox-adapter.interface.js';
import { RuntimeRegistryService } from '../runtime-registry/runtime-registry.service.js';
import {
  CreateSandboxDto,
  EnsureRuntimeDto,
  type RuntimeFileDto,
  type RuntimePortDto,
  type RuntimeResourcesDto,
  type RuntimeSecretDto,
  type RuntimeVolumeMountDto,
  UpdateSandboxDto,
} from './dto/ensure-runtime.dto.js';

type RuntimeSpec = {
  image: string;
  registryAuth: RuntimeRegistryAuthInput | null;
  command: string[] | null;
  env: Record<string, string>;
  files: RuntimeFileDto[];
  secrets: RuntimeSecretRecord[];
  workingDir: string | null;
  ports: RuntimePortBindingRecord[];
  mounts: RuntimeVolumeMountRecord[];
  mountInputs: CreateRuntimeInput['mounts'];
  resources: Required<RuntimeResourcesDto>;
  public: boolean;
  autoStopMinutes: number | null;
  ephemeral: boolean;
};

type RuntimeSummary = Record<string, unknown>;

type RuntimeRegistryAuthLike = {
  server: string;
  username: string;
  password: string;
};

@Injectable()
export class RuntimeControlService {
  constructor(
    private readonly config: AppConfigService,
    private readonly registry: RuntimeRegistryService,
    private readonly logger: WinstonLoggerService,
    @Inject(MICROSANDBOX_ADAPTER)
    private readonly microsandbox: MicrosandboxAdapter,
  ) {}

  async create(input: CreateSandboxDto): Promise<RuntimeSummary> {
    const name = this.registry.normalizeName(input.name);
    if (name) {
      const existing = await this.registry.findRuntimeBySandboxIdOrName(name);
      if (existing) {
        throw new ConflictException(`Sandbox name already exists: ${name}`);
      }
    }
    const sandboxId = this.registry.createSandboxId(name);
    this.logger.log(
      `Creating sandbox: sandboxId=${sandboxId}, image=${input.image || this.config.defaultImage}`,
    );
    return this.provision({
      ...input,
      sandboxId,
      forceRecreate: false,
      refreshActivity: true,
    });
  }

  async ensure(input: EnsureRuntimeDto): Promise<RuntimeSummary> {
    const sandboxId = this.registry.createSandboxId(
      input.sandboxId ?? input.name ?? undefined,
    );
    return this.provision({ ...input, sandboxId });
  }

  async update(
    sandboxId: string,
    input: UpdateSandboxDto,
  ): Promise<RuntimeSummary> {
    const runtime = await this.registry.findRuntimeBySandboxId(sandboxId);
    if (!runtime) {
      throw new NotFoundException(`Sandbox not found: ${sandboxId}`);
    }
    return this.provision(this.buildUpdateInput(runtime, input));
  }

  async list(): Promise<RuntimeSummary> {
    const sandboxes = await this.registry.listRuntimes();
    return {
      sandboxes: sandboxes.map((runtime) =>
        this.registry.runtimeStatusSummary(runtime),
      ),
    };
  }

  async get(sandboxIdOrName: string): Promise<RuntimeSummary> {
    const runtime = await this.requireRuntime(sandboxIdOrName);
    return this.registry.runtimeStatusSummary(await this.syncStatus(runtime));
  }

  async start(sandboxIdOrName: string): Promise<RuntimeSummary> {
    let runtime = await this.requireRuntime(sandboxIdOrName);
    this.logger.log(
      `Starting sandbox: sandboxId=${runtime.sandboxId}, sandboxName=${runtime.sandboxName}`,
    );
    await this.microsandbox.start(
      runtime.sandboxName,
      runtime.command,
      runtime.workingDir,
    );
    runtime = await this.registry.setRuntimeStatus(
      runtime,
      'running',
      'manual:start',
    );
    return this.registry.runtimeStatusSummary(runtime);
  }

  async stop(sandboxIdOrName: string): Promise<RuntimeSummary> {
    let runtime = await this.requireRuntime(sandboxIdOrName);
    this.logger.log(
      `Stopping sandbox: sandboxId=${runtime.sandboxId}, sandboxName=${runtime.sandboxName}`,
    );
    await this.microsandbox.stop(runtime.sandboxName);
    runtime = await this.registry.setRuntimeStatus(
      runtime,
      'stopped',
      'manual:stop',
    );
    return this.registry.runtimeStatusSummary(runtime);
  }

  async delete(sandboxIdOrName: string): Promise<RuntimeSummary> {
    const runtime = await this.requireRuntime(sandboxIdOrName);
    this.logger.log(
      `Deleting sandbox: sandboxId=${runtime.sandboxId}, sandboxName=${runtime.sandboxName}`,
    );
    await this.registry.setRuntimeStatus(
      runtime,
      'deleting',
      'delete_requested',
    );
    await this.microsandbox.remove(runtime.sandboxName);
    await this.registry.releasePorts(runtime.id);
    await this.registry.deleteRuntime(runtime);
    return { sandboxId: runtime.sandboxId, deleted: true };
  }

  async createVolume(input: {
    name: string;
    quotaMiB?: number;
  }): Promise<RuntimeSummary> {
    const name = this.registry.normalizeName(input.name);
    if (!name) {
      throw new ConflictException('Volume name is required');
    }
    const existing = await this.registry.findVolumeByIdOrName(name);
    if (existing) {
      throw new ConflictException(`Volume name already exists: ${name}`);
    }
    const volume = await this.registry.saveVolume({
      name,
      backendName: this.registry.volumeBackendName(
        this.registry.createSandboxId(name),
      ),
      quotaMiB: input.quotaMiB ?? null,
    });
    try {
      await this.microsandbox.ensureVolume(volume.backendName, volume.quotaMiB);
    } catch (error) {
      await this.registry.deleteVolume(volume).catch(() => undefined);
      throw error;
    }
    return this.volumeSummary(volume);
  }

  async listVolumes(): Promise<RuntimeSummary> {
    const volumes = await this.registry.listVolumes();
    return { volumes: volumes.map((volume) => this.volumeSummary(volume)) };
  }

  async listImages(): Promise<RuntimeSummary> {
    const images = await this.microsandbox.listCachedImages();
    return { images };
  }

  async pullImage(
    reference: string,
    registryAuth?: CreateRuntimeInput['registryAuth'],
  ): Promise<RuntimeSummary> {
    if (!String(reference ?? '').trim()) {
      throw new BadRequestException('Image reference is required');
    }
    const image = await this.microsandbox.pullImage(reference, registryAuth);
    return image;
  }

  async getVolume(volumeIdOrName: string): Promise<RuntimeSummary> {
    const volume = await this.requireVolume(volumeIdOrName);
    return this.volumeSummary(volume);
  }

  async deleteVolume(volumeIdOrName: string): Promise<RuntimeSummary> {
    const volume = await this.requireVolume(volumeIdOrName);
    await this.microsandbox.removeVolume(volume.backendName);
    await this.registry.deleteVolume(volume);
    return { volumeId: volume.id, deleted: true };
  }

  async getPreviewUrl(
    sandboxIdOrName: string,
    port: number,
  ): Promise<RuntimeSummary> {
    const runtime = await this.ensurePreviewable(sandboxIdOrName, port);
    const baseUrl = this.config.proxyBaseUrl.replace(/\/+$/g, '');
    return {
      sandboxId: runtime.sandboxId,
      port,
      url: `${baseUrl}/proxy/${encodeURIComponent(runtime.sandboxId)}/ports/${port}`,
      token: runtime.authToken,
      headerName: 'x-microsandbox-preview-token',
      expiresAt: null,
    };
  }

  async getSignedPreviewUrl(
    sandboxIdOrName: string,
    port: number,
  ): Promise<RuntimeSummary> {
    const runtime = await this.ensurePreviewable(sandboxIdOrName, port);
    const tokenRecord = await this.registry.createSignedPreviewToken(
      runtime.sandboxId,
      port,
      this.config.connectionTtlSeconds,
    );
    const baseUrl = this.config.proxyBaseUrl.replace(/\/+$/g, '');
    return {
      sandboxId: runtime.sandboxId,
      port,
      token: tokenRecord.token,
      url: `${baseUrl}/proxy/signed/${encodeURIComponent(tokenRecord.token)}/ports/${port}`,
      expiresAt: tokenRecord.expiresAt.toISOString(),
    };
  }

  async expireSignedPreviewUrl(
    sandboxIdOrName: string,
    port: number,
    token: string,
  ): Promise<RuntimeSummary> {
    const runtime = await this.requireRuntime(sandboxIdOrName);
    const record = await this.registry.getSignedPreviewToken(token, port);
    if (!record || record.sandboxId !== runtime.sandboxId) {
      throw new NotFoundException('Signed preview token not found');
    }
    await this.registry.expireSignedPreviewToken(token, port);
    return { sandboxId: runtime.sandboxId, port, token, expired: true };
  }

  async getPreviewPublicState(sandboxId: string): Promise<RuntimeSummary> {
    const runtime = await this.requireRuntime(sandboxId);
    return { sandboxId: runtime.sandboxId, public: runtime.public };
  }

  async validatePreviewToken(
    sandboxId: string,
    token: string,
  ): Promise<RuntimeSummary> {
    const runtime = await this.requireRuntime(sandboxId);
    if (!this.tokensEqual(runtime.authToken, token)) {
      throw new UnauthorizedException('Invalid preview token');
    }
    return { sandboxId: runtime.sandboxId, valid: true };
  }

  async resolveSignedPreviewToken(
    token: string,
    port: number,
  ): Promise<RuntimeSummary> {
    const record = await this.registry.getSignedPreviewToken(token, port);
    if (!record || this.registry.hasSignedPreviewTokenExpired(record)) {
      if (record) {
        await this.registry.expireSignedPreviewToken(token, port);
      }
      throw new NotFoundException('Signed preview token not found');
    }
    return { sandboxId: record.sandboxId, port };
  }

  async exec(
    sandboxIdOrName: string,
    command: string,
    args: string[] = [],
  ): Promise<RuntimeSummary> {
    const runtime = await this.requireRunningRuntime(sandboxIdOrName);
    this.logger.log(
      `Exec in sandbox: sandboxId=${runtime.sandboxId}, command=${command}${args.length ? ` args=[${args.join(',')}]` : ''}`,
    );
    const result = await this.microsandbox.exec(
      runtime.sandboxName,
      command,
      args,
    );
    await this.registry.updateRuntime(runtime, { lastActiveAt: new Date() });
    return {
      sandboxId: runtime.sandboxId,
      sandboxName: runtime.sandboxName,
      ...result,
    };
  }

  async writeFiles(
    sandboxIdOrName: string,
    files: RuntimeFileDto[],
  ): Promise<RuntimeSummary> {
    const runtime = await this.requireRunningRuntime(sandboxIdOrName);
    await this.microsandbox.writeFiles(
      runtime.sandboxName,
      this.buildRuntimeFiles(files),
    );
    await this.registry.updateRuntime(runtime, { lastActiveAt: new Date() });
    return this.registry.runtimeStatusSummary(runtime);
  }

  async downloadFiles(
    sandboxIdOrName: string,
    paths: string[],
  ): Promise<Record<string, unknown>> {
    const runtime = await this.requireRunningRuntime(sandboxIdOrName);
    const files = await this.microsandbox.readFiles(runtime.sandboxName, paths);
    await this.registry.updateRuntime(runtime, { lastActiveAt: new Date() });
    return {
      sandboxId: runtime.sandboxId,
      files,
    };
  }

  async validateProxyAccessBySandbox(
    sandboxId: string,
    port: number,
    token?: string | null,
  ): Promise<{ runtime: RuntimeEntity; hostPort: number }> {
    const runtime = await this.requireRuntime(sandboxId);
    if (!runtime.public) {
      if (!token || !this.tokensEqual(runtime.authToken, token)) {
        throw new UnauthorizedException('Missing or invalid preview token');
      }
    }
    return this.resolveProxyTarget(runtime, port);
  }

  async validateProxyAccessBySignedToken(
    token: string,
    port: number,
  ): Promise<{ runtime: RuntimeEntity; hostPort: number }> {
    const resolved = await this.resolveSignedPreviewToken(token, port);
    const runtime = await this.requireRuntime(String(resolved.sandboxId));
    return this.resolveProxyTarget(runtime, port);
  }

  private async provision(input: EnsureRuntimeDto): Promise<RuntimeSummary> {
    const name = this.registry.normalizeName(input.name);
    if (name) {
      const existingByName =
        await this.registry.findRuntimeBySandboxIdOrName(name);
      if (existingByName && existingByName.sandboxId !== input.sandboxId) {
        throw new ConflictException(`Sandbox name already exists: ${name}`);
      }
    }

    let runtime = await this.registry.findRuntimeBySandboxId(input.sandboxId!);
    const spec = await this.buildSpec(input);
    const initialPrimaryPort = this.firstPortBinding(spec.ports);
    const shouldReplace =
      runtime !== null &&
      (input.forceRecreate === true ||
        this.requiresRecreate(runtime, spec, name));

    if (runtime && !shouldReplace) {
      const currentRuntime = runtime;
      const currentStatus = await this.microsandbox.getStatus(
        currentRuntime.sandboxName,
      );
      const primaryHostPort =
        currentRuntime.portBindings?.find(
          (binding) => binding.containerPort === currentRuntime.primaryPort,
        )?.hostPort ?? currentRuntime.hostPort;
      if (
        currentStatus === 'running' &&
        (await this.microsandbox.isHealthy(primaryHostPort))
      ) {
        if (spec.files.length > 0) {
          await this.microsandbox.writeFiles(
            currentRuntime.sandboxName,
            spec.files,
          );
        }
        runtime = await this.registry.updateRuntime(currentRuntime, {
          name,
          status: 'running',
          statusReason:
            spec.files.length > 0
              ? 'config_synced_existing'
              : currentRuntime.statusReason,
          lastActiveAt:
            input.refreshActivity === false
              ? currentRuntime.lastActiveAt
              : new Date(),
        });
        return this.registry.runtimeStatusSummary(runtime);
      }
    }

    if (runtime && shouldReplace) {
      runtime = await this.registry.updateRuntime(runtime, {
        name,
        status: 'provisioning',
        statusReason:
          input.forceRecreate === true
            ? 'replacing_forced'
            : 'replacing_spec_changed',
        image: spec.image,
        command: spec.command,
        environment: spec.env,
        secrets: spec.secrets,
        workingDir: spec.workingDir,
        mounts: spec.mounts,
        cpu: spec.resources.cpu,
        memoryMiB: spec.resources.memoryMiB,
        diskGiB: spec.resources.diskGiB,
        autoStopMinutes: spec.autoStopMinutes,
        ephemeral: spec.ephemeral,
      });
    }

    if (!runtime) {
      const sandboxId = input.sandboxId!;
      const authToken = randomBytes(24).toString('base64url');
      runtime = await this.registry.saveRuntime({
        sandboxId,
        name,
        sandboxName: this.registry.sandboxName(sandboxId),
        runtimeHostId: this.registry.localHostId,
        portBindings: [],
        primaryPort: initialPrimaryPort.containerPort,
        hostPort: 0,
        primaryPortProtocol: initialPrimaryPort.protocol,
        public: spec.public,
        authToken,
        status: 'provisioning',
        image: spec.image,
        command: spec.command,
        environment: spec.env,
        secrets: spec.secrets,
        workingDir: spec.workingDir,
        mounts: spec.mounts,
        cpu: spec.resources.cpu,
        memoryMiB: spec.resources.memoryMiB,
        diskGiB: spec.resources.diskGiB,
        autoStopMinutes: spec.autoStopMinutes,
        ephemeral: spec.ephemeral,
        lastActiveAt: new Date(),
        statusReason: 'allocating_ports',
      });
      try {
        const leased = await this.registry.leasePorts(
          runtime.id,
          spec.ports.length,
        );
        spec.ports.forEach((port, index) => {
          port.hostPort = leased[index]!;
        });
      } catch (error) {
        await this.registry.deleteRuntime(runtime);
        throw error;
      }
    }

    if ((runtime.portBindings?.length ?? 0) === 0) {
      const leased = await this.registry.leasePorts(
        runtime.id,
        spec.ports.length,
      );
      spec.ports.forEach((port, index) => {
        port.hostPort = leased[index]!;
      });
    } else {
      const existingRuntime = runtime;
      spec.ports = spec.ports.map((port, index) => ({
        ...port,
        hostPort:
          existingRuntime.portBindings[index]?.hostPort ??
          existingRuntime.hostPort,
      }));
    }

    await this.microsandbox.createDetachedRuntime({
      sandboxName: runtime.sandboxName,
      image: spec.image,
      registryAuth: spec.registryAuth,
      command: spec.command,
      workingDir: spec.workingDir,
      ports: spec.ports,
      mounts: spec.mountInputs,
      cpu: spec.resources.cpu,
      memoryMiB: spec.resources.memoryMiB,
      diskGiB: spec.resources.diskGiB,
      env: spec.env,
      secrets: spec.secrets,
      files: spec.files,
    });

    const updatedPrimaryPort = this.firstPortBinding(spec.ports);
    const primaryHostPort = updatedPrimaryPort.hostPort;
    const healthy = await this.waitForHealthy(primaryHostPort);
    if (healthy) {
      this.logger.log(
        `Sandbox healthy: sandboxId=${runtime.sandboxId}, hostPort=${primaryHostPort}`,
      );
    } else {
      this.logger.warn(
        `Sandbox unhealthy: sandboxId=${runtime.sandboxId}, hostPort=${primaryHostPort}`,
      );
    }
    runtime = await this.registry.updateRuntime(runtime, {
      name,
      portBindings: spec.ports,
      primaryPort: updatedPrimaryPort.containerPort,
      hostPort: primaryHostPort,
      primaryPortProtocol: updatedPrimaryPort.protocol,
      public: spec.public,
      status: healthy ? 'running' : 'error',
      statusReason: healthy ? 'provisioned' : 'runtime_unhealthy',
      image: spec.image,
      command: spec.command,
      environment: spec.env,
      secrets: spec.secrets,
      workingDir: spec.workingDir,
      mounts: spec.mounts,
      cpu: spec.resources.cpu,
      memoryMiB: spec.resources.memoryMiB,
      diskGiB: spec.resources.diskGiB,
      autoStopMinutes: spec.autoStopMinutes,
      ephemeral: spec.ephemeral,
      lastActiveAt:
        input.refreshActivity === false ? runtime.lastActiveAt : new Date(),
    });
    return this.registry.runtimeStatusSummary(runtime);
  }

  private async buildSpec(
    input: CreateSandboxDto | EnsureRuntimeDto,
  ): Promise<RuntimeSpec> {
    const files = this.buildRuntimeFiles(input.files ?? []);
    const secrets = this.buildRuntimeSecrets(input.secrets ?? []);
    let ports = this.resolvePorts(input.ports, input.primaryPort);
    const resources = {
      cpu: input.resources?.cpu ?? this.config.defaultCpu,
      memoryMiB: input.resources?.memoryMiB ?? this.config.defaultMemoryMiB,
      diskGiB: input.resources?.diskGiB ?? this.config.defaultDiskGiB,
    };
    const volumes = await this.resolveVolumes(input.volumes ?? []);
    ports = ports.map((port) => ({ ...port, hostPort: 0 }));
    return {
      image: input.image?.trim() || this.config.defaultImage,
      registryAuth: this.normalizeRegistryAuth(input.registryAuth),
      command: input.command?.length ? input.command : null,
      env: input.env ?? {},
      files,
      secrets,
      workingDir: input.workingDir?.trim() || null,
      ports,
      mounts: volumes.mountRecords,
      mountInputs: volumes.mountInputs,
      resources,
      public: input.public === true,
      // Native Microsandbox idle timeout is intentionally disabled for launch.
      // Jovita still sends busy/activity signals, but lifecycle remains manual
      // until platform-side stop/delete policy is wired end-to-end.
      autoStopMinutes: null,
      ephemeral: input.ephemeral === true,
    };
  }

  private buildUpdateInput(
    runtime: RuntimeEntity,
    input: UpdateSandboxDto,
  ): EnsureRuntimeDto {
    return {
      sandboxId: runtime.sandboxId,
      name: input.name ?? runtime.name ?? undefined,
      image: input.image ?? runtime.image,
      command: input.command ?? runtime.command ?? undefined,
      env: input.env ?? runtime.environment ?? {},
      files: input.files ?? [],
      secrets:
        input.secrets ??
        (runtime.secrets ?? []).map((secret) => ({
          env: secret.env,
          value: secret.value,
          placeholder: secret.placeholder,
          allowedHosts: [...(secret.allowedHosts ?? [])],
          allowedHostPatterns: [...(secret.allowedHostPatterns ?? [])],
          allowAnyHostDangerous: secret.allowAnyHostDangerous,
          requireTlsIdentity: secret.requireTlsIdentity,
          injectHeaders: secret.injectHeaders,
          injectBasicAuth: secret.injectBasicAuth,
          injectQuery: secret.injectQuery,
          injectBody: secret.injectBody,
        })),
      workingDir: input.workingDir ?? runtime.workingDir ?? undefined,
      ports:
        input.ports ??
        (runtime.portBindings ?? []).map((binding) => ({
          name: binding.name,
          containerPort: binding.containerPort,
          protocol: binding.protocol,
        })),
      resources: {
        cpu: input.resources?.cpu ?? runtime.cpu,
        memoryMiB: input.resources?.memoryMiB ?? runtime.memoryMiB,
        diskGiB: input.resources?.diskGiB ?? runtime.diskGiB,
      },
      volumes:
        input.volumes ??
        (runtime.mounts ?? []).map((mount) => ({
          volumeId: mount.volumeId,
          mountPath: mount.mountPath,
          readOnly: mount.readOnly,
        })),
      registryAuth: input.registryAuth,
      public: input.public ?? runtime.public,
      autoStopMinutes:
        input.autoStopMinutes ?? runtime.autoStopMinutes ?? undefined,
      ephemeral: input.ephemeral ?? runtime.ephemeral,
      forceRecreate: input.forceRecreate,
      refreshActivity: input.refreshActivity,
    };
  }

  private normalizeRegistryAuth(
    input: RuntimeRegistryAuthLike | null | undefined,
  ): RuntimeRegistryAuthInput | null {
    if (!input) {
      return null;
    }
    const server = String(input.server).trim();
    const username = String(input.username).trim();
    const password = String(input.password);
    if (!server || !username || !password) {
      return null;
    }
    return {
      server,
      username,
      password,
    };
  }

  private async resolveVolumes(volumes: RuntimeVolumeMountDto[]): Promise<{
    mountRecords: RuntimeVolumeMountRecord[];
    mountInputs: CreateRuntimeInput['mounts'];
  }> {
    const mountRecords: RuntimeVolumeMountRecord[] = [];
    const mountInputs: CreateRuntimeInput['mounts'] = [];
    for (const volumeMount of volumes) {
      const volume = await this.requireVolume(volumeMount.volumeId);
      const subpath = volumeMount.subpath?.trim();
      if (subpath) {
        throw new BadRequestException(
          'Volume subpath mounts are not supported with native Microsandbox named volumes. Mount the whole volume and manage subdirectories inside the guest path.',
        );
      }
      mountRecords.push({
        volumeId: volume.id,
        volumeName: volume.name,
        mountPath: volumeMount.mountPath,
        readOnly: volumeMount.readOnly === true,
      });
      mountInputs.push({
        volumeName: volume.backendName,
        mountPath: volumeMount.mountPath,
        readOnly: volumeMount.readOnly === true,
      });
    }
    return { mountRecords, mountInputs };
  }

  private resolvePorts(
    ports?: RuntimePortDto[],
    primaryPort?: RuntimePortDto,
  ): RuntimePortBindingRecord[] {
    const normalized = (
      ports?.length
        ? ports
        : [
            {
              containerPort:
                primaryPort?.containerPort ?? this.config.defaultExposedPort,
              protocol: primaryPort?.protocol ?? ('tcp' as const),
              name: primaryPort?.name,
            },
          ]
    ).map((entry) => ({
      name: entry.name?.trim() || undefined,
      containerPort: entry.containerPort,
      hostPort: 0,
      protocol: entry.protocol ?? 'tcp',
    }));
    return normalized;
  }

  private requiresRecreate(
    runtime: RuntimeEntity,
    next: RuntimeSpec,
    nextName: string | null,
  ): boolean {
    if ((runtime.name ?? null) !== nextName) return true;
    if (runtime.image !== next.image) return true;
    if (
      JSON.stringify(runtime.command ?? []) !==
      JSON.stringify(next.command ?? [])
    )
      return true;
    if (JSON.stringify(runtime.environment ?? {}) !== JSON.stringify(next.env))
      return true;
    if (JSON.stringify(runtime.secrets ?? []) !== JSON.stringify(next.secrets))
      return true;
    if ((runtime.workingDir ?? null) !== next.workingDir) return true;
    if (
      !this.registry.portBindingsEqual(
        runtime.portBindings,
        next.ports.map((port, index) => ({
          ...port,
          hostPort: runtime.portBindings[index]?.hostPort ?? runtime.hostPort,
        })),
      )
    )
      return true;
    if (!this.registry.mountRecordsEqual(runtime.mounts, next.mounts))
      return true;
    if (runtime.public !== next.public) return true;
    if (runtime.cpu !== next.resources.cpu) return true;
    if (runtime.memoryMiB !== next.resources.memoryMiB) return true;
    if (runtime.diskGiB !== next.resources.diskGiB) return true;
    if ((runtime.autoStopMinutes ?? null) !== next.autoStopMinutes) return true;
    if (runtime.ephemeral !== next.ephemeral) return true;
    return false;
  }

  private async requireRuntime(
    sandboxIdOrName: string,
  ): Promise<RuntimeEntity> {
    const runtime =
      await this.registry.findRuntimeBySandboxIdOrName(sandboxIdOrName);
    if (!runtime) {
      throw new NotFoundException(`Sandbox not found: ${sandboxIdOrName}`);
    }
    return runtime;
  }

  private async requireRunningRuntime(
    sandboxIdOrName: string,
  ): Promise<RuntimeEntity> {
    const runtime = await this.syncStatus(
      await this.requireRuntime(sandboxIdOrName),
    );
    if (runtime.status !== 'running') {
      throw new ConflictException(
        `Sandbox is not running: ${runtime.sandboxId}`,
      );
    }
    return runtime;
  }

  private async requireVolume(volumeIdOrName: string): Promise<VolumeEntity> {
    const volume = await this.registry.findVolumeByIdOrName(volumeIdOrName);
    if (!volume) {
      throw new NotFoundException(`Volume not found: ${volumeIdOrName}`);
    }
    return volume;
  }

  private async syncStatus(runtime: RuntimeEntity): Promise<RuntimeEntity> {
    const status = await this.microsandbox.getStatus(runtime.sandboxName);
    const normalized = this.normalizeStatus(status);
    if (normalized !== runtime.status) {
      return this.registry.updateRuntime(runtime, { status: normalized });
    }
    return runtime;
  }

  private normalizeStatus(status: string | null): RuntimeEntity['status'] {
    if (status === 'running') return 'running';
    if (status === 'stopped') return 'stopped';
    if (status === 'draining') return 'draining';
    return 'error';
  }

  private async ensurePreviewable(
    sandboxIdOrName: string,
    port: number,
  ): Promise<RuntimeEntity> {
    const runtime = await this.requireRunningRuntime(sandboxIdOrName);
    this.findBinding(runtime, port);
    return runtime;
  }

  private resolveProxyTarget(
    runtime: RuntimeEntity,
    port: number,
  ): { runtime: RuntimeEntity; hostPort: number } {
    const binding = this.findBinding(runtime, port);
    return { runtime, hostPort: binding.hostPort };
  }

  private findBinding(
    runtime: RuntimeEntity,
    port: number,
  ): RuntimePortBindingRecord {
    const binding = (runtime.portBindings ?? []).find(
      (entry) => entry.containerPort === port,
    );
    if (!binding) {
      throw new NotFoundException(
        `Port ${port} is not exposed for sandbox ${runtime.sandboxId}`,
      );
    }
    return binding;
  }

  private tokensEqual(actual: string, candidate: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const candidateBuffer = Buffer.from(candidate);
    return (
      actualBuffer.length === candidateBuffer.length &&
      timingSafeEqual(actualBuffer, candidateBuffer)
    );
  }

  private buildRuntimeFiles(files: RuntimeFileDto[]): RuntimeFileDto[] {
    return files.map((file) => ({
      path: file.path,
      content: file.content,
    }));
  }

  private buildRuntimeSecrets(
    secrets: RuntimeSecretDto[],
  ): RuntimeSecretRecord[] {
    return secrets.map((secret) => ({
      env: secret.env,
      value: secret.value,
      placeholder: secret.placeholder,
      allowedHosts: secret.allowedHosts ?? [],
      allowedHostPatterns: secret.allowedHostPatterns ?? [],
      allowAnyHostDangerous: secret.allowAnyHostDangerous,
      requireTlsIdentity: secret.requireTlsIdentity,
      injectHeaders: secret.injectHeaders,
      injectBasicAuth: secret.injectBasicAuth,
      injectQuery: secret.injectQuery,
      injectBody: secret.injectBody,
    }));
  }

  private async waitForHealthy(port: number): Promise<boolean> {
    const deadline = Date.now() + this.config.runtimeReadyTimeoutMs;
    do {
      if (await this.microsandbox.isHealthy(port)) {
        return true;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.runtimeReadyPollIntervalMs),
      );
    } while (Date.now() < deadline);
    return false;
  }

  private volumeSummary(volume: VolumeEntity): Record<string, unknown> {
    return {
      volumeId: volume.id,
      name: volume.name,
      quotaMiB: volume.quotaMiB,
      createdAt: volume.createdAt?.toISOString() ?? null,
      updatedAt: volume.updatedAt?.toISOString() ?? null,
    };
  }

  private firstPortBinding(
    ports: RuntimePortBindingRecord[],
  ): RuntimePortBindingRecord {
    const firstPort = ports[0];
    if (!firstPort) {
      throw new ConflictException('At least one port binding is required');
    }
    return firstPort;
  }
}
