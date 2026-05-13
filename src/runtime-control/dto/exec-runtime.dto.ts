import { IsArray, IsOptional, IsString } from 'class-validator';

export class ExecRuntimeDto {
  @IsString()
  command!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];
}
