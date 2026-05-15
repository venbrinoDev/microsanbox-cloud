import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVolumeDto {
  @ApiProperty({ description: 'Volume name' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Storage quota in MiB', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quotaMiB?: number;
}
