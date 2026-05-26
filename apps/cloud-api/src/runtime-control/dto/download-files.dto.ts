import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DownloadFilesDto {
  @ApiProperty({ description: 'File paths to download from the sandbox' })
  @IsArray()
  @IsString({ each: true })
  paths!: string[];
}
