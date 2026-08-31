import { PlayerCardResponseDto } from '../../players/dto/player-card-response.dto';
import { SetBonusResponseDto } from '../../set-bonuses/dto/set-bonus-response.dto';
import { Position } from '../../players/enums/position.enum';
import { PlayerPersonality } from '../../players/enums/player-personality.enum';
import { PlayerInstruction } from '../enums/player-instruction.enum';
import { Region } from '../enums/region.enum';
import { RosterRole } from '../enums/roster-role.enum';
import { TeamStrategy } from '../enums/team-strategy.enum';
import { ChampionArchetype } from '../enums/champion-archetype.enum';

export class CareerPlayerRoleProficiencyResponseDto {
  position!: Position;
  instruction!: PlayerInstruction;
  proficiency!: number;
}

export class CareerPlayerPositionProficiencyResponseDto {
  position!: Position;
  proficiency!: number;
}

export class CareerTeamStrategyProficiencyResponseDto {
  strategy!: TeamStrategy;
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
  form!: number;
  condition!: number;
  personality!: PlayerPersonality;
  coachTrust!: number;
  playerCard!: PlayerCardResponseDto;
  roleProficiencies!: CareerPlayerRoleProficiencyResponseDto[];
  positionProficiencies!: CareerPlayerPositionProficiencyResponseDto[];
}

export class RosterResponseDto {
  id!: number;
  role!: RosterRole;
  starterPosition!: Position | null;
  playerInstruction!: PlayerInstruction | null;
  championArchetype!: ChampionArchetype | null;
  careerPlayer!: CareerPlayerResponseDto;
}

export class CareerTeamResponseDto {
  id!: number;
  code!: string;
  name!: string;
  region!: Region;
  isUserControlled!: boolean;
  teamStrategy!: TeamStrategy;
  chemistry!: number;
  strategyProficiencies!: CareerTeamStrategyProficiencyResponseDto[];
  activeSetBonuses!: SetBonusResponseDto[];
  starters!: RosterResponseDto[];
  benches!: RosterResponseDto[];
}

export class CareerResponseDto {
  id!: number;
  startYear!: number;
  currentYear!: number;
  currentDate!: string;
  currentMeta!: TeamStrategy;
  teams!: CareerTeamResponseDto[];
}

export class CareerSummaryResponseDto {
  id!: number;
  startYear!: number;
  currentYear!: number;
  currentDate!: string;
  currentMeta!: TeamStrategy;
  managedTeamId!: number;
  managedTeamCode!: string;
  managedTeamName!: string;
}
