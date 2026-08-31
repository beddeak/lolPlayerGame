import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CalendarEventResponseDto } from './dto/calendar-event-response.dto';
import { FindCalendarEventsQueryDto } from './dto/find-calendar-events-query.dto';
import { EventQueueService } from './event-queue.service';

@Controller('careers/:careerId/events')
@UseGuards(JwtAuthGuard)
export class EventQueueController {
  constructor(private readonly eventQueueService: EventQueueService) {}

  @Get()
  findAll(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Query() query: FindCalendarEventsQueryDto,
  ): Promise<CalendarEventResponseDto[]> {
    return this.eventQueueService.findAll(account.id, careerId, query);
  }

  @Post(':eventId/resolve')
  resolve(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<CalendarEventResponseDto> {
    return this.eventQueueService.resolve(account.id, careerId, eventId);
  }
}
