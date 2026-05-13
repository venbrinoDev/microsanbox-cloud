import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service.js';
import { PortLeaseEntity } from '../database/port-lease.entity.js';
import { RuntimeHostEntity } from '../database/runtime-host.entity.js';
import { RuntimeEntity } from '../database/runtime.entity.js';
import { RuntimeIdentityService } from '../runtime-control/runtime-identity.service.js';
import { RuntimeRegistryService } from './runtime-registry.service.js';

describe('RuntimeRegistryService', () => {
  it('allocates ports from the configured range without collisions', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [RuntimeHostEntity, RuntimeEntity, PortLeaseEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          RuntimeHostEntity,
          RuntimeEntity,
          PortLeaseEntity,
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
          },
        },
        RuntimeIdentityService,
      ],
    }).compile();

    const registry = moduleRef.get(RuntimeRegistryService);
    await registry.onModuleInit();

    const runtimeA = await registry.saveRuntime({
      sandboxId: 'a',
      sandboxName: 'runtime-a',
      volumeName: 'runtime-data-a',
      volumeMountPath: '/workspace',
      runtimeHostId: registry.localHostId,
      hostPort: 0,
      primaryPort: 8080,
      primaryPortProtocol: 'tcp',
      status: 'provisioning',
      image: 'image:a',
      command: ['nginx', '-g', 'daemon off;'],
      environment: {},
      workingDir: '/workspace',
      lastActiveAt: new Date(),
    });
    const runtimeB = await registry.saveRuntime({
      sandboxId: 'b',
      sandboxName: 'runtime-b',
      volumeName: 'runtime-data-b',
      volumeMountPath: '/workspace',
      runtimeHostId: registry.localHostId,
      hostPort: 0,
      primaryPort: 8080,
      primaryPortProtocol: 'tcp',
      status: 'provisioning',
      image: 'image:b',
      command: ['nginx', '-g', 'daemon off;'],
      environment: {},
      workingDir: '/workspace',
      lastActiveAt: new Date(),
    });

    await expect(registry.leasePort(runtimeA.id)).resolves.toBe(31000);
    await expect(registry.leasePort(runtimeB.id)).resolves.toBe(31001);
    await expect(registry.leasePort('runtime-c')).rejects.toThrow(
      'No free runtime ports available',
    );

    await moduleRef.close();
  });
});
