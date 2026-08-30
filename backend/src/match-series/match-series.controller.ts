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
import { CreateMatchSeriesDto } from './dto/create-match-series.dto';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackResponseDto } from './dto/feedback-response.dto';
import {
  MatchSeriesAnalysisResponseDto,
  MatchSeriesResponseDto,
} from './dto/match-series-response.dto';
import { MatchSeriesService } from './match-series.service';
import { MatchFeedbackService } from './match-feedback.service';

@Controller('match-series')
@UseGuards(JwtAuthGuard)
export class MatchSeriesController {
  constructor(
    private readonly matchSeriesService: MatchSeriesService,
    private readonly matchFeedbackService: MatchFeedbackService,
  ) {}

  @Post()
  create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() dto: CreateMatchSeriesDto,
  ): Promise<MatchSeriesResponseDto> {
    return this.matchSeriesService.create(account.id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MatchSeriesResponseDto> {
    return this.matchSeriesService.findOne(account.id, id);
  }

  @Get(':id/analysis')
  analyze(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MatchSeriesAnalysisResponseDto> {
    return this.matchSeriesService.analyze(account.id, id);
  }

  @Get(':id/feedbacks')
  findFeedbacks(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<FeedbackResponseDto[]> {
    return this.matchFeedbackService.findAll(account.id, id);
  }

  @Post(':id/feedback')
  createFeedback(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFeedbackDto,
  ): Promise<FeedbackResponseDto> {
    return this.matchFeedbackService.create(account.id, id, dto);
  }

  @Post(':id/games/simulate')
  simulateNextGame(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MatchSeriesResponseDto> {
    return this.matchSeriesService.simulateNextGame(account.id, id);
  }
}
