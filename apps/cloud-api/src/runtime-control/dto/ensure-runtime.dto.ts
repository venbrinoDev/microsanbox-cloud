import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SshConfigDto } from '../../ssh/dto/ssh-config.dto.js';

export class RuntimeFileDto {
  @ApiProperty({ description: 'File path inside the sandbox' })
  @IsString()
  path!: string;

  @ApiProperty({ description: 'File content' })
  @IsString()
  content!: string;
}

export class RuntimeSecretDto {
  @ApiProperty({ description: 'Environment variable name' })
  @IsString()
  env!: string;

  @ApiProperty({ description: 'Secret value' })
  @IsString()
  value!: string;

  @ApiPropertyOptional({ description: 'Placeholder text to replace in files' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiPropertyOptional({ description: 'Allowed origin hosts for this secret' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedHosts?: string[];

  @ApiPropertyOptional({ description: 'Allowed host patterns (glob)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedHostPatterns?: string[];

  @ApiPropertyOptional({
    description: 'Allow injection on any host (dangerous)',
  })
  @IsOptional()
  @IsBoolean()
  allowAnyHostDangerous?: boolean;

  @ApiPropertyOptional({ description: 'Require TLS identity match' })
  @IsOptional()
  @IsBoolean()
  requireTlsIdentity?: boolean;

  @ApiPropertyOptional({ description: 'Inject secret as HTTP headers' })
  @IsOptional()
  @IsBoolean()
  injectHeaders?: boolean;

  @ApiPropertyOptional({ description: 'Inject secret as Basic auth' })
  @IsOptional()
  @IsBoolean()
  injectBasicAuth?: boolean;

  @ApiPropertyOptional({ description: 'Inject secret as query parameter' })
  @IsOptional()
  @IsBoolean()
  injectQuery?: boolean;

  @ApiPropertyOptional({ description: 'Inject secret as request body' })
  @IsOptional()
  @IsBoolean()
  injectBody?: boolean;
}

export class RuntimePortDto {
  @ApiPropertyOptional({ description: 'Port binding name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Container port to expose', minimum: 1 })
  @IsInt()
  @Min(1)
  containerPort!: number;

  @ApiPropertyOptional({ enum: ['tcp', 'udp'], description: 'Port protocol' })
  @IsOptional()
  @IsIn(['tcp', 'udp'])
  protocol?: 'tcp' | 'udp';
}

export class RuntimeResourcesDto {
  @ApiPropertyOptional({ description: 'Number of CPU cores', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  cpu?: number;

  @ApiPropertyOptional({ description: 'Memory in MiB', minimum: 128 })
  @IsOptional()
  @IsInt()
  @Min(128)
  memoryMiB?: number;

  @ApiPropertyOptional({ description: 'Disk size in GiB', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  diskGiB?: number;
}

export class RuntimeVolumeMountDto {
  @ApiProperty({ description: 'Volume ID or name' })
  @IsString()
  volumeId!: string;

  @ApiProperty({ description: 'Mount path inside the sandbox' })
  @IsString()
  mountPath!: string;

  @ApiPropertyOptional({ description: 'Subpath within the volume' })
  @IsOptional()
  @IsString()
  subpath?: string;

  @ApiPropertyOptional({ description: 'Mount as read-only' })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

export class RuntimeRegistryAuthDto {
  @ApiProperty({ description: 'Registry server URL' })
  @IsString()
  server!: string;

  @ApiProperty({ description: 'Registry username' })
  @IsString()
  username!: string;

  @ApiProperty({ description: 'Registry password or token' })
  @IsString()
  password!: string;
}

class SandboxSpecDto {
  @ApiPropertyOptional({ description: 'Human-readable sandbox name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'OCI container image reference' })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({
    description: 'Command to run instead of image default',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  command?: string[];

  @ApiPropertyOptional({
    description: 'Environment variables',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  env?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Files to write into the sandbox',
    type: [RuntimeFileDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimeFileDto)
  files?: RuntimeFileDto[];

  @ApiPropertyOptional({
    description: 'Runtime secrets configuration',
    type: [RuntimeSecretDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimeSecretDto)
  secrets?: RuntimeSecretDto[];

  @ApiPropertyOptional({ description: 'Working directory inside sandbox' })
  @IsOptional()
  @IsString()
  workingDir?: string;

  @ApiPropertyOptional({ description: 'Primary exposed port' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimePortDto)
  primaryPort?: RuntimePortDto;

  @ApiPropertyOptional({ description: 'Port bindings', type: [RuntimePortDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimePortDto)
  ports?: RuntimePortDto[];

  @ApiPropertyOptional({
    description: 'Resource limits',
    type: () => RuntimeResourcesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeResourcesDto)
  resources?: RuntimeResourcesDto;

  @ApiPropertyOptional({
    description: 'Volume mounts',
    type: [RuntimeVolumeMountDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimeVolumeMountDto)
  volumes?: RuntimeVolumeMountDto[];

  @ApiPropertyOptional({ description: 'Container registry authentication' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeRegistryAuthDto)
  registryAuth?: RuntimeRegistryAuthDto;

  @ApiPropertyOptional({ description: 'Allow public (unauthenticated) access' })
  @IsOptional()
  @IsBoolean()
  public?: boolean;

  @ApiPropertyOptional({
    description: 'Auto-stop after N minutes of inactivity',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  autoStopMinutes?: number;

  @ApiPropertyOptional({ description: 'Ephemeral sandbox (deleted on stop)' })
  @IsOptional()
  @IsBoolean()
  ephemeral?: boolean;

  @ApiPropertyOptional({ description: 'SSH access configuration' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SshConfigDto)
  ssh?: SshConfigDto;
}

export class CreateSandboxDto extends SandboxSpecDto {}

export class UpdateSandboxDto extends SandboxSpecDto {
  @IsOptional()
  @IsBoolean()
  forceRecreate?: boolean;

  @IsOptional()
  @IsBoolean()
  refreshActivity?: boolean;
}

export class EnsureRuntimeDto extends SandboxSpecDto {
  @IsOptional()
  @IsString()
  sandboxId?: string;

  @IsOptional()
  @IsBoolean()
  forceRecreate?: boolean;

  @IsOptional()
  @IsBoolean()
  refreshActivity?: boolean;
}
