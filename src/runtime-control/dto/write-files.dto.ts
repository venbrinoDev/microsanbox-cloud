import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { RuntimeFileDto } from './ensure-runtime.dto.js';

export class WriteFilesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimeFileDto)
  files!: RuntimeFileDto[];
}
