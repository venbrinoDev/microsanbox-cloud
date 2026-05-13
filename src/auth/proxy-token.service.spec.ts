import { UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { ProxyTokenService } from './proxy-token.service.js';

describe('ProxyTokenService', () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.MICROSANDBOX_CLOUD_PROXY_TOKEN_SECRET;
    process.env.MICROSANDBOX_CLOUD_PROXY_TOKEN_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.MICROSANDBOX_CLOUD_PROXY_TOKEN_SECRET;
    } else {
      process.env.MICROSANDBOX_CLOUD_PROXY_TOKEN_SECRET = originalSecret;
    }
  });

  it('signs and verifies runtime-scoped proxy tokens', async () => {
    const service = new ProxyTokenService(new AppConfigService());

    const signed = await service.sign('runtime-1', 'id-1', 'sandbox-1');
    const payload = service.verify(signed.token, 'runtime-1');

    expect(payload.sub).toBe('runtime-1');
    expect(payload.aud).toBe('microsandbox-cloud-proxy');
    expect(payload.sandboxId).toBe('runtime-1');
    expect(payload.sandbox).toBe('sandbox-1');
    expect(payload.runtimeId).toBe('id-1');
  });

  it('rejects tokens for a different runtime key', async () => {
    const service = new ProxyTokenService(new AppConfigService());

    const signed = await service.sign('runtime-1', 'id-1', 'sandbox-1');

    expect(() => service.verify(signed.token, 'runtime-2')).toThrow(
      UnauthorizedException,
    );
  });
});
