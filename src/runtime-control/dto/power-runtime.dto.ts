import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PowerRuntimeDto {
  @ApiProperty({ enum: ['start', 'stop'], description: 'Power action' })
  @IsIn(['start', 'stop'])
  action!: 'start' | 'stop';
}
