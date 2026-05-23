import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SshConfigDto {
  @ApiProperty({ description: 'Enable SSH access to the sandbox' })
  @IsBoolean()
  enabled!: boolean;
}
