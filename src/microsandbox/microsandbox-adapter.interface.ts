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
  volumeName?: string | null;
  volumeMountPath?: string | null;
  image: string;
  command?: string[] | null;
  workingDir?: string | null;
  ports: Array<{
    hostPort: number;
    containerPort: number;
    protocol: 'tcp' | 'udp';
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
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  remove(name: string, volumeName?: string | null): Promise<void>;
  exec(
    name: string,
    command: string,
    args?: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFiles(name: string, files: RuntimeFileDto[]): Promise<void>;
  getStatus(name: string): Promise<string | null>;
  isHealthy(port: number): Promise<boolean>;
}
