import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalAuthGuard } from '../shared/internal-auth.guard.js';
import { CreateVolumeDto } from './dto/create-volume.dto.js';
import { DownloadFilesDto } from './dto/download-files.dto.js';
import {
  EnsureRuntimeDto,
  CreateSandboxDto,
} from './dto/ensure-runtime.dto.js';
import { ExecRuntimeDto } from './dto/exec-runtime.dto.js';
import { WriteFilesDto } from './dto/write-files.dto.js';
import { RuntimeControlService } from './runtime-control.service.js';

@Controller()
export class SandboxController {
  constructor(private readonly runtimeControl: RuntimeControlService) {}

  @Get('sandboxes')
  @UseGuards(InternalAuthGuard)
  list(): Promise<Record<string, unknown>> {
    return this.runtimeControl.list();
  }

  @Post('sandboxes')
  @UseGuards(InternalAuthGuard)
  create(@Body() body: CreateSandboxDto): Promise<Record<string, unknown>> {
    return this.runtimeControl.create(body);
  }

  @Post('sandboxes/ensure')
  @UseGuards(InternalAuthGuard)
  ensure(@Body() body: EnsureRuntimeDto): Promise<Record<string, unknown>> {
    return this.runtimeControl.ensure(body);
  }

  @Get('sandboxes/:sandboxIdOrName')
  @UseGuards(InternalAuthGuard)
  get(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.get(sandboxIdOrName);
  }

  @Post('sandboxes/:sandboxIdOrName/start')
  @UseGuards(InternalAuthGuard)
  start(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.start(sandboxIdOrName);
  }

  @Post('sandboxes/:sandboxIdOrName/stop')
  @UseGuards(InternalAuthGuard)
  stop(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.stop(sandboxIdOrName);
  }

  @Delete('sandboxes/:sandboxIdOrName')
  @UseGuards(InternalAuthGuard)
  delete(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.delete(sandboxIdOrName);
  }

  @Get('sandboxes/:sandboxIdOrName/ports/:port/preview-url')
  @UseGuards(InternalAuthGuard)
  previewUrl(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
    @Param('port', ParseIntPipe) port: number,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.getPreviewUrl(sandboxIdOrName, port);
  }

  @Get('sandboxes/:sandboxIdOrName/ports/:port/signed-preview-url')
  @UseGuards(InternalAuthGuard)
  signedPreviewUrl(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
    @Param('port', ParseIntPipe) port: number,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.getSignedPreviewUrl(sandboxIdOrName, port);
  }

  @Post(
    'sandboxes/:sandboxIdOrName/ports/:port/signed-preview-url/:token/expire',
  )
  @UseGuards(InternalAuthGuard)
  expireSignedPreviewUrl(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
    @Param('port', ParseIntPipe) port: number,
    @Param('token') token: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.expireSignedPreviewUrl(
      sandboxIdOrName,
      port,
      token,
    );
  }

  @Post('runtime-access/:sandboxId/exec')
  @UseGuards(InternalAuthGuard)
  exec(
    @Param('sandboxId') sandboxId: string,
    @Body() body: ExecRuntimeDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.exec(sandboxId, body.command, body.args ?? []);
  }

  @Post('runtime-access/:sandboxId/files')
  @UseGuards(InternalAuthGuard)
  writeFiles(
    @Param('sandboxId') sandboxId: string,
    @Body() body: WriteFilesDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.writeFiles(sandboxId, body.files);
  }

  @Post('runtime-access/:sandboxId/files/download')
  @UseGuards(InternalAuthGuard)
  downloadFiles(
    @Param('sandboxId') sandboxId: string,
    @Body() body: DownloadFilesDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.downloadFiles(sandboxId, body.paths);
  }

  @Get('volumes')
  @UseGuards(InternalAuthGuard)
  listVolumes(): Promise<Record<string, unknown>> {
    return this.runtimeControl.listVolumes();
  }

  @Post('volumes')
  @UseGuards(InternalAuthGuard)
  createVolume(
    @Body() body: CreateVolumeDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.createVolume(body);
  }

  @Get('volumes/:volumeIdOrName')
  @UseGuards(InternalAuthGuard)
  getVolume(
    @Param('volumeIdOrName') volumeIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.getVolume(volumeIdOrName);
  }

  @Delete('volumes/:volumeIdOrName')
  @UseGuards(InternalAuthGuard)
  deleteVolume(
    @Param('volumeIdOrName') volumeIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.deleteVolume(volumeIdOrName);
  }

  @Get('images')
  @UseGuards(InternalAuthGuard)
  listImages(): Promise<Record<string, unknown>> {
    return this.runtimeControl.listImages();
  }

  @Post('images/pull')
  @UseGuards(InternalAuthGuard)
  pullImage(
    @Body() body: { reference?: string },
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.pullImage(String(body.reference ?? '').trim());
  }

  @Get('preview/:sandboxId/public')
  previewPublic(
    @Param('sandboxId') sandboxId: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.getPreviewPublicState(sandboxId);
  }

  @Get('preview/:sandboxId/validate/:token')
  previewValidate(
    @Param('sandboxId') sandboxId: string,
    @Param('token') token: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.validatePreviewToken(sandboxId, token);
  }

  @Get('preview/:signedPreviewToken/:port/sandbox-id')
  previewResolve(
    @Param('signedPreviewToken') signedPreviewToken: string,
    @Param('port', ParseIntPipe) port: number,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.resolveSignedPreviewToken(
      signedPreviewToken,
      port,
    );
  }
}
