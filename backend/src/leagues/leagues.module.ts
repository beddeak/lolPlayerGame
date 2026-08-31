import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Career } from '../careers/entities/career.entity';
import { EventQueueModule } from '../event-queue/event-queue.module';
import { MatchSeriesModule } from '../match-series/match-series.module';
import { LeagueFixture } from './entities/league-fixture.entity';
import { LeagueSplit } from './entities/league-split.entity';
import { LeagueStageParticipant } from './entities/league-stage-participant.entity';
import { LeagueStage } from './entities/league-stage.entity';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

@Module({
  imports: [
    AuthModule,
    EventQueueModule,
    MatchSeriesModule,
    TypeOrmModule.forFeature([
      Career,
      LeagueSplit,
      LeagueStage,
      LeagueStageParticipant,
      LeagueFixture,
    ]),
  ],
  controllers: [LeaguesController],
  providers: [LeaguesService],
  exports: [LeaguesService],
})
export class LeaguesModule {}
