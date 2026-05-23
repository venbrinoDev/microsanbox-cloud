import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { InternalAuthGuard } from '../shared/internal-auth.guard.js';
import { CreateVolumeDto } from './dto/create-volume.dto.js';
import { DownloadFilesDto } from './dto/download-files.dto.js';
import {
  EnsureRuntimeDto,
  CreateSandboxDto,
  RuntimeRegistryAuthDto,
  UpdateSandboxDto,
} from './dto/ensure-runtime.dto.js';
import { ExecRuntimeDto } from './dto/exec-runtime.dto.js';
import { WriteFilesDto } from './dto/write-files.dto.js';
import { RuntimeControlService } from './runtime-control.service.js';
import type { RuntimeRegistryAuthInput } from '../microsandbox/microsandbox-adapter.interface.js';

type PullImageBody = {
  reference?: string;
  registryAuth?: RuntimeRegistryAuthDto;
};

@ApiTags('Sandbox Runtimes')
@ApiBearerAuth('internal-api')
@Controller()
export class SandboxController {
  constructor(private readonly runtimeControl: RuntimeControlService) {}

  @Get('sandboxes')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'List sandboxes',
    description: 'List all managed sandbox runtimes',
  })
  list(): Promise<Record<string, unknown>> {
    return this.runtimeControl.list();
  }

  @Post('sandboxes')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Create sandbox',
    description: 'Create and provision a new sandbox runtime',
  })
  create(@Body() body: CreateSandboxDto): Promise<Record<string, unknown>> {
    return this.runtimeControl.create(body);
  }

  @Post('sandboxes/ensure')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Ensure sandbox',
    description: 'Ensure a sandbox exists (create or return existing)',
  })
  ensure(@Body() body: EnsureRuntimeDto): Promise<Record<string, unknown>> {
    return this.runtimeControl.ensure(body);
  }

  @Put('sandboxes/:sandboxId')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Update sandbox',
    description: 'Update an existing sandbox configuration',
  })
  @ApiParam({ name: 'sandboxId', description: 'Sandbox ID' })
  update(
    @Param('sandboxId') sandboxId: string,
    @Body() body: UpdateSandboxDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.update(sandboxId, body);
  }

  @Get('sandboxes/:sandboxIdOrName')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Get sandbox',
    description: 'Get sandbox runtime details',
  })
  @ApiParam({ name: 'sandboxIdOrName', description: 'Sandbox ID or name' })
  get(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.get(sandboxIdOrName);
  }

  @Post('sandboxes/:sandboxIdOrName/start')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Start sandbox',
    description: 'Start a stopped sandbox runtime',
  })
  @ApiParam({ name: 'sandboxIdOrName', description: 'Sandbox ID or name' })
  start(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.start(sandboxIdOrName);
  }

  @Post('sandboxes/:sandboxIdOrName/stop')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Stop sandbox',
    description: 'Stop a running sandbox runtime',
  })
  @ApiParam({ name: 'sandboxIdOrName', description: 'Sandbox ID or name' })
  stop(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.stop(sandboxIdOrName);
  }

  @Delete('sandboxes/:sandboxIdOrName')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Delete sandbox',
    description: 'Delete a sandbox runtime and release resources',
  })
  @ApiParam({ name: 'sandboxIdOrName', description: 'Sandbox ID or name' })
  delete(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.delete(sandboxIdOrName);
  }

  @Get('sandboxes/:sandboxIdOrName/ports/:port/preview-url')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Get preview URL',
    description: 'Get a preview URL for accessing a sandbox port',
  })
  @ApiParam({ name: 'sandboxIdOrName', description: 'Sandbox ID or name' })
  @ApiParam({ name: 'port', description: 'Container port' })
  previewUrl(
    @Param('sandboxIdOrName') sandboxIdOrName: string,
    @Param('port', ParseIntPipe) port: number,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.getPreviewUrl(sandboxIdOrName, port);
  }

  @Get('sandboxes/:sandboxIdOrName/ports/:port/signed-preview-url')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Get signed preview URL',
    description: 'Get a time-limited signed preview URL for a sandbox port',
  })
  @ApiParam({ name: 'sandboxIdOrName', description: 'Sandbox ID or name' })
  @ApiParam({ name: 'port', description: 'Container port' })
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
  @ApiOperation({
    summary: 'Expire signed preview URL',
    description: 'Manually expire a signed preview token',
  })
  @ApiParam({ name: 'sandboxIdOrName', description: 'Sandbox ID or name' })
  @ApiParam({ name: 'port', description: 'Container port' })
  @ApiParam({ name: 'token', description: 'Signed preview token' })
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
  @ApiOperation({
    summary: 'Execute command',
    description: 'Execute a command inside a running sandbox',
  })
  @ApiParam({ name: 'sandboxId', description: 'Sandbox ID' })
  exec(
    @Param('sandboxId') sandboxId: string,
    @Body() body: ExecRuntimeDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.exec(sandboxId, body.command, body.args ?? []);
  }

  @Post('runtime-access/:sandboxId/files')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Write files',
    description: 'Write files into a running sandbox',
  })
  @ApiParam({ name: 'sandboxId', description: 'Sandbox ID' })
  writeFiles(
    @Param('sandboxId') sandboxId: string,
    @Body() body: WriteFilesDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.writeFiles(sandboxId, body.files);
  }

  @Post('runtime-access/:sandboxId/files/download')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Download files',
    description: 'Download files from a running sandbox',
  })
  @ApiParam({ name: 'sandboxId', description: 'Sandbox ID' })
  downloadFiles(
    @Param('sandboxId') sandboxId: string,
    @Body() body: DownloadFilesDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.downloadFiles(sandboxId, body.paths);
  }

  @Get('volumes')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'List volumes',
    description: 'List all managed volumes',
  })
  listVolumes(): Promise<Record<string, unknown>> {
    return this.runtimeControl.listVolumes();
  }

  @Post('volumes')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Create volume',
    description: 'Create a new persistent volume',
  })
  createVolume(
    @Body() body: CreateVolumeDto,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.createVolume(body);
  }

  @Get('volumes/:volumeIdOrName')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({ summary: 'Get volume', description: 'Get volume details' })
  @ApiParam({ name: 'volumeIdOrName', description: 'Volume ID or name' })
  getVolume(
    @Param('volumeIdOrName') volumeIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.getVolume(volumeIdOrName);
  }

  @Delete('volumes/:volumeIdOrName')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Delete volume',
    description: 'Delete a volume and its data',
  })
  @ApiParam({ name: 'volumeIdOrName', description: 'Volume ID or name' })
  deleteVolume(
    @Param('volumeIdOrName') volumeIdOrName: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.deleteVolume(volumeIdOrName);
  }

  @Get('images')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'List cached images',
    description: 'List all OCI images cached on the host',
  })
  listImages(): Promise<Record<string, unknown>> {
    return this.runtimeControl.listImages();
  }

  @Post('images/pull')
  @UseGuards(InternalAuthGuard)
  @ApiOperation({
    summary: 'Pull image',
    description: 'Pull an OCI image to the local cache',
  })
  pullImage(@Body() body: PullImageBody): Promise<Record<string, unknown>> {
    return this.runtimeControl.pullImage(
      String(body.reference ?? '').trim(),
      this.normalizeRegistryAuth(body.registryAuth),
    );
  }

  private normalizeRegistryAuth(
    input: RuntimeRegistryAuthDto | undefined,
  ): RuntimeRegistryAuthInput | null {
    if (!input) {
      return null;
    }
    const server = input.server.trim();
    const username = input.username.trim();
    const password = input.password;
    if (!server || !username || !password) {
      return null;
    }
    return {
      server,
      username,
      password,
    };
  }

  @Get('preview/:sandboxId/public')
  @ApiOperation({
    summary: 'Get preview public state',
    description: 'Check if a sandbox is publicly accessible',
  })
  @ApiParam({ name: 'sandboxId', description: 'Sandbox ID' })
  previewPublic(
    @Param('sandboxId') sandboxId: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.getPreviewPublicState(sandboxId);
  }

  @Get('preview/:sandboxId/validate/:token')
  @ApiOperation({
    summary: 'Validate preview token',
    description: 'Validate a preview access token',
  })
  @ApiParam({ name: 'sandboxId', description: 'Sandbox ID' })
  @ApiParam({ name: 'token', description: 'Preview access token' })
  previewValidate(
    @Param('sandboxId') sandboxId: string,
    @Param('token') token: string,
  ): Promise<Record<string, unknown>> {
    return this.runtimeControl.validatePreviewToken(sandboxId, token);
  }

  @Get('preview/:signedPreviewToken/:port/sandbox-id')
  @ApiOperation({
    summary: 'Resolve signed preview token',
    description: 'Resolve a signed preview token to a sandbox ID',
  })
  @ApiParam({ name: 'signedPreviewToken', description: 'Signed preview token' })
  @ApiParam({ name: 'port', description: 'Container port' })
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
