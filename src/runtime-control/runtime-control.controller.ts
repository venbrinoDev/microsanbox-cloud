import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalAuthGuard } from '../shared/internal-auth.guard.js';
import { EnsureRuntimeDto } from './dto/ensure-runtime.dto.js';
import { ExecRuntimeDto } from './dto/exec-runtime.dto.js';
import { PowerRuntimeDto } from './dto/power-runtime.dto.js';
import { WriteFilesDto } from './dto/write-files.dto.js';
import { RuntimeControlService } from './runtime-control.service.js';

@Controller('internal/runtimes')
@UseGuards(InternalAuthGuard)
export class RuntimeControlController {
  constructor(private readonly runtimeControl: RuntimeControlService) {}

  @Post('ensure')
  ensure(@Body() body: EnsureRuntimeDto): Promise<Record<string, unknown>> {
    return this.runtimeControl.ensure(body);
  }

  @Get(':sandboxId')
  get(@Param('sandboxId') sandboxId: string): Promise<Record<string, unknown>> {
    return this.runtimeControl.get(sandboxId);
  }

  @Post(':sandboxId/start')
  start(
    @Param('sandboxId') sandboxId: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.power(sandboxId, 'start');
  }

  @Post(':sandboxId/stop')
  stop(
    @Param('sandboxId') sandboxId: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.power(sandboxId, 'stop');
  }

  @Post(':sandboxId/power')
  power(
    @Param('sandboxId') sandboxId: string,
    @Body() body: PowerRuntimeDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.power(sandboxId, body.action);
  }

  @Delete(':sandboxId')
  delete(
    @Param('sandboxId') sandboxId: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.delete(sandboxId);
  }

  @Post(':sandboxId/exec')
  exec(
    @Param('sandboxId') sandboxId: string,
    @Body() body: ExecRuntimeDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.exec(sandboxId, body.command, body.args ?? []);
  }

  @Post(':sandboxId/refresh-activity')
  refreshActivity(
    @Param('sandboxId') sandboxId: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.refreshActivity(sandboxId);
  }

  @Post(':sandboxId/files')
  writeFiles(
    @Param('sandboxId') sandboxId: string,
    @Body() body: WriteFilesDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.writeFiles(sandboxId, body.files);
  }
}
