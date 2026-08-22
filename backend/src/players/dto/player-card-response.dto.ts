import { Position } from '../enums/position.enum';
import { PlayerResponseDto } from './player-response.dto';
import { ThemeResponseDto } from './theme-response.dto';

export class PlayerCardResponseDto {
  id!: number;
  playerId!: number;
  themeId!: number;
  cardYear!: number;
  startingAge!: number;
  imageUrl!: string | null;
  mainPosition!: Position;
  mechanics!: number;
  gameSense!: number;
  laning!: number;
  teamFight!: number;
  macro!: number;
  teamPlay!: number;
  mental!: number;
  championPool!: number;
  player!: PlayerResponseDto;
  theme!: ThemeResponseDto;
}
