import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { MatchesModule } from '../matches/matches.module';
import { MatchSeries } from './entities/match-series.entity';
import { MatchSeriesController } from './match-series.controller';
import { MatchSeriesService } from './match-series.service';

@Module({
  imports: [
    AuthModule,
    MatchesModule,
    TypeOrmModule.forFeature([MatchSeries, CareerTeam]),
  ],
  controllers: [MatchSeriesController],
  providers: [MatchSeriesService],
  exports: [MatchSeriesService],
})
export class MatchSeriesModule {}
