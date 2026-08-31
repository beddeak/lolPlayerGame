import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { SIMULATION_CONFIG } from '../config/simulation.config';

export class FastSimDto {
  @IsInt()
  @Min(1)
  @Max(SIMULATION_CONFIG.maxFastSimDays)
  days!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SIMULATION_CONFIG.maxFastSimFixtures)
  maxFixtures?: number;
}
