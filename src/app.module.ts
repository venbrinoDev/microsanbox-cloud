import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { RuntimeHostEntity } from './database/runtime-host.entity.js';
import { RuntimeEntity } from './database/runtime.entity.js';
import { PortLeaseEntity } from './database/port-lease.entity.js';
import { SignedPreviewTokenEntity } from './database/signed-preview-token.entity.js';
import { VolumeEntity } from './database/volume.entity.js';
import { AppConfigService } from './config/app-config.service.js';
import { HealthController } from './health/health.controller.js';
import { RuntimeRegistryService } from './runtime-registry/runtime-registry.service.js';
import { MicrosandboxAdapterService } from './microsandbox/microsandbox-adapter.service.js';
import { MICROSANDBOX_ADAPTER } from './microsandbox/microsandbox-adapter.interface.js';
import { SandboxController } from './runtime-control/sandbox.controller.js';
import { RuntimeControlService } from './runtime-control/runtime-control.service.js';
import { RuntimeIdentityService } from './runtime-control/runtime-identity.service.js';
import { ProxyService } from './proxy/proxy.service.js';
import { InternalAuthGuard } from './shared/internal-auth.guard.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const config = new AppConfigService();
        mkdirSync(dirname(config.sqlitePath), { recursive: true });
        return {
          type: 'sqlite',
          database: config.sqlitePath,
          entities: [
            RuntimeHostEntity,
            RuntimeEntity,
            PortLeaseEntity,
            VolumeEntity,
            SignedPreviewTokenEntity,
          ],
          synchronize: true,
        };
      },
    }),
    TypeOrmModule.forFeature([
      RuntimeHostEntity,
      RuntimeEntity,
      PortLeaseEntity,
      VolumeEntity,
      SignedPreviewTokenEntity,
    ]),
  ],
  controllers: [HealthController, SandboxController],
  providers: [
    AppConfigService,
    RuntimeRegistryService,
    MicrosandboxAdapterService,
    { provide: MICROSANDBOX_ADAPTER, useExisting: MicrosandboxAdapterService },
    RuntimeControlService,
    RuntimeIdentityService,
    ProxyService,
    InternalAuthGuard,
  ],
})
export class AppModule {}
