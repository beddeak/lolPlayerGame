import { Position } from '../../players/enums/position.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { SetBonusSnapshot } from '../../set-bonuses/set-bonus.types';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';

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
  form: number;
  condition: number;
  playerInstruction: PlayerInstruction | null;
  roleProficiency: number | null;
  championArchetype: ChampionArchetype | null;
}

export interface SimpleMatchTeamInput {
  teamId: number;
  teamCode: string;
  teamStrategy: TeamStrategy;
  strategyProficiency: number;
  chemistry: number;
  activeSetBonuses: SetBonusSnapshot[];
  players: SimpleMatchPlayerInput[];
}

export interface SimpleMatchTeamResult {
  teamId: number;
  teamCode: string;
  teamStrategy: TeamStrategy;
  strategyProficiency: number;
  strategyProficiencyModifier: number;
  metaModifier: number;
  chemistry: number;
  effectiveChemistry: number;
  chemistryModifier: number;
  activeSetBonuses: SetBonusSnapshot[];
  setBonusModifier: number;
  archetypeModifier: number;
  stateModifier: number;
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
