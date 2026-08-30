import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import {
  DEFAULT_CAREER_START_YEAR,
  INITIAL_CAREER_TEAM_COUNT,
  MAX_CAREER_TEAM_COUNT,
  MAX_BENCH_PLAYERS,
  STARTER_POSITIONS,
} from '../constants/career.constants';
import { Region } from '../enums/region.enum';

export class CreateCareerStarterDto {
  @IsInt()
  @IsPositive()
  playerCardId!: number;

  @IsEnum(Position)
  position!: Position;
}

export class CreateCareerBenchDto {
  @IsInt()
  @IsPositive()
  playerCardId!: number;
}

export class CreateCareerTeamDto {
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z0-9_]+$/)
  code!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsEnum(Region)
  region!: Region;

  @IsArray()
  @ArrayMinSize(STARTER_POSITIONS.length)
  @ArrayMaxSize(STARTER_POSITIONS.length)
  @ValidateNested({ each: true })
  @Type(() => CreateCareerStarterDto)
  starters!: CreateCareerStarterDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BENCH_PLAYERS)
  @ValidateNested({ each: true })
  @Type(() => CreateCareerBenchDto)
  benches?: CreateCareerBenchDto[];
}

export class CreateCareerDto {
  @IsOptional()
  @IsInt()
  @Min(DEFAULT_CAREER_START_YEAR)
  @Max(9999)
  startYear: number = DEFAULT_CAREER_START_YEAR;

  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z0-9_]+$/)
  managedTeamCode!: string;

  @IsArray()
  @ArrayMinSize(INITIAL_CAREER_TEAM_COUNT)
  @ArrayMaxSize(MAX_CAREER_TEAM_COUNT)
  @ValidateNested({ each: true })
  @Type(() => CreateCareerTeamDto)
  teams!: CreateCareerTeamDto[];
}
