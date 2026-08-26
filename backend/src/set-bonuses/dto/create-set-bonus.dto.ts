import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SET_BONUS_CHEMISTRY_BONUS_MAX,
  SET_BONUS_CHEMISTRY_BONUS_MIN,
  SET_BONUS_REQUIREMENT_MIN,
  SET_BONUS_STAT_BONUS_MAX,
  SET_BONUS_STAT_BONUS_MIN,
} from '../constants/set-bonus.constants';

export class CreateSetBonusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsArray()
  @ArrayMinSize(SET_BONUS_REQUIREMENT_MIN)
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  requiredPlayerCardIds!: number[];

  @IsOptional()
  @IsInt()
  @Min(SET_BONUS_CHEMISTRY_BONUS_MIN)
  @Max(SET_BONUS_CHEMISTRY_BONUS_MAX)
  chemistryBonus?: number;

  @IsOptional()
  @IsInt()
  @Min(SET_BONUS_STAT_BONUS_MIN)
  @Max(SET_BONUS_STAT_BONUS_MAX)
  laningBonus?: number;

  @IsOptional()
  @IsInt()
  @Min(SET_BONUS_STAT_BONUS_MIN)
  @Max(SET_BONUS_STAT_BONUS_MAX)
  teamFightBonus?: number;

  @IsOptional()
  @IsInt()
  @Min(SET_BONUS_STAT_BONUS_MIN)
  @Max(SET_BONUS_STAT_BONUS_MAX)
  macroBonus?: number;

  @IsOptional()
  @IsInt()
  @Min(SET_BONUS_STAT_BONUS_MIN)
  @Max(SET_BONUS_STAT_BONUS_MAX)
  teamPlayBonus?: number;
}
