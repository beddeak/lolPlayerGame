import { IsIn, IsInt, IsOptional, IsPositive, Max, Min } from 'class-validator';
import { MATCH_SERIES_CONFIG } from '../config/bo3-series.config';
import type { MatchSeriesBestOf } from '../config/bo3-series.config';

const UINT32_MAX = 0xffff_ffff;

export class CreateMatchSeriesDto {
  @IsInt()
  @IsPositive()
  careerId!: number;

  @IsInt()
  @IsPositive()
  teamAId!: number;

  @IsInt()
  @IsPositive()
  teamBId!: number;

  @IsInt()
  @Min(0)
  @Max(UINT32_MAX)
  seed!: number;

  @IsOptional()
  @IsInt()
  @IsIn(MATCH_SERIES_CONFIG.allowedBestOf)
  bestOf?: MatchSeriesBestOf;
}
