import { Position } from '../enums/position.enum';

export class PlayerCardResponseDto {
  id!: number;
  playerId!: number;
  themeId!: number;
  cardYear!: number;
  startingAge!: number;
  mainPosition!: Position;
  mechanics!: number;
  gameSense!: number;
  laning!: number;
  teamFight!: number;
  macro!: number;
  teamPlay!: number;
  mental!: number;
  championPool!: number;
}
