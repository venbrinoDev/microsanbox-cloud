import type { RuntimeFileDto } from '../runtime-control/dto/ensure-runtime.dto.js';

export const MICROSANDBOX_ADAPTER = Symbol('MICROSANDBOX_ADAPTER');

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
  command?: string[] | null;
  workingDir?: string | null;
  ports: Array<{
    name?: string;
    hostPort: number;
    containerPort: number;
    protocol: 'tcp' | 'udp';
  }>;
  mounts: Array<{
    hostPath: string;
    mountPath: string;
    readOnly?: boolean;
  }>;
  cpu: number;
  memoryMiB: number;
  diskGiB: number;
  env: Record<string, string>;
  secrets: RuntimeSecretInput[];
  files: RuntimeFileDto[];
}

export interface MicrosandboxAdapter {
  createDetachedRuntime(input: CreateRuntimeInput): Promise<void>;
  start(name: string, command?: string[] | null, workingDir?: string | null): Promise<void>;
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
