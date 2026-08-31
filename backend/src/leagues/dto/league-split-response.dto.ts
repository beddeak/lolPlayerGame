import { MatchSeriesResponseDto } from '../../match-series/dto/match-series-response.dto';
import { Region } from '../../careers/enums/region.enum';
import { LeagueFixtureStatus } from '../enums/league-fixture-status.enum';
import { LeagueStageFormat } from '../enums/league-stage-format.enum';
import { LeagueStageStatus } from '../enums/league-stage-status.enum';
import { LeagueSplitStatus } from '../enums/league-split-status.enum';
import { LeagueStageSettings } from '../league-format.types';

export class LeagueFixtureTeamResponseDto {
  id!: number;
  code!: string;
  name!: string;
}

export class LeagueFixtureResponseDto {
  id!: number;
  leagueStageId!: number;
  fixtureNumber!: number;
  stageFixtureNumber!: number;
  roundNumber!: number;
  scheduledDate!: string;
  bestOf!: number;
  seed!: number;
  status!: LeagueFixtureStatus;
  seriesId!: number | null;
  teamA!: LeagueFixtureTeamResponseDto;
  teamB!: LeagueFixtureTeamResponseDto;
  teamAWins!: number;
  teamBWins!: number;
  winnerTeamId!: number | null;
}

export class LeagueStandingResponseDto {
  rank!: number;
  teamId!: number;
  teamCode!: string;
  teamName!: string;
  played!: number;
  seriesWins!: number;
  seriesLosses!: number;
  gameWins!: number;
  gameLosses!: number;
  gameDifference!: number;
}

export class LeagueStageParticipantResponseDto {
  teamId!: number;
  teamCode!: string;
  teamName!: string;
  initialSeed!: number;
  groupCode!: string | null;
}

export class LeagueStageResponseDto {
  id!: number;
  sequence!: number;
  code!: string;
  name!: string;
  format!: LeagueStageFormat;
  status!: LeagueStageStatus;
  bestOf!: number;
  currentRound!: number;
  settings!: LeagueStageSettings;
  participants!: LeagueStageParticipantResponseDto[];
  fixtures!: LeagueFixtureResponseDto[];
  standings!: LeagueStandingResponseDto[];
}

export class LeagueSplitResponseDto {
  id!: number;
  careerId!: number;
  year!: number;
  region!: Region;
  splitNumber!: number;
  name!: string;
  expectedTeamCount!: number;
  status!: LeagueSplitStatus;
  activeStageCode!: string | null;
  stages!: LeagueStageResponseDto[];
  fixtures!: LeagueFixtureResponseDto[];
  standings!: LeagueStandingResponseDto[];
}

export class LeagueFixtureGameResponseDto {
  fixtureId!: number;
  series!: MatchSeriesResponseDto;
  split!: LeagueSplitResponseDto;
}
