import { Position } from '../../players/enums/position.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';

export interface MatchPlayerStatsResult {
  careerPlayerId: number;
  careerTeamId: number;
  position: Position;
  playerInstruction: PlayerInstruction | null;
  roleProficiency: number | null;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  dpm: number;
  damageShare: number;
  gold: number;
  goldShare: number;
  gdAt15: number;
  csdAt15: number;
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
