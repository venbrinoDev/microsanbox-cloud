import { ConflictException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { AppConfigService } from '../../src/config/app-config.service.js';
import type { RuntimeEntity } from '../../src/database/runtime.entity.js';
import type { MicrosandboxAdapter } from '../../src/microsandbox/microsandbox-adapter.interface.js';
import { RuntimeRegistryService } from '../../src/runtime-registry/runtime-registry.service.js';
import { RuntimeControlService } from '../../src/runtime-control/runtime-control.service.js';

type RegistryMock = Pick<
  RuntimeRegistryService,
  | 'createSandboxId'
  | 'deleteRuntime'
  | 'findRuntimeBySandboxId'
  | 'findRuntimeBySandboxIdOrName'
  | 'findVolumeByIdOrName'
  | 'leasePorts'
  | 'listRuntimes'
  | 'listVolumes'
  | 'normalizeName'
  | 'mountRecordsEqual'
  | 'portBindingsEqual'
  | 'releasePorts'
  | 'runtimeStatusSummary'
  | 'sandboxName'
  | 'saveRuntime'
  | 'setRuntimeStatus'
  | 'updateRuntime'
  | 'volumeBackendName'
>;

type LoggerMock = {
  log: jest.MockedFunction<(message: unknown, ...params: unknown[]) => void>;
  warn: jest.MockedFunction<(message: unknown, ...params: unknown[]) => void>;
  error: jest.MockedFunction<(message: unknown, ...params: unknown[]) => void>;
  debug: jest.MockedFunction<(message: unknown, ...params: unknown[]) => void>;
  verbose: jest.MockedFunction<
    (message: unknown, ...params: unknown[]) => void
  >;
};

type MicrosandboxMock = Pick<
  MicrosandboxAdapter,
  | 'createDetachedRuntime'
  | 'exec'
  | 'getStatus'
  | 'isHealthy'
  | 'readFiles'
  | 'refreshActivity'
  | 'remove'
  | 'removeVolume'
  | 'ensureVolume'
  | 'start'
  | 'stop'
  | 'writeFiles'
>;

const runtimeFixture = (): RuntimeEntity => ({
  id: 'runtime-1',
  sandboxId: 'runtime-1',
  name: 'runtime-1',
  sandboxName: 'runtime-runtime-1',
  runtimeHostId: 'local',
  portBindings: [
    { containerPort: 8080, hostPort: 31000, protocol: 'tcp' },
    { containerPort: 22, hostPort: 31001, protocol: 'tcp', name: 'ssh' },
  ],
  primaryPort: 8080,
  hostPort: 31000,
  primaryPortProtocol: 'tcp',
  public: false,
  authToken: 'token',
  status: 'running',
  image: 'image:1',
  command: ['nginx', '-g', 'daemon off;'],
  environment: {},
  secrets: [],
  workingDir: '/workspace',
  mounts: [],
  cpu: 1,
  memoryMiB: 2048,
  diskGiB: 6,
  autoStopMinutes: null,
  ephemeral: false,
  lastActiveAt: new Date(),
  statusReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function createRegistryMock(runtime: RuntimeEntity | null): RegistryMock {
  const createSandboxIdMock: jest.MockedFunction<
    RuntimeRegistryService['createSandboxId']
  > = jest.fn((seed?: string | null) => String(seed ?? 'runtime-1'));
  const deleteRuntimeMock: jest.MockedFunction<
    RuntimeRegistryService['deleteRuntime']
  > = jest.fn((runtimeToDelete: RuntimeEntity) => {
    void runtimeToDelete;
    return Promise.resolve();
  });
  const findRuntimeBySandboxIdMock: jest.MockedFunction<
    RuntimeRegistryService['findRuntimeBySandboxId']
  > = jest.fn((sandboxId: string) => {
    void sandboxId;
    return Promise.resolve(runtime);
  });
  const findRuntimeBySandboxIdOrNameMock: jest.MockedFunction<
    RuntimeRegistryService['findRuntimeBySandboxIdOrName']
  > = jest.fn((sandboxIdOrName: string) => {
    void sandboxIdOrName;
    return Promise.resolve(runtime);
  });
  const findVolumeByIdOrNameMock: jest.MockedFunction<
    RuntimeRegistryService['findVolumeByIdOrName']
  > = jest.fn((volumeIdOrName: string) => {
    void volumeIdOrName;
    return Promise.resolve(null);
  });
  const leasePortsMock: jest.MockedFunction<
    RuntimeRegistryService['leasePorts']
  > = jest.fn((runtimeId: string, count: number) => {
    void runtimeId;
    return Promise.resolve(
      Array.from({ length: count }, (_unused, index) => 31000 + index),
    );
  });
  const listRuntimesMock: jest.MockedFunction<
    RuntimeRegistryService['listRuntimes']
  > = jest.fn(() => Promise.resolve(runtime ? [runtime] : []));
  const listVolumesMock: jest.MockedFunction<
    RuntimeRegistryService['listVolumes']
  > = jest.fn(() => Promise.resolve([]));
  const normalizeNameMock: jest.MockedFunction<
    RuntimeRegistryService['normalizeName']
  > = jest.fn((value?: string | null) => value?.trim() ?? null);
  const mountRecordsEqualMock: jest.MockedFunction<
    RuntimeRegistryService['mountRecordsEqual']
  > = jest.fn(
    (current, next): boolean =>
      JSON.stringify(current ?? []) === JSON.stringify(next),
  );
  const portBindingsEqualMock: jest.MockedFunction<
    RuntimeRegistryService['portBindingsEqual']
  > = jest.fn(
    (current, next): boolean =>
      JSON.stringify(current ?? []) === JSON.stringify(next),
  );
  const releasePortsMock: jest.MockedFunction<
    RuntimeRegistryService['releasePorts']
  > = jest.fn((runtimeId: string) => {
    void runtimeId;
    return Promise.resolve();
  });
  const runtimeStatusSummaryMock: jest.MockedFunction<
    RuntimeRegistryService['runtimeStatusSummary']
  > = jest.fn((value: RuntimeEntity) => ({
    runtimeId: value.id,
    sandboxId: value.sandboxId,
    status: value.status,
  }));
  const sandboxNameMock: jest.MockedFunction<
    RuntimeRegistryService['sandboxName']
  > = jest.fn((sandboxId: string) => `runtime-${sandboxId}`);
  const saveRuntimeMock: jest.MockedFunction<
    RuntimeRegistryService['saveRuntime']
  > = jest.fn((input: Partial<RuntimeEntity>) =>
    Promise.resolve({
      ...runtimeFixture(),
      ...input,
    }),
  );
  const setRuntimeStatusMock: jest.MockedFunction<
    RuntimeRegistryService['setRuntimeStatus']
  > = jest.fn(
    (
      current: RuntimeEntity,
      status: RuntimeEntity['status'],
      statusReason?: string | null,
    ) =>
      Promise.resolve({
        ...current,
        status,
        statusReason: statusReason ?? null,
      }),
  );
  const updateRuntimeMock: jest.MockedFunction<
    RuntimeRegistryService['updateRuntime']
  > = jest.fn((current: RuntimeEntity, patch: Partial<RuntimeEntity>) =>
    Promise.resolve({
      ...current,
      ...patch,
    }),
  );
  const volumeBackendNameMock: jest.MockedFunction<
    RuntimeRegistryService['volumeBackendName']
  > = jest.fn((volumeId: string) => `runtime-data-${volumeId}`);
  return {
    createSandboxId: createSandboxIdMock,
    deleteRuntime: deleteRuntimeMock,
    findRuntimeBySandboxId: findRuntimeBySandboxIdMock,
    findRuntimeBySandboxIdOrName: findRuntimeBySandboxIdOrNameMock,
    findVolumeByIdOrName: findVolumeByIdOrNameMock,
    leasePorts: leasePortsMock,
    listRuntimes: listRuntimesMock,
    listVolumes: listVolumesMock,
    normalizeName: normalizeNameMock,
    mountRecordsEqual: mountRecordsEqualMock,
    portBindingsEqual: portBindingsEqualMock,
    releasePorts: releasePortsMock,
    runtimeStatusSummary: runtimeStatusSummaryMock,
    sandboxName: sandboxNameMock,
    saveRuntime: saveRuntimeMock,
    setRuntimeStatus: setRuntimeStatusMock,
    updateRuntime: updateRuntimeMock,
    volumeBackendName: volumeBackendNameMock,
  };
}

function createMicrosandboxMock(): MicrosandboxMock {
  const createDetachedRuntimeMock: jest.MockedFunction<
    MicrosandboxAdapter['createDetachedRuntime']
  > = jest.fn((input) => {
    void input;
    return Promise.resolve();
  });
  const execMock: jest.MockedFunction<MicrosandboxAdapter['exec']> = jest.fn(
    (name: string, command: string, args?: string[]) => {
      void name;
      void command;
      void args;
      return Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    },
  );
  const getStatusMock: jest.MockedFunction<MicrosandboxAdapter['getStatus']> =
    jest.fn((name: string) => {
      void name;
      return Promise.resolve('running');
    });
  const isHealthyMock: jest.MockedFunction<MicrosandboxAdapter['isHealthy']> =
    jest.fn((port: number) => {
      void port;
      return Promise.resolve(true);
    });
  const readFilesMock: jest.MockedFunction<MicrosandboxAdapter['readFiles']> =
    jest.fn((name: string, paths: string[]) => {
      void name;
      void paths;
      return Promise.resolve([]);
    });
  const refreshActivityMock: jest.MockedFunction<
    MicrosandboxAdapter['refreshActivity']
  > = jest.fn((name: string) => {
    void name;
    return Promise.resolve();
  });
  const removeMock: jest.MockedFunction<MicrosandboxAdapter['remove']> =
    jest.fn((name: string) => {
      void name;
      return Promise.resolve();
    });
  const removeVolumeMock: jest.MockedFunction<
    MicrosandboxAdapter['removeVolume']
  > = jest.fn((name: string) => {
    void name;
    return Promise.resolve();
  });
  const ensureVolumeMock: jest.MockedFunction<
    MicrosandboxAdapter['ensureVolume']
  > = jest.fn((name: string) => {
    void name;
    return Promise.resolve();
  });
  const startMock: jest.MockedFunction<MicrosandboxAdapter['start']> = jest.fn(
    (name: string, command?: string[] | null, workingDir?: string | null) => {
      void name;
      void command;
      void workingDir;
      return Promise.resolve();
    },
  );
  const stopMock: jest.MockedFunction<MicrosandboxAdapter['stop']> = jest.fn(
    (name: string) => {
      void name;
      return Promise.resolve();
    },
  );
  const writeFilesMock: jest.MockedFunction<MicrosandboxAdapter['writeFiles']> =
    jest.fn((name: string, files) => {
      void name;
      void files;
      return Promise.resolve();
    });

  return {
    createDetachedRuntime: createDetachedRuntimeMock,
    exec: execMock,
    getStatus: getStatusMock,
    isHealthy: isHealthyMock,
    readFiles: readFilesMock,
    refreshActivity: refreshActivityMock,
    remove: removeMock,
    removeVolume: removeVolumeMock,
    ensureVolume: ensureVolumeMock,
    start: startMock,
    stop: stopMock,
    writeFiles: writeFilesMock,
  };
}

function createLoggerMock(): LoggerMock {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
}

describe('RuntimeControlService', () => {
  it('returns an existing healthy sandbox without reprovisioning', async () => {
    const runtime = runtimeFixture();
    const registry = createRegistryMock(runtime);
    const microsandbox = createMicrosandboxMock();

    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      createLoggerMock(),
      microsandbox,
    );

    const result = await service.ensure({
      sandboxId: 'runtime-1',
      name: 'runtime-1',
      image: 'image:1',
      command: ['nginx', '-g', 'daemon off;'],
      env: {},
      workingDir: '/workspace',
      primaryPort: { containerPort: 8080, protocol: 'tcp' },
    });

    expect(result).toEqual({
      runtimeId: 'runtime-1',
      sandboxId: 'runtime-1',
      status: 'running',
    });
    expect(microsandbox.createDetachedRuntime).not.toHaveBeenCalled();
  });

  it('throws when requesting a missing sandbox', async () => {
    const registry = createRegistryMock(null);
    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      createLoggerMock(),
      createMicrosandboxMock(),
    );

    await expect(service.get('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('starts a stopped sandbox', async () => {
    const runtime = runtimeFixture();
    runtime.status = 'stopped';
    const registry = createRegistryMock(runtime);
    const microsandbox = createMicrosandboxMock();

    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      createLoggerMock(),
      microsandbox,
    );

    const result = await service.start('runtime-1');

    expect(microsandbox.start).toHaveBeenCalledWith(
      'runtime-runtime-1',
      ['nginx', '-g', 'daemon off;'],
      '/workspace',
    );
    expect(result).toEqual({
      runtimeId: 'runtime-1',
      sandboxId: 'runtime-1',
      status: 'running',
    });
  });

  it('refreshes activity for a running sandbox', async () => {
    const runtime = runtimeFixture();
    const registry = createRegistryMock(runtime);
    const microsandbox = createMicrosandboxMock();
    let refreshedAt: Date | undefined;
    registry.updateRuntime = jest.fn(
      (current: RuntimeEntity, patch: Partial<RuntimeEntity>) => {
        if (patch.lastActiveAt instanceof Date) {
          refreshedAt = patch.lastActiveAt;
        }
        return Promise.resolve({
          ...current,
          ...patch,
        });
      },
    );

    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      createLoggerMock(),
      microsandbox,
    );

    const result = await service.refreshActivity('runtime-1');

    expect(microsandbox.refreshActivity).toHaveBeenCalledWith(
      'runtime-runtime-1',
    );
    expect(refreshedAt).toBeInstanceOf(Date);
    expect(result).toEqual({
      runtimeId: 'runtime-1',
      sandboxId: 'runtime-1',
      status: 'running',
    });
  });

  it('does not refresh activity for a stopped sandbox', async () => {
    const runtime = runtimeFixture();
    runtime.status = 'stopped';
    const registry = createRegistryMock(runtime);
    const microsandbox = createMicrosandboxMock();
    microsandbox.getStatus = jest.fn(() => Promise.resolve('stopped'));

    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      createLoggerMock(),
      microsandbox,
    );

    await expect(service.refreshActivity('runtime-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(microsandbox.refreshActivity).not.toHaveBeenCalled();
  });

  it('passes auto-stop minutes to native idle timeout during provisioning', async () => {
    const registry = createRegistryMock(null);
    const microsandbox = createMicrosandboxMock();

    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      createLoggerMock(),
      microsandbox,
    );

    await service.ensure({
      sandboxId: 'runtime-1',
      name: 'runtime-1',
      image: 'image:1',
      command: ['nginx', '-g', 'daemon off;'],
      env: {},
      workingDir: '/workspace',
      primaryPort: { containerPort: 8080, protocol: 'tcp' },
      autoStopMinutes: 5,
    });

    expect(microsandbox.createDetachedRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        autoStopMinutes: 5,
      }),
    );
  });

  it('updates an existing sandbox using existing values for omitted fields', async () => {
    const runtime = runtimeFixture();
    runtime.image = 'image:1';
    runtime.command = ['nginx', '-g', 'daemon off;'];
    runtime.environment = { NODE_ENV: 'production' };
    runtime.mounts = [
      {
        volumeId: 'volume-1',
        volumeName: 'volume-1',
        mountPath: '/workspace',
        readOnly: false,
      },
    ];
    const registry = createRegistryMock(runtime);
    registry.findVolumeByIdOrName = jest.fn((volumeIdOrName: string) => {
      if (volumeIdOrName === 'volume-1') {
        return Promise.resolve({
          id: 'volume-1',
          name: 'volume-1',
          backendName: 'runtime-data-volume-1',
          quotaMiB: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    const microsandbox = createMicrosandboxMock();
    const service = new RuntimeControlService(
      new AppConfigService(),
      registry as RuntimeRegistryService,
      createLoggerMock(),
      microsandbox,
    );

    const result = await service.update('runtime-1', {
      image: 'image:2',
    });

    expect(microsandbox.createDetachedRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxName: 'runtime-runtime-1',
        image: 'image:2',
        command: ['nginx', '-g', 'daemon off;'],
        env: { NODE_ENV: 'production' },
        mounts: [
          {
            volumeName: 'runtime-data-volume-1',
            mountPath: '/workspace',
            readOnly: false,
          },
        ],
      }),
    );
    expect(result).toEqual({
      runtimeId: 'runtime-1',
      sandboxId: 'runtime-1',
      status: 'running',
    });
  });
});
