import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../../src/config/app-config.service.js';
import { PortLeaseEntity } from '../../src/database/port-lease.entity.js';
import { RuntimeHostEntity } from '../../src/database/runtime-host.entity.js';
import { RuntimeEntity } from '../../src/database/runtime.entity.js';
import { SignedPreviewTokenEntity } from '../../src/database/signed-preview-token.entity.js';
import { VolumeEntity } from '../../src/database/volume.entity.js';
import { RuntimeIdentityService } from '../../src/runtime-control/runtime-identity.service.js';
import { RuntimeRegistryService } from '../../src/runtime-registry/runtime-registry.service.js';

describe('RuntimeRegistryService', () => {
  it('allocates ports from the configured range without collisions', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [
            RuntimeHostEntity,
            RuntimeEntity,
            PortLeaseEntity,
            VolumeEntity,
            SignedPreviewTokenEntity,
          ],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          RuntimeHostEntity,
          RuntimeEntity,
          PortLeaseEntity,
          VolumeEntity,
          SignedPreviewTokenEntity,
        ]),
      ],
      providers: [
        RuntimeRegistryService,
        {
          provide: AppConfigService,
          useValue: {
            runtimeHostName: 'local',
            runtimeHostBaseUrl: 'http://127.0.0.1:3210',
            runtimeHostPublicBaseUrl: 'http://localhost:3210',
            portRangeStart: 31000,
            portRangeEnd: 31001,
            sandboxNamePrefix: 'runtime',
            volumeNamePrefix: 'runtime-data',
            managedVolumeRoot: '/tmp/microsandbox-cloud-test-volumes',
          },
        },
        RuntimeIdentityService,
      ],
    }).compile();

    const registry = moduleRef.get(RuntimeRegistryService);
    await registry.onModuleInit();

    const runtimeA = await registry.saveRuntime({
      sandboxId: 'a',
      name: 'a',
      sandboxName: 'runtime-a',
      runtimeHostId: registry.localHostId,
      portBindings: [],
      hostPort: 0,
      primaryPort: 8080,
      primaryPortProtocol: 'tcp',
      public: false,
      authToken: 'token-a',
      status: 'provisioning',
      image: 'image:a',
      command: ['nginx', '-g', 'daemon off;'],
      environment: {},
      secrets: [],
      workingDir: '/workspace',
      mounts: [],
      cpu: 1,
      memoryMiB: 512,
      diskGiB: 2,
      autoStopMinutes: null,
      ephemeral: false,
      lastActiveAt: new Date(),
    });
    const runtimeB = await registry.saveRuntime({
      sandboxId: 'b',
      name: 'b',
      sandboxName: 'runtime-b',
      runtimeHostId: registry.localHostId,
      portBindings: [],
      hostPort: 0,
      primaryPort: 8080,
      primaryPortProtocol: 'tcp',
      public: false,
      authToken: 'token-b',
      status: 'provisioning',
      image: 'image:b',
      command: ['nginx', '-g', 'daemon off;'],
      environment: {},
      secrets: [],
      workingDir: '/workspace',
      mounts: [],
      cpu: 1,
      memoryMiB: 512,
      diskGiB: 2,
      autoStopMinutes: null,
      ephemeral: false,
      lastActiveAt: new Date(),
    });

    await expect(registry.leasePorts(runtimeA.id, 1)).resolves.toEqual([31000]);
    await expect(registry.leasePorts(runtimeB.id, 1)).resolves.toEqual([31001]);
    await expect(registry.leasePorts('runtime-c', 1)).rejects.toThrow(
      'No free runtime ports available',
    );

    await moduleRef.close();
  });
});
