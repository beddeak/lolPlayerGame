import { Region } from '../../careers/enums/region.enum';
import { CalendarAdvanceMode } from '../enums/calendar-advance-mode.enum';
import { CalendarStopReason } from '../enums/calendar-stop-reason.enum';
import { CalendarEventResponseDto } from '../../event-queue/dto/calendar-event-response.dto';
import type { TransferWindowState } from '../../transfers/transfer-window';
import type { FullSeasonCalendar } from '../config/full-season-calendar';
import type { ManagerOverview } from '../../manager-career/manager-overview';

export interface ScheduleWarning {
  fixtureId: number;
  leagueSplitId: number;
  scheduledDate: string;
  expectedEndDate: string;
  message: string;
}

export class CalendarTeamResponseDto {
  id!: number;
  code!: string;
  name!: string;
}

export class CalendarFixtureResponseDto {
  id!: number;
  scheduledDate!: string;
  leagueSplitId!: number;
  leagueStageId!: number;
  year!: number;
  region!: Region;
  splitNumber!: number;
  stageCode!: string;
  roundNumber!: number;
  bestOf!: number;
  teamA!: CalendarTeamResponseDto;
  teamB!: CalendarTeamResponseDto;
}

export class CalendarResponseDto {
  careerId!: number;
  currentDate!: string;
  currentYear!: number;
  manager!: ManagerOverview;
  autoSchedule!: boolean;
  season!: FullSeasonCalendar;
  scheduleWarnings!: ScheduleWarning[];
  seasonReadiness!: Array<{
    region: Region;
    teamCount: number;
    status:
      | 'READY'
      | 'INSUFFICIENT_TEAMS'
      | 'WAITING_FOR_PREVIOUS_SPLIT'
      | 'NO_REMAINING_SPLIT';
    splitNumber: number | null;
    message: string;
  }>;
  transferWindow!: TransferWindowState;
  canCloseTransferWindow!: boolean;
  nextMatch!: CalendarFixtureResponseDto | null;
  dueMatches!: CalendarFixtureResponseDto[];
  blockingEvents!: CalendarEventResponseDto[];
}

export class CalendarAdvanceResponseDto extends CalendarResponseDto {
  mode!: CalendarAdvanceMode;
  previousDate!: string;
  advancedDays!: number;
  stopReason!: CalendarStopReason;
  processedEvents!: CalendarEventResponseDto[];
}
