import type { RuntimeFileDto } from '../runtime-control/dto/ensure-runtime.dto.js';

export const MICROSANDBOX_ADAPTER = Symbol('MICROSANDBOX_ADAPTER');

export interface RuntimeRegistryAuthInput {
  server: string;
  username: string;
  password: string;
}

export interface RuntimeSecretInput {
  env: string;
  value: string;
  placeholder?: string;
  allowedHosts: string[];
  allowedHostPatterns: string[];
  allowAnyHostDangerous?: boolean;
  requireTlsIdentity?: boolean;
  injectHeaders?: boolean;
  injectBasicAuth?: boolean;
  injectQuery?: boolean;
  injectBody?: boolean;
}

export interface CreateRuntimeInput {
  sandboxName: string;
  image: string;
  registryAuth?: RuntimeRegistryAuthInput | null;
  command?: string[] | null;
  workingDir?: string | null;
  ports: Array<{
    name?: string;
    hostPort: number;
    containerPort: number;
    protocol: 'tcp' | 'udp';
  }>;
  mounts: Array<{
    volumeName: string;
    mountPath: string;
    readOnly?: boolean;
  }>;
  cpu: number;
  memoryMiB: number;
  diskGiB: number;
  env: Record<string, string>;
  secrets: RuntimeSecretInput[];
  files: RuntimeFileDto[];
  ssh?: {
    enabled: boolean;
  };
}

export interface MicrosandboxAdapter {
  listCachedImages(): Promise<
    Array<{
      reference: string;
      architecture: string | null;
      os: string | null;
      sizeBytes: number | null;
      layerCount: number;
    }>
  >;
  pullImage(
    reference: string,
    registryAuth?: RuntimeRegistryAuthInput | null,
  ): Promise<{
    reference: string;
    architecture: string | null;
    os: string | null;
    sizeBytes: number | null;
    layerCount: number;
    cached: boolean;
  }>;
  ensureVolume(name: string, quotaMiB?: number | null): Promise<void>;
  removeVolume(name: string): Promise<void>;
  createDetachedRuntime(input: CreateRuntimeInput): Promise<void>;
  start(
    name: string,
    command?: string[] | null,
    workingDir?: string | null,
  ): Promise<void>;
  stop(name: string): Promise<void>;
  remove(name: string, volumeName?: string | null): Promise<void>;
  exec(
    name: string,
    command: string,
    args?: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFiles(name: string, files: RuntimeFileDto[]): Promise<void>;
  readFiles(
    name: string,
    paths: string[],
  ): Promise<Array<{ path: string; content: string }>>;
  getStatus(name: string): Promise<string | null>;
  isHealthy(port: number): Promise<boolean>;
}
