import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { SetBonus } from '../set-bonuses/entities/set-bonus.entity';
import { MatchPlayerStat } from './entities/match-player-stat.entity';
import { Match } from './entities/match.entity';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchTacticalRun } from './entities/match-tactical-run.entity';
import { MatchTacticalChunk } from './entities/match-tactical-chunk.entity';
import { TacticalRunsService } from './tactical-runs.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      CareerTeam,
      Match,
      MatchPlayerStat,
      SetBonus,
      MatchTacticalRun,
      MatchTacticalChunk,
    ]),
  ],
  controllers: [MatchesController],
  providers: [MatchesService, TacticalRunsService],
  exports: [MatchesService],
})
export class MatchesModule {}
