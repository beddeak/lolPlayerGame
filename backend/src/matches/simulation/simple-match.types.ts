import { Position } from '../../players/enums/position.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';

export interface SimpleMatchPlayerStats {
  mechanics: number;
  gameSense: number;
  laning: number;
  teamFight: number;
  macro: number;
  teamPlay: number;
  mental: number;
  championPool: number;
}

export type SimpleMatchStatKey = keyof SimpleMatchPlayerStats;

export interface SimpleMatchPlayerInput extends SimpleMatchPlayerStats {
  careerPlayerId: number;
  position: Position;
  playerInstruction: PlayerInstruction | null;
  roleProficiency: number | null;
}

export interface SimpleMatchTeamInput {
  teamId: number;
  teamCode: string;
  teamStrategy: TeamStrategy;
  strategyProficiency: number;
  players: SimpleMatchPlayerInput[];
}

export interface SimpleMatchTeamResult {
  teamId: number;
  teamCode: string;
  teamStrategy: TeamStrategy;
  strategyProficiency: number;
  strategyProficiencyModifier: number;
  metaModifier: number;
  baseAbility: number;
  rngModifier: number;
  performance: number;
}

export interface SimpleMatchSimulationResult {
  seed: number;
  currentMeta: TeamStrategy;
  winnerTeamId: number;
  winnerTeamCode: string;
  teams: [SimpleMatchTeamResult, SimpleMatchTeamResult];
}
