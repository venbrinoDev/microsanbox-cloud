import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service.js';

export interface ProxyTokenPayload {
  sub: string;
  aud: string;
  sandboxId: string;
  sandbox: string;
  runtimeId: string;
  exp: number;
}

@Injectable()
export class ProxyTokenService {
  constructor(private readonly config: AppConfigService) {}

  sign(
    sandboxId: string,
    runtimeId: string,
    sandboxName: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const expiresInSeconds = this.config.connectionTtlSeconds;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const payload: ProxyTokenPayload = {
      sub: sandboxId,
      aud: 'microsandbox-cloud-proxy',
      sandboxId,
      sandbox: sandboxName,
      runtimeId,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const encodedPayload = this.base64Url(JSON.stringify(payload));
    const signature = this.signPayload(encodedPayload);
    const token = `${encodedPayload}.${signature}`;
    return Promise.resolve({ token, expiresAt: expiresAt.toISOString() });
  }

  verify(token: string, sandboxId: string): ProxyTokenPayload {
    try {
      const [encodedPayload, signature] = token.split('.');
      if (!encodedPayload || !signature) {
        throw new Error('malformed_token');
      }
      const expected = this.signPayload(encodedPayload);
      if (!this.signatureEquals(signature, expected)) {
        throw new Error('bad_signature');
      }
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as ProxyTokenPayload;
      if (payload.aud !== 'microsandbox-cloud-proxy') {
        throw new Error('audience_mismatch');
      }
      if (payload.sandboxId !== sandboxId || payload.sub !== sandboxId) {
        throw new Error('sandbox_id_mismatch');
      }
      if (
        !Number.isFinite(payload.exp) ||
        payload.exp <= Math.floor(Date.now() / 1000)
      ) {
        throw new Error('expired_token');
      }
      return payload;
    } catch (error) {
      throw new UnauthorizedException(
        `Invalid proxy token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private signPayload(payload: string): string {
    return createHmac('sha256', this.config.proxyTokenSecret)
      .update(payload)
      .digest('base64url');
  }

  private signatureEquals(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private base64Url(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
  }
}
