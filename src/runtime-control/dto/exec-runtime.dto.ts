import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExecRuntimeDto {
  @ApiProperty({ description: 'Command to execute inside the sandbox' })
  @IsString()
  command!: string;

  @ApiPropertyOptional({ description: 'Command arguments' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];
}
