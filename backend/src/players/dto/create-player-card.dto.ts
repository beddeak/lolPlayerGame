import { IsEnum, IsInt, IsPositive, Max, Min } from 'class-validator';
import {
  PLAYER_CARD_STAT_MAX,
  PLAYER_CARD_STAT_MIN,
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
  cardYear!: number;

  @IsInt()
  @IsPositive()
  startingAge!: number;

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
