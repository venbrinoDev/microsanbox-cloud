import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ProxyTokenService } from '../auth/proxy-token.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { RuntimeControlService } from '../runtime-control/runtime-control.service.js';
import { InternalAuthGuard } from '../shared/internal-auth.guard.js';

@Controller('public/runtimes')
@UseGuards(InternalAuthGuard)
export class PublicRuntimeController {
  constructor(
    private readonly runtimeControl: RuntimeControlService,
    private readonly tokens: ProxyTokenService,
    private readonly config: AppConfigService,
  ) {}

  @Post(':sandboxId/connection')
  async createConnection(
    @Param('sandboxId') sandboxId: string,
  ): Promise<Record<string, unknown>> {
    const runtime = await this.runtimeControl.connection(sandboxId);
    const { token, expiresAt } = await this.tokens.sign(
      runtime.sandboxId,
      runtime.id,
      runtime.sandboxName,
    );
    const baseUrl = this.config.proxyBaseUrl.replace(/\/+$/g, '');
    const wsBase = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const proxyBaseUrl = `${baseUrl}/proxy/${encodeURIComponent(runtime.sandboxId)}`;
    return {
      sandboxId: runtime.sandboxId,
      runtimeId: runtime.id,
      baseUrl,
      proxyBaseUrl,
      httpUrl: `${proxyBaseUrl}/?token=${encodeURIComponent(token)}`,
      wsUrl: `${wsBase}/proxy/${encodeURIComponent(runtime.sandboxId)}/ws?token=${encodeURIComponent(token)}`,
      token,
      expiresAt,
      primaryPort: runtime.primaryPort,
      protocol: runtime.primaryPortProtocol,
    };
  }
}
