import { Injectable } from '@nestjs/common';
import { dirname, join } from 'node:path';

@Injectable()
export class AppConfigService {
  private readonly cwd = process.cwd();

  get port(): number {
    return this.readInt('MICROSANDBOX_CLOUD_PORT', 3210);
  }

  get host(): string {
    return process.env.MICROSANDBOX_CLOUD_HOST?.trim() || '0.0.0.0';
  }

  get sqlitePath(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_SQLITE_PATH?.trim() ||
      join(this.cwd, 'data', 'microsandbox-cloud.sqlite')
    );
  }

  get managedVolumeRoot(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_MANAGED_VOLUME_ROOT?.trim() ||
      join(dirname(this.sqlitePath), 'volumes')
    );
  }

  get internalApiToken(): string | undefined {
    const value = process.env.MICROSANDBOX_CLOUD_INTERNAL_API_TOKEN?.trim();
    return value || undefined;
  }

  get proxyTokenSecret(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_PROXY_TOKEN_SECRET?.trim() || 'change-me'
    );
  }

  get connectionTtlSeconds(): number {
    return this.readInt('MICROSANDBOX_CLOUD_CONNECTION_TTL_SECONDS', 600);
  }

  get proxyBaseUrl(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_PROXY_BASE_URL?.trim() ||
      `http://localhost:${this.port}`
    );
  }

  get runtimeHostName(): string {
    return process.env.MICROSANDBOX_CLOUD_RUNTIME_HOST_NAME?.trim() || 'local';
  }

  get runtimeHostBaseUrl(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_RUNTIME_HOST_BASE_URL?.trim() ||
      `http://127.0.0.1:${this.port}`
    );
  }

  get runtimeHostPublicBaseUrl(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_RUNTIME_HOST_PUBLIC_BASE_URL?.trim() ||
      this.proxyBaseUrl
    );
  }

  get sandboxNamePrefix(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_SANDBOX_NAME_PREFIX?.trim() || 'runtime'
    );
  }

  get volumeNamePrefix(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_VOLUME_NAME_PREFIX?.trim() ||
      'runtime-data'
    );
  }

  get portRangeStart(): number {
    return this.readInt('MICROSANDBOX_CLOUD_PORT_RANGE_START', 31000);
  }

  get portRangeEnd(): number {
    return this.readInt('MICROSANDBOX_CLOUD_PORT_RANGE_END', 31999);
  }

  get defaultExposedPort(): number {
    return this.readInt('MICROSANDBOX_CLOUD_DEFAULT_EXPOSED_PORT', 8080);
  }

  get defaultVolumeMountPath(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_DEFAULT_VOLUME_MOUNT_PATH?.trim() ||
      '/workspace'
    );
  }

  get defaultCpu(): number {
    return this.readInt('MICROSANDBOX_CLOUD_DEFAULT_CPU', 1);
  }

  get defaultMemoryMiB(): number {
    return this.readInt('MICROSANDBOX_CLOUD_DEFAULT_MEMORY_MIB', 2048);
  }

  get defaultDiskGiB(): number {
    return this.readInt('MICROSANDBOX_CLOUD_DEFAULT_DISK_GIB', 6);
  }

  get env(): string {
    return process.env.MICROSANDBOX_ENV?.trim() || 'development';
  }

  get isDev(): boolean {
    return this.env === 'development';
  }

  get isProd(): boolean {
    return this.env === 'production';
  }

  get defaultImage(): string {
    return (
      process.env.MICROSANDBOX_CLOUD_DEFAULT_IMAGE?.trim() ||
      'nginx:stable-alpine'
    );
  }

  get healthcheckTimeoutMs(): number {
    return this.readInt('MICROSANDBOX_CLOUD_HEALTHCHECK_TIMEOUT_MS', 3000);
  }

  get runtimeReadyTimeoutMs(): number {
    return this.readInt('MICROSANDBOX_CLOUD_RUNTIME_READY_TIMEOUT_MS', 15000);
  }

  get runtimeReadyPollIntervalMs(): number {
    return this.readInt(
      'MICROSANDBOX_CLOUD_RUNTIME_READY_POLL_INTERVAL_MS',
      500,
    );
  }

  private readInt(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
}
