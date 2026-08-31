import { IsEnum } from 'class-validator';
import { CalendarAdvanceMode } from '../enums/calendar-advance-mode.enum';

export class AdvanceCalendarDto {
  @IsEnum(CalendarAdvanceMode)
  mode!: CalendarAdvanceMode;
}
