import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { MatchSimulationResponseDto } from '../../matches/dto/match-simulation-response.dto';
import { Position } from '../../players/enums/position.enum';
import { MatchSeriesStatus } from '../enums/match-series-status.enum';

export class MatchSeriesTeamResponseDto {
  teamId!: number;
  teamCode!: string;
  wins!: number;
}

export class MatchSeriesResponseDto {
  seriesId!: number;
  careerId!: number;
  bestOf!: number;
  winsRequired!: number;
  status!: MatchSeriesStatus;
  winnerTeamId!: number | null;
  nextGameNumber!: number | null;
  seed!: number;
  teams!: [MatchSeriesTeamResponseDto, MatchSeriesTeamResponseDto];
  games!: MatchSimulationResponseDto[];
}

export class MatchSeriesPlayerPlanDto {
  careerPlayerId!: number;
  position!: Position;
  playerInstruction!: PlayerInstruction | null;
  championArchetype!: ChampionArchetype | null;
}

export class MatchSeriesTeamAnalysisDto {
  teamId!: number;
  teamCode!: string;
  won!: boolean;
  teamStrategy!: TeamStrategy;
  performance!: number;
  performanceGap!: number;
  teamKills!: number;
  killGap!: number;
  totalGold!: number;
  goldGap!: number;
  gdAt15!: number;
  averageRating!: number;
  playerPlans!: MatchSeriesPlayerPlanDto[];
}

export class MatchSeriesAnalysisResponseDto {
  seriesId!: number;
  status!: MatchSeriesStatus;
  score!: [MatchSeriesTeamResponseDto, MatchSeriesTeamResponseDto];
  analyzedGameNumber!: number | null;
  adjustmentsAllowed!: boolean;
  teams!: [MatchSeriesTeamAnalysisDto, MatchSeriesTeamAnalysisDto] | null;
}
