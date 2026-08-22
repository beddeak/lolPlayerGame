import { PlayerCardResponseDto } from '../../players/dto/player-card-response.dto';
import { Position } from '../../players/enums/position.enum';
import { PlayerInstruction } from '../enums/player-instruction.enum';
import { Region } from '../enums/region.enum';
import { RosterRole } from '../enums/roster-role.enum';
import { TeamStrategy } from '../enums/team-strategy.enum';

export class CareerPlayerRoleProficiencyResponseDto {
  position!: Position;
  instruction!: PlayerInstruction;
  proficiency!: number;
}

export class CareerPlayerResponseDto {
  id!: number;
  playerCardId!: number;
  currentTeamId!: number | null;
  currentAge!: number;
  currentPosition!: Position;
  currentMechanics!: number;
  currentGameSense!: number;
  currentLaning!: number;
  currentTeamFight!: number;
  currentMacro!: number;
  currentTeamPlay!: number;
  currentMental!: number;
  currentChampionPool!: number;
  playerCard!: PlayerCardResponseDto;
  roleProficiencies!: CareerPlayerRoleProficiencyResponseDto[];
}

export class RosterResponseDto {
  id!: number;
  role!: RosterRole;
  starterPosition!: Position | null;
  playerInstruction!: PlayerInstruction | null;
  careerPlayer!: CareerPlayerResponseDto;
}

export class CareerTeamResponseDto {
  id!: number;
  code!: string;
  name!: string;
  region!: Region;
  isUserControlled!: boolean;
  teamStrategy!: TeamStrategy;
  starters!: RosterResponseDto[];
}

export class CareerResponseDto {
  id!: number;
  startYear!: number;
  currentYear!: number;
  teams!: CareerTeamResponseDto[];
}
