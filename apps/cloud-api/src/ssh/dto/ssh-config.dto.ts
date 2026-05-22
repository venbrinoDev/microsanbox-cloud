import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class SshConfigDto {
  @ApiProperty({ description: 'Enable SSH access to the sandbox' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description: 'Public keys authorized for SSH access',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  publicKeys!: string[];

  @ApiPropertyOptional({ description: 'SSH user (default: root)' })
  @IsOptional()
  @IsString()
  user?: string;

  @ApiPropertyOptional({ description: 'Container SSH port (default: 22)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  containerPort?: number;
}
