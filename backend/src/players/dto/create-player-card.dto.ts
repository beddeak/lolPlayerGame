import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PLAYER_CARD_STARTING_AGE_MAX,
  PLAYER_CARD_STARTING_AGE_MIN,
  PLAYER_CARD_STAT_MAX,
  PLAYER_CARD_STAT_MIN,
  PLAYER_CARD_YEAR_MAX,
  PLAYER_CARD_YEAR_MIN,
} from '../constants/player-card.constants';
import { Position } from '../enums/position.enum';

export class CreatePlayerCardDto {
  @IsInt()
  @IsPositive()
  playerId!: number;

  @IsInt()
  @IsPositive()
  themeId!: number;

  @IsInt()
  @IsPositive()
  @Min(PLAYER_CARD_YEAR_MIN)
  @Max(PLAYER_CARD_YEAR_MAX)
  cardYear!: number;

  @IsInt()
  @IsPositive()
  @Min(PLAYER_CARD_STARTING_AGE_MIN)
  @Max(PLAYER_CARD_STARTING_AGE_MAX)
  startingAge!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsEnum(Position)
  mainPosition!: Position;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  mechanics!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  gameSense!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  laning!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  teamFight!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  macro!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  teamPlay!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  mental!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  championPool!: number;

  @IsInt()
  @Min(PLAYER_CARD_STAT_MIN)
  @Max(PLAYER_CARD_STAT_MAX)
  potential!: number;
}
