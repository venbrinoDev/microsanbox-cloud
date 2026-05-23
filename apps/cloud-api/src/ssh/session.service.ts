import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
};

interface TokenPayload {
  s: string; // sandboxId
  p: number; // hostPort
  e: number; // exp (unix ms)
}

@Injectable()
export class SshSessionService {
  constructor(
    @InjectRepository(RevokedSessionEntity)
    private readonly revokedRepo: Repository<RevokedSessionEntity>,
    private readonly config: AppConfigService,
  ) {}

  createSession(sandboxId: string, hostPort: number): SshSessionResult {
    const expiresAt = new Date(
      Date.now() + this.config.connectionTtlSeconds * 1000,
    );

    const payload: TokenPayload = {
      s: sandboxId,
      p: hostPort,
      e: expiresAt.getTime(),
    };

    const token = this.signPayload(payload);

    const host = new URL(this.config.proxyBaseUrl).hostname;
    const sshCommand = `ssh -p 2222 ${token}@${host}`;

    return {
      token,
      sandboxId,
      hostPort,
      expiresAt: expiresAt.toISOString(),
      sshCommand,
    };
  }

  async validateSession(token: string): Promise<SshValidateResult | null> {
    const payload = this.verifyToken(token);
    if (!payload) {
      return null;
    }

    if (await this.isRevoked(token)) {
      return null;
    }

    return { sandboxId: payload.s, hostPort: payload.p };
  }

  async revokeSession(token: string): Promise<boolean> {
    const hash = this.hashToken(token);
    try {
      await this.revokedRepo.save({ tokenHash: hash });
      return true;
    } catch {
      return false;
    }
  }

  async cleanExpiredRevoked(): Promise<number> {
    const result = await this.revokedRepo.delete({});
    return result.affected ?? 0;
  }

  private signPayload(payload: TokenPayload): string {
    const key = this.signingKey();
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', key).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  private verifyToken(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [encoded, sig] = parts;
    const key = this.signingKey();

    const expected = createHmac('sha256', key)
      .update(encoded)
      .digest('base64url');

    try {
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return null;
      }
    } catch {
      return null;
    }

    let payload: TokenPayload | null;
    try {
      const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
      payload = this.parseTokenPayload(decoded);
    } catch {
      return null;
    }

    if (!payload) {
      return null;
    }

    if (Date.now() > payload.e) {
      return null;
    }

    return payload;
  }

  private parseTokenPayload(raw: string): TokenPayload | null {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (
      typeof obj.s !== 'string' ||
      typeof obj.p !== 'number' ||
      typeof obj.e !== 'number'
    ) {
      return null;
    }
    return { s: obj.s, p: obj.p, e: obj.e };
  }

  private async isRevoked(token: string): Promise<boolean> {
    const hash = this.hashToken(token);
    const found = await this.revokedRepo.findOneBy({ tokenHash: hash });
    return found !== null;
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.signingKey())
      .update('revoke:' + token)
      .digest('hex');
  }

  private signingKey(): string {
    return this.config.internalApiToken ?? 'dev-key';
  }
}
