import { Position } from '../../players/enums/position.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';

export interface MatchPlayerStatsResult {
  feedback?:
    import('../../match-series/next-set-feedback').NextSetFeedback | null;
  careerPlayerId: number;
  careerTeamId: number;
  position: Position;
  playerInstruction: PlayerInstruction | null;
  roleProficiency: number | null;
  positionProficiency: number;
  championArchetype: ChampionArchetype | null;
  form: number;
  condition: number;
  mental: number;
  formModifier: number;
  conditionModifier: number;
  mentalModifier: number;
  stateModifier: number;
  formAfter: number;
  conditionAfter: number;
  mentalAfter: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  dpm: number;
  damageShare: number;
  gold: number;
  goldShare: number;
  gdAt15: number | null;
  csdAt15: number | null;
  kp: number;
  rating: number;
}

export interface MatchTeamStatsResult {
  teamId: number;
  teamKills: number;
  playerStats: MatchPlayerStatsResult[];
}

export interface MatchStatsSimulationResult {
  durationMinutes: number;
  teams: [MatchTeamStatsResult, MatchTeamStatsResult];
}
