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

export class RuntimeFileDto {
  @IsString()
  path!: string;

  @IsString()
  content!: string;
}

export class RuntimeSecretDto {
  @IsString()
  env!: string;

  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  placeholder?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedHosts?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedHostPatterns?: string[];

  @IsOptional()
  @IsBoolean()
  allowAnyHostDangerous?: boolean;

  @IsOptional()
  @IsBoolean()
  requireTlsIdentity?: boolean;

  @IsOptional()
  @IsBoolean()
  injectHeaders?: boolean;

  @IsOptional()
  @IsBoolean()
  injectBasicAuth?: boolean;

  @IsOptional()
  @IsBoolean()
  injectQuery?: boolean;

  @IsOptional()
  @IsBoolean()
  injectBody?: boolean;
}

export class RuntimePortDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsInt()
  @Min(1)
  containerPort!: number;

  @IsOptional()
  @IsIn(['tcp', 'udp'])
  protocol?: 'tcp' | 'udp';
}

export class RuntimeResourcesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  cpu?: number;

  @IsOptional()
  @IsInt()
  @Min(128)
  memoryMiB?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  diskGiB?: number;
}

export class EnsureRuntimeDto {
  @IsString()
  sandboxId!: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  command?: string[];

  @IsOptional()
  @IsObject()
  env?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimeFileDto)
  files?: RuntimeFileDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimeSecretDto)
  secrets?: RuntimeSecretDto[];

  @IsOptional()
  @IsString()
  workingDir?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimePortDto)
  port?: RuntimePortDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeResourcesDto)
  resources?: RuntimeResourcesDto;

  @IsOptional()
  @IsString()
  volumeMountPath?: string;

  @IsOptional()
  @IsBoolean()
  persistentVolume?: boolean;

  @IsOptional()
  @IsBoolean()
  forceRecreate?: boolean;

  @IsOptional()
  @IsBoolean()
  refreshActivity?: boolean;
}
