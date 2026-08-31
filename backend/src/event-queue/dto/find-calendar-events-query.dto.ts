import { IsEnum, IsOptional } from 'class-validator';
import { CalendarEventStatus } from '../enums/calendar-event-status.enum';

export class FindCalendarEventsQueryDto {
  @IsOptional()
  @IsEnum(CalendarEventStatus)
  status?: CalendarEventStatus;
}
