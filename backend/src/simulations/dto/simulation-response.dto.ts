import { CalendarResponseDto } from '../../calendars/dto/calendar-response.dto';
import { CalendarEventResponseDto } from '../../event-queue/dto/calendar-event-response.dto';
import { LeagueSplitResponseDto } from '../../leagues/dto/league-split-response.dto';
import { MatchSeriesResponseDto } from '../../match-series/dto/match-series-response.dto';
import { FastSimStopReason } from '../enums/fast-sim-stop-reason.enum';
import { SimulationMode } from '../enums/simulation-mode.enum';

export class QuickSimResponseDto {
  mode!: SimulationMode.QUICK;
  fixtureId!: number;
  gamesSimulated!: number;
  series!: MatchSeriesResponseDto;
  split!: LeagueSplitResponseDto;
}

export class FastSimFixtureResponseDto {
  fixtureId!: number;
  leagueSplitId!: number;
  scheduledDate!: string;
  seriesId!: number;
  bestOf!: number;
  gamesSimulated!: number;
  teamAId!: number;
  teamBId!: number;
  teamAWins!: number;
  teamBWins!: number;
  winnerTeamId!: number;
}

export class FastSimResponseDto {
  mode!: SimulationMode.FAST;
  careerId!: number;
  previousDate!: string;
  currentDate!: string;
  targetDate!: string;
  advancedDays!: number;
  stopReason!: FastSimStopReason;
  fixtureLimit!: number;
  simulatedFixtures!: FastSimFixtureResponseDto[];
  blockingEvents!: CalendarEventResponseDto[];
  calendar!: CalendarResponseDto;
}
