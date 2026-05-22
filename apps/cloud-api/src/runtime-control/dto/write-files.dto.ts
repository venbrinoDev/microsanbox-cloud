import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RuntimeFileDto } from './ensure-runtime.dto.js';

export class WriteFilesDto {
  @ApiProperty({
    description: 'Files to write into the sandbox',
    type: [RuntimeFileDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuntimeFileDto)
  files!: RuntimeFileDto[];
}
