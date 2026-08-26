import { Position } from '../../players/enums/position.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { SetBonusSnapshot } from '../../set-bonuses/set-bonus.types';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';

export class MatchPlayerStatResponseDto {
  careerPlayerId!: number;
  position!: Position;
  playerInstruction!: PlayerInstruction | null;
  roleProficiency!: number | null;
  championArchetype!: ChampionArchetype | null;
  kills!: number;
  deaths!: number;
  assists!: number;
  kda!: number;
  dpm!: number;
  damageShare!: number;
  gold!: number;
  goldShare!: number;
  gdAt15!: number;
  csdAt15!: number;
  kp!: number;
  rating!: number;
}

export class MatchTeamSimulationResponseDto {
  teamId!: number;
  teamCode!: string;
  teamStrategy!: TeamStrategy;
  strategyProficiency!: number;
  strategyProficiencyModifier!: number;
  metaModifier!: number;
  chemistry!: number;
  effectiveChemistry!: number;
  chemistryModifier!: number;
  activeSetBonuses!: SetBonusSnapshot[];
  setBonusModifier!: number;
  archetypeModifier!: number;
  baseAbility!: number;
  rngModifier!: number;
  performance!: number;
  teamKills!: number;
  playerStats!: MatchPlayerStatResponseDto[];
}

export class MatchSimulationResponseDto {
  matchId!: number;
  careerId!: number;
  seriesId!: number | null;
  seriesGameNumber!: number | null;
  currentMeta!: TeamStrategy;
  seed!: number;
  durationMinutes!: number;
  winnerTeamId!: number;
  winnerTeamCode!: string;
  teams!: MatchTeamSimulationResponseDto[];
}
