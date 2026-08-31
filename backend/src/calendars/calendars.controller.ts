import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CalendarsService } from './calendars.service';
import { AdvanceCalendarDto } from './dto/advance-calendar.dto';
import {
  CalendarAdvanceResponseDto,
  CalendarResponseDto,
} from './dto/calendar-response.dto';

@Controller('careers/:careerId/calendar')
@UseGuards(JwtAuthGuard)
export class CalendarsController {
  constructor(private readonly calendarsService: CalendarsService) {}

  @Get()
  findOne(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ): Promise<CalendarResponseDto> {
    return this.calendarsService.findOne(account.id, careerId);
  }

  @Post('advance')
  advance(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: AdvanceCalendarDto,
  ): Promise<CalendarAdvanceResponseDto> {
    return this.calendarsService.advance(account.id, careerId, dto);
  }
}
