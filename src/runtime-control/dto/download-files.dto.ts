import { IsArray, IsString } from 'class-validator';

export class DownloadFilesDto {
  @IsArray()
  @IsString({ each: true })
  paths!: string[];
}
