import { IsIn } from 'class-validator';

export class PowerRuntimeDto {
  @IsIn(['start', 'stop'])
  action!: 'start' | 'stop';
}
