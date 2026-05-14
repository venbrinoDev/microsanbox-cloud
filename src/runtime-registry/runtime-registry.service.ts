import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service.js';
import { PortLeaseEntity } from '../database/port-lease.entity.js';
import { RuntimeHostEntity } from '../database/runtime-host.entity.js';
import {
  RuntimeEntity,
  type RuntimePortBindingRecord,
  type RuntimeStatus,
  type RuntimeVolumeMountRecord,
} from '../database/runtime.entity.js';
import { SignedPreviewTokenEntity } from '../database/signed-preview-token.entity.js';
import { VolumeEntity } from '../database/volume.entity.js';
import { RuntimeIdentityService } from '../runtime-control/runtime-identity.service.js';

@Injectable()
export class RuntimeRegistryService implements OnModuleInit {
  readonly localHostId = 'local';

  constructor(
    @InjectRepository(RuntimeHostEntity)
    private readonly hostRepo: Repository<RuntimeHostEntity>,
    @InjectRepository(RuntimeEntity)
    private readonly runtimeRepo: Repository<RuntimeEntity>,
    @InjectRepository(PortLeaseEntity)
    private readonly portLeaseRepo: Repository<PortLeaseEntity>,
    @InjectRepository(VolumeEntity)
    private readonly volumeRepo: Repository<VolumeEntity>,
    @InjectRepository(SignedPreviewTokenEntity)
    private readonly signedPreviewRepo: Repository<SignedPreviewTokenEntity>,
    private readonly config: AppConfigService,
    private readonly identity: RuntimeIdentityService,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.config.managedVolumeRoot, { recursive: true });
    await this.ensureLocalHost();
  }

  async ensureLocalHost(): Promise<RuntimeHostEntity> {
    const existing = await this.hostRepo.findOneBy({ id: this.localHostId });
    const base = {
      id: this.localHostId,
      name: this.config.runtimeHostName,
      baseUrl: this.config.runtimeHostBaseUrl,
      publicBaseUrl: this.config.runtimeHostPublicBaseUrl,
      enabled: true,
      lastSeenAt: new Date(),
    };
    if (existing) {
      Object.assign(existing, base);
      return this.hostRepo.save(existing);
    }
    return this.hostRepo.save(this.hostRepo.create(base));
  }

  async listRuntimes(): Promise<RuntimeEntity[]> {
    return this.runtimeRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findRuntimeBySandboxIdOrName(
    value: string,
  ): Promise<RuntimeEntity | null> {
    const normalized = this.identity.normalizeSandboxId(value);
    return this.runtimeRepo.findOne({
      where: [{ sandboxId: normalized }, { name: normalized }],
    });
  }

  async findRuntimeBySandboxId(
    sandboxId: string,
  ): Promise<RuntimeEntity | null> {
    return this.runtimeRepo.findOneBy({
      sandboxId: this.identity.normalizeSandboxId(sandboxId),
    });
  }

  async saveRuntime(input: Partial<RuntimeEntity>): Promise<RuntimeEntity> {
    return this.runtimeRepo.save(this.runtimeRepo.create(input));
  }

  async updateRuntime(
    runtime: RuntimeEntity,
    patch: Partial<RuntimeEntity>,
  ): Promise<RuntimeEntity> {
    Object.assign(runtime, patch);
    return this.runtimeRepo.save(runtime);
  }

  async deleteRuntime(runtime: RuntimeEntity): Promise<void> {
    await this.runtimeRepo.delete({ id: runtime.id });
    await this.portLeaseRepo.delete({ runtimeId: runtime.id });
    await this.signedPreviewRepo.delete({ sandboxId: runtime.sandboxId });
  }

  async leasePorts(runtimeId: string, count: number): Promise<number[]> {
    const ports: number[] = [];
    for (
      let port = this.config.portRangeStart;
      port <= this.config.portRangeEnd && ports.length < count;
      port += 1
    ) {
      const existing = await this.portLeaseRepo.findOneBy({
        runtimeHostId: this.localHostId,
        port,
      });
      if (existing) {
        continue;
      }
      try {
        await this.portLeaseRepo.save(
          this.portLeaseRepo.create({
            runtimeHostId: this.localHostId,
            port,
            runtimeId,
          }),
        );
        ports.push(port);
      } catch {
        continue;
      }
    }

    if (ports.length !== count) {
      await this.portLeaseRepo.delete({ runtimeId });
      throw new Error('No free runtime ports available');
    }
    return ports;
  }

  async releasePorts(runtimeId: string): Promise<void> {
    await this.portLeaseRepo.delete({ runtimeId });
  }

  runtimeStatusSummary(runtime: RuntimeEntity): Record<string, unknown> {
    const firstMount = runtime.mounts?.[0] ?? null;
    return {
      runtimeId: runtime.id,
      sandboxId: runtime.sandboxId,
      name: runtime.name,
      sandboxName: runtime.sandboxName,
      runtimeHostId: runtime.runtimeHostId,
      hostPort: runtime.hostPort,
      primaryPort: runtime.primaryPort,
      primaryPortProtocol: runtime.primaryPortProtocol,
      portBindings: runtime.portBindings ?? [],
      public: runtime.public,
      status: runtime.status,
      image: runtime.image,
      command: runtime.command ?? [],
      env: runtime.environment ?? {},
      workingDir: runtime.workingDir,
      mounts: runtime.mounts ?? [],
      volumeMountPath: firstMount?.mountPath ?? null,
      cpu: runtime.cpu,
      memoryMiB: runtime.memoryMiB,
      diskGiB: runtime.diskGiB,
      autoStopMinutes: runtime.autoStopMinutes,
      ephemeral: runtime.ephemeral,
      hasSecrets: (runtime.secrets?.length ?? 0) > 0,
      lastActiveAt: runtime.lastActiveAt?.toISOString() ?? null,
      statusReason: runtime.statusReason ?? null,
      createdAt: runtime.createdAt?.toISOString() ?? null,
      updatedAt: runtime.updatedAt?.toISOString() ?? null,
    };
  }

  sandboxName(sandboxId: string): string {
    return this.identity.sandboxName({
      prefix: this.config.sandboxNamePrefix,
      sandboxId,
    });
  }

  volumeBackendName(volumeId: string): string {
    return this.identity.volumeName({
      prefix: this.config.volumeNamePrefix,
      sandboxId: volumeId,
    });
  }

  async setRuntimeStatus(
    runtime: RuntimeEntity,
    status: RuntimeStatus,
    statusReason?: string | null,
  ): Promise<RuntimeEntity> {
    return this.updateRuntime(runtime, {
      status,
      statusReason: statusReason ?? null,
      lastActiveAt: status === 'running' ? new Date() : runtime.lastActiveAt,
    });
  }

  normalizeName(value?: string | null): string | null {
    if (!value?.trim()) {
      return null;
    }
    return this.identity.normalizeSandboxId(value);
  }

  createSandboxId(seed?: string | null): string {
    if (seed?.trim()) {
      return this.identity.normalizeSandboxId(seed);
    }
    return this.identity.normalizeSandboxId(randomBytes(8).toString('hex'));
  }

  async listVolumes(): Promise<VolumeEntity[]> {
    return this.volumeRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findVolumeByIdOrName(value: string): Promise<VolumeEntity | null> {
    const normalized = this.normalizeName(value);
    if (!normalized) {
      return null;
    }
    return this.volumeRepo.findOne({
      where: [{ id: value }, { name: normalized }],
    });
  }

  async saveVolume(input: Partial<VolumeEntity>): Promise<VolumeEntity> {
    return this.volumeRepo.save(this.volumeRepo.create(input));
  }

  async volumePath(
    volume: VolumeEntity,
    subpath?: string | null,
  ): Promise<string> {
    const root = join(this.config.managedVolumeRoot, volume.backendName);
    const target = subpath?.trim() ? join(root, subpath.trim()) : root;
    await mkdir(target, { recursive: true });
    return target;
  }

  async deleteVolume(volume: VolumeEntity): Promise<void> {
    await this.volumeRepo.delete({ id: volume.id });
    await rm(join(this.config.managedVolumeRoot, volume.backendName), {
      recursive: true,
      force: true,
    });
  }

  async createSignedPreviewToken(
    sandboxId: string,
    port: number,
    ttlSeconds: number,
  ): Promise<SignedPreviewTokenEntity> {
    await this.signedPreviewRepo.delete({
      sandboxId,
      port,
    });
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return this.signedPreviewRepo.save(
      this.signedPreviewRepo.create({
        token,
        sandboxId,
        port,
        expiresAt,
      }),
    );
  }

  async getSignedPreviewToken(
    token: string,
    port: number,
  ): Promise<SignedPreviewTokenEntity | null> {
    return this.signedPreviewRepo.findOneBy({ token, port });
  }

  async expireSignedPreviewToken(token: string, port: number): Promise<void> {
    await this.signedPreviewRepo.delete({ token, port });
  }

  hasSignedPreviewTokenExpired(record: SignedPreviewTokenEntity): boolean {
    return record.expiresAt.getTime() <= Date.now();
  }

  mountRecordsEqual(
    current: RuntimeVolumeMountRecord[] | null | undefined,
    next: RuntimeVolumeMountRecord[],
  ): boolean {
    return JSON.stringify(current ?? []) === JSON.stringify(next);
  }

  portBindingsEqual(
    current: RuntimePortBindingRecord[] | null | undefined,
    next: RuntimePortBindingRecord[],
  ): boolean {
    return JSON.stringify(current ?? []) === JSON.stringify(next);
  }
}
