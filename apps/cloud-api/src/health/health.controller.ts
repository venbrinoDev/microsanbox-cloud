import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RuntimeRegistryService } from '../runtime-registry/runtime-registry.service.js';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly registry: RuntimeRegistryService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns service health status',
  })
  async health(): Promise<Record<string, unknown>> {
    await this.registry.ensureLocalHost();
    return {
      ok: true,
      service: 'microsandbox-cloud',
      timestamp: new Date().toISOString(),
    };
  }
}
