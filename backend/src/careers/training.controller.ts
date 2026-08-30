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
import {
  CreateIndividualTrainingDto,
  CreateTeamTrainingDto,
  TrainingPeriodResponseDto,
} from './dto/training.dto';
import { TrainingService } from './training.service';

@Controller('careers/:careerId/training-periods/current')
@UseGuards(JwtAuthGuard)
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Get()
  findCurrent(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ): Promise<TrainingPeriodResponseDto> {
    return this.trainingService.findCurrent(account.id, careerId);
  }

  @Post('team')
  trainTeam(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: CreateTeamTrainingDto,
  ): Promise<TrainingPeriodResponseDto> {
    return this.trainingService.trainTeam(account.id, careerId, dto);
  }

  @Post('individual')
  trainIndividual(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: CreateIndividualTrainingDto,
  ): Promise<TrainingPeriodResponseDto> {
    return this.trainingService.trainIndividual(account.id, careerId, dto);
  }
}
