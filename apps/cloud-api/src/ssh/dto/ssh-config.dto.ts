import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class SshConfigDto {
  @ApiPropertyOptional({
    description: 'Enable SSH access (default: true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
