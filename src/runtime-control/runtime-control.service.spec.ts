import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { AppConfigService } from '../config/app-config.service.js';
import type { RuntimeEntity } from '../database/runtime.entity.js';
import type { MicrosandboxAdapter } from '../microsandbox/microsandbox-adapter.interface.js';
import { RuntimeRegistryService } from '../runtime-registry/runtime-registry.service.js';
import { RuntimeControlService } from './runtime-control.service.js';
import { RuntimeIdentityService } from './runtime-identity.service.js';

type RegistryMock = Pick<
  RuntimeRegistryService,
  'findRuntime' | 'updateRuntime' | 'runtimeStatusSummary' | 'setRuntimeStatus'
>;

type MicrosandboxMock = Pick<
  MicrosandboxAdapter,
  | 'createDetachedRuntime'
  | 'getStatus'
  | 'isHealthy'
  | 'remove'
  | 'start'
  | 'writeFiles'
>;

type FindRuntime = RuntimeRegistryService['findRuntime'];
type UpdateRuntime = RuntimeRegistryService['updateRuntime'];
type RuntimeStatusSummary = RuntimeRegistryService['runtimeStatusSummary'];
type SetRuntimeStatus = RuntimeRegistryService['setRuntimeStatus'];
type CreateDetachedRuntime = MicrosandboxAdapter['createDetachedRuntime'];
type GetStatus = MicrosandboxAdapter['getStatus'];
type IsHealthy = MicrosandboxAdapter['isHealthy'];
type RemoveRuntime = MicrosandboxAdapter['remove'];
type StartRuntime = MicrosandboxAdapter['start'];
type WriteFiles = MicrosandboxAdapter['writeFiles'];

describe('RuntimeControlService', () => {
  it('returns an existing healthy runtime without reprovisioning', async () => {
    const runtime: RuntimeEntity = {
      id: 'runtime-1',
      sandboxId: 'runtime-1',
      sandboxName: 'runtime-runtime-1',
      volumeName: 'runtime-data-runtime-1',
      volumeMountPath: '/workspace',
      runtimeHostId: 'local',
      hostPort: 31000,
      primaryPort: 8080,
      primaryPortProtocol: 'tcp',
      status: 'running',
      image: 'image:1',
      command: ['nginx', '-g', 'daemon off;'],
      environment: {},
      secrets: [],
      workingDir: '/workspace',
      lastActiveAt: new Date(),
      statusReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    type RuntimeSummary = {
      runtimeId: string;
      status: RuntimeEntity['status'];
    };
    const createSummary = (value: RuntimeEntity): RuntimeSummary => ({
      runtimeId: value.id,
      status: value.status,
    });
    const registry: RegistryMock = {
      findRuntime: jest.fn<FindRuntime>().mockResolvedValue(runtime),
      updateRuntime: jest
        .fn<UpdateRuntime>()
        .mockImplementation(
          (
            current: RuntimeEntity,
            patch: Partial<RuntimeEntity>,
          ): Promise<RuntimeEntity> =>
            Promise.resolve({ ...current, ...patch }),
        ),
      runtimeStatusSummary: jest.fn<RuntimeStatusSummary>(createSummary),
      setRuntimeStatus: jest.fn<SetRuntimeStatus>(),
    };
    const createDetachedRuntime = jest.fn<CreateDetachedRuntime>();
    const microsandbox: MicrosandboxMock = {
      getStatus: jest.fn<GetStatus>().mockResolvedValue('running'),
      isHealthy: jest.fn<IsHealthy>().mockResolvedValue(true),
      createDetachedRuntime,
      remove: jest.fn<RemoveRuntime>().mockResolvedValue(undefined),
      start: jest.fn<StartRuntime>(),
      writeFiles: jest.fn<WriteFiles>(),
    };

    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      new RuntimeIdentityService(),
      microsandbox as MicrosandboxAdapter,
    );
    const result = await service.ensure({
      sandboxId: 'runtime-1',
      image: 'image:1',
      command: ['nginx', '-g', 'daemon off;'],
      env: {},
      workingDir: '/workspace',
      port: { containerPort: 8080, protocol: 'tcp' },
      volumeMountPath: '/workspace',
    });

    expect(result).toEqual({ runtimeId: 'runtime-1', status: 'running' });
    expect(createDetachedRuntime).not.toHaveBeenCalled();
  });

  it('throws when requesting a missing runtime', async () => {
    const registry: RegistryMock = {
      findRuntime: jest.fn<FindRuntime>().mockResolvedValue(null),
      updateRuntime: jest.fn<UpdateRuntime>(),
      runtimeStatusSummary: jest.fn<RuntimeStatusSummary>(),
      setRuntimeStatus: jest.fn<SetRuntimeStatus>(),
    };
    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      new RuntimeIdentityService(),
      {} as MicrosandboxAdapter,
    );

    await expect(service.get('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('restarts a stopped runtime before returning a connection', async () => {
    const runtime: RuntimeEntity = {
      id: 'runtime-2',
      sandboxId: 'runtime-2',
      sandboxName: 'runtime-runtime-2',
      volumeName: 'runtime-data-runtime-2',
      volumeMountPath: '/workspace',
      runtimeHostId: 'local',
      hostPort: 31001,
      primaryPort: 8080,
      primaryPortProtocol: 'tcp',
      status: 'running',
      image: 'image:1',
      command: ['nginx', '-g', 'daemon off;'],
      environment: {},
      secrets: [],
      workingDir: '/workspace',
      lastActiveAt: new Date(),
      statusReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const registry: RegistryMock = {
      findRuntime: jest.fn<FindRuntime>().mockResolvedValue(runtime),
      updateRuntime: jest
        .fn<UpdateRuntime>()
        .mockImplementation(
          (
            current: RuntimeEntity,
            patch: Partial<RuntimeEntity>,
          ): Promise<RuntimeEntity> =>
            Promise.resolve({ ...current, ...patch }),
        ),
      runtimeStatusSummary: jest.fn<RuntimeStatusSummary>(),
      setRuntimeStatus: jest.fn<SetRuntimeStatus>().mockImplementation(
        (
          current: RuntimeEntity,
          status: RuntimeEntity['status'],
          statusReason?: string | null,
        ): Promise<RuntimeEntity> =>
          Promise.resolve({
            ...current,
            status,
            statusReason: statusReason ?? null,
          }),
      ),
    };
    const start = jest.fn<StartRuntime>().mockResolvedValue(undefined);
    const microsandbox: MicrosandboxMock = {
      getStatus: jest.fn<GetStatus>().mockResolvedValue('stopped'),
      start,
      writeFiles: jest.fn<WriteFiles>().mockResolvedValue(undefined),
      isHealthy: jest.fn<IsHealthy>().mockResolvedValue(true),
      createDetachedRuntime: jest.fn<CreateDetachedRuntime>(),
      remove: jest.fn<RemoveRuntime>(),
    };

    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      new RuntimeIdentityService(),
      microsandbox as MicrosandboxAdapter,
    );

    const result = await service.connection('runtime-2');

    expect(start).toHaveBeenCalledWith('runtime-runtime-2');
    expect(result.status).toBe('running');
  });
});
