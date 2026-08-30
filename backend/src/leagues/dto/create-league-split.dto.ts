import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { Region } from '../../careers/enums/region.enum';
import { LEAGUE_CONFIG } from '../config/league.config';

export class CreateLeagueSplitDto {
  @IsEnum(Region)
  region!: Region;

  @IsInt()
  @Min(LEAGUE_CONFIG.minSplitNumber)
  @Max(LEAGUE_CONFIG.maxSplitNumber)
  splitNumber!: number;
}
