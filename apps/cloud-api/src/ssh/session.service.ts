import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service.js';
import { SshSessionEntity } from './entities/ssh-session.entity.js';

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

@Injectable()
export class SshSessionService {
  constructor(
    @InjectRepository(SshSessionEntity)
    private readonly repo: Repository<SshSessionEntity>,
    private readonly config: AppConfigService,
  ) {}

  async createSession(
    sandboxId: string,
    hostPort: number,
  ): Promise<SshSessionResult> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.connectionTtlSeconds * 1000,
    );

    await this.repo.save({
      token,
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
      expiresAt: expiresAt.toISOString(),
      sshCommand,
    };
  }

  async validateSession(token: string): Promise<SshValidateResult | null> {
    const session = await this.repo.findOne({ where: { token } });
    if (!session) {
      return null;
    }
    if (session.revoked || session.expiresAt < new Date()) {
      return null;
    }
    return {
      sandboxId: session.sandboxId,
      hostPort: session.hostPort,
    };
  }

  async revokeSession(token: string): Promise<boolean> {
    const result = await this.repo.update({ token }, { revoked: true });
    return (result.affected ?? 0) > 0;
  }

  async cleanExpired(): Promise<number> {
    const result = await this.repo.delete({
      revoked: true,
    });
    return result.affected ?? 0;
  }
}
