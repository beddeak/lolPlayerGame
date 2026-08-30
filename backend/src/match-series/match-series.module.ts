import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { MatchesModule } from '../matches/matches.module';
import { MatchSeries } from './entities/match-series.entity';
import { MatchFeedback } from './entities/match-feedback.entity';
import { MatchFeedbackPlayerEffect } from './entities/match-feedback-player-effect.entity';
import { MatchFeedbackService } from './match-feedback.service';
import { MatchSeriesController } from './match-series.controller';
import { MatchSeriesService } from './match-series.service';

@Module({
  imports: [
    AuthModule,
    MatchesModule,
    TypeOrmModule.forFeature([
      MatchSeries,
      MatchFeedback,
      MatchFeedbackPlayerEffect,
      CareerTeam,
      CareerPlayer,
    ]),
  ],
  controllers: [MatchSeriesController],
  providers: [MatchSeriesService, MatchFeedbackService],
  exports: [MatchSeriesService],
})
export class MatchSeriesModule {}
