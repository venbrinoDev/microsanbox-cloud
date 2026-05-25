import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service.js';
import { RevokedSessionEntity } from './entities/revoked-session.entity.js';

export type SshSessionResult = {
  token: string;
  sandboxId: string;
  hostPort: number;
  expiresAt: string;
  sshCommand: string;
};

export type SshValidateResult = {
  sandboxId: string;
  hostPort: number;
  expiresAt: string;
};

interface SessionEntry {
  sandboxId: string;
  hostPort: number;
  expiresAt: number;
}

@Injectable()
export class SshSessionService {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    @InjectRepository(RevokedSessionEntity)
    private readonly revokedRepo: Repository<RevokedSessionEntity>,
    private readonly config: AppConfigService,
  ) {}

  createSession(
    sandboxId: string,
    hostPort: number,
    expiryMinutes?: number,
  ): SshSessionResult {
    this.pruneExpired();

    const expiryMs =
      (expiryMinutes ?? this.config.connectionTtlSeconds / 60) * 60 * 1000;
    const expiresAt = Date.now() + expiryMs;

    const token = randomBytes(16).toString('base64url');
    const key = this.hash(token);

    this.sessions.set(key, {
      sandboxId,
      hostPort,
      expiresAt,
    });

    const host = new URL(this.config.proxyBaseUrl).hostname;
    const sshCommand = `ssh -p 2222 ${token}@${host}`;

    return {
      token,
      sandboxId,
      hostPort,
      expiresAt: new Date(expiresAt).toISOString(),
      sshCommand,
    };
  }

  async validateSession(token: string): Promise<SshValidateResult | null> {
    const key = this.hash(token);

    if (await this.isRevoked(key)) {
      return null;
    }

    const entry = this.sessions.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(key);
      return null;
    }

    return {
      sandboxId: entry.sandboxId,
      hostPort: entry.hostPort,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };
  }

  async revokeSession(token: string): Promise<boolean> {
    const key = this.hash(token);
    this.sessions.delete(key);

    try {
      await this.revokedRepo.save({ tokenHash: key });
      return true;
    } catch {
      return false;
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now > entry.expiresAt) {
        this.sessions.delete(key);
      }
    }
  }

  private async isRevoked(key: string): Promise<boolean> {
    const found = await this.revokedRepo.findOneBy({ tokenHash: key });
    return found !== null;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
