import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateVolumeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quotaMiB?: number;
}
