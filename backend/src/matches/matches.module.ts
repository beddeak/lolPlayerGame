import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { MatchPlayerStat } from './entities/match-player-stat.entity';
import { Match } from './entities/match.entity';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchStatsSimulationService } from './simulation/match-stats-simulation.service';
import { SimpleMatchSimulationService } from './simulation/simple-match-simulation.service';

@Module({
  imports: [TypeOrmModule.forFeature([CareerTeam, Match, MatchPlayerStat])],
  controllers: [MatchesController],
  providers: [
    MatchesService,
    SimpleMatchSimulationService,
    MatchStatsSimulationService,
  ],
  exports: [MatchesService, SimpleMatchSimulationService],
})
export class MatchesModule {}
