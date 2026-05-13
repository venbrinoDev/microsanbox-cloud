import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service.js';
import { RuntimeHostEntity } from '../database/runtime-host.entity.js';
import { PortLeaseEntity } from '../database/port-lease.entity.js';
import { RuntimeEntity, RuntimeStatus } from '../database/runtime.entity.js';
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
    private readonly config: AppConfigService,
    private readonly identity: RuntimeIdentityService,
  ) {}

  async onModuleInit(): Promise<void> {
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

  async findRuntime(sandboxId: string): Promise<RuntimeEntity | null> {
    const normalizedSandboxId = this.identity.normalizeSandboxId(sandboxId);
    return this.runtimeRepo.findOneBy({ sandboxId: normalizedSandboxId });
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
  }

  async leasePort(runtimeId: string): Promise<number> {
    for (
      let port = this.config.portRangeStart;
      port <= this.config.portRangeEnd;
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
        return port;
      } catch {
        continue;
      }
    }
    throw new Error('No free runtime ports available');
  }

  async releasePort(runtimeId: string): Promise<void> {
    await this.portLeaseRepo.delete({ runtimeId });
  }

  runtimeStatusSummary(runtime: RuntimeEntity): Record<string, unknown> {
    return {
      runtimeId: runtime.id,
      sandboxId: runtime.sandboxId,
      sandboxName: runtime.sandboxName,
      runtimeHostId: runtime.runtimeHostId,
      hostPort: runtime.hostPort,
      primaryPort: runtime.primaryPort,
      primaryPortProtocol: runtime.primaryPortProtocol,
      status: runtime.status,
      image: runtime.image,
      command: runtime.command ?? [],
      hasSecrets: (runtime.secrets?.length ?? 0) > 0,
      workingDir: runtime.workingDir,
      volumeMountPath: runtime.volumeMountPath,
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

  volumeName(sandboxId: string): string {
    return this.identity.volumeName({
      prefix: this.config.volumeNamePrefix,
      sandboxId,
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
}
