import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type GuestArch = 'aarch64' | 'x86_64';

@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);
  private readonly binaryDir: string;

  constructor() {
    const raw = process.cwd();
    const root = raw.endsWith('/apps/cloud-api') ? dirname(dirname(raw)) : raw;
    this.binaryDir = join(root, 'data', 'ssh');
  }

  get guestArch(): GuestArch {
    if (process.arch === 'arm64') {
      return 'aarch64';
    }
    return 'x86_64';
  }

  getBinaryPath(arch: GuestArch): string {
    return join(
      this.binaryDir,
      `inject-sshd.linux-${arch === 'aarch64' ? 'arm64' : 'amd64'}`,
    );
  }

  readBinary(arch?: GuestArch): Buffer {
    const targetArch = arch ?? this.guestArch;
    const path = this.getBinaryPath(targetArch);
    if (!existsSync(path)) {
      this.logger.warn(`SSH binary not found at ${path}`);
      return Buffer.alloc(0);
    }
    return readFileSync(path);
  }

  binaryExists(arch?: GuestArch): boolean {
    return existsSync(this.getBinaryPath(arch ?? this.guestArch));
  }

  buildAuthorizedKeysContent(keys: string[]): string {
    return (
      keys
        .map((k) => k.trim())
        .filter(Boolean)
        .join('\n') + '\n'
    );
  }
}
