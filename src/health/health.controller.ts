import { Controller, Get } from '@nestjs/common';
import { RuntimeRegistryService } from '../runtime-registry/runtime-registry.service.js';

@Controller()
export class HealthController {
  constructor(private readonly registry: RuntimeRegistryService) {}

  @Get('health')
  async health(): Promise<Record<string, unknown>> {
    await this.registry.ensureLocalHost();
    return {
      ok: true,
      service: 'microsandbox-cloud',
      timestamp: new Date().toISOString(),
    };
  }
}
