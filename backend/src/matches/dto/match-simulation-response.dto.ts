import { Position } from '../../players/enums/position.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';

export class MatchPlayerStatResponseDto {
  careerPlayerId!: number;
  position!: Position;
  playerInstruction!: PlayerInstruction | null;
  roleProficiency!: number | null;
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
  baseAbility!: number;
  rngModifier!: number;
  performance!: number;
  teamKills!: number;
  playerStats!: MatchPlayerStatResponseDto[];
}

export class MatchSimulationResponseDto {
  matchId!: number;
  careerId!: number;
  seed!: number;
  durationMinutes!: number;
  winnerTeamId!: number;
  winnerTeamCode!: string;
  teams!: MatchTeamSimulationResponseDto[];
}
