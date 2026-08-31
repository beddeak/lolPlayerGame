import { CalendarEventStatus } from '../enums/calendar-event-status.enum';
import { CalendarEventType } from '../enums/calendar-event-type.enum';

export class CalendarEventResponseDto {
  id!: number;
  careerId!: number;
  scheduledDate!: string;
  type!: CalendarEventType;
  status!: CalendarEventStatus;
  requiresUserAction!: boolean;
  payload!: Record<string, unknown> | null;
  createdAt!: Date;
  completedAt!: Date | null;
}
