import { Region } from '../../careers/enums/region.enum';
import { CalendarAdvanceMode } from '../enums/calendar-advance-mode.enum';
import { CalendarStopReason } from '../enums/calendar-stop-reason.enum';
import { CalendarEventResponseDto } from '../../event-queue/dto/calendar-event-response.dto';

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
