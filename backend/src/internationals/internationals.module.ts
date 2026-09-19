import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { MatchSeriesModule } from '../match-series/match-series.module';
import { EventQueueModule } from '../event-queue/event-queue.module';
import { InternationalTournament } from './entities/international-tournament.entity';
import { InternationalFixture } from './entities/international-fixture.entity';
import { InternationalsController } from './internationals.controller';
import { InternationalsService } from './internationals.service';

@Module({
  imports: [
    AuthModule,
    LeaguesModule,
    MatchSeriesModule,
    EventQueueModule,
    TypeOrmModule.forFeature([InternationalTournament, InternationalFixture]),
  ],
  controllers: [InternationalsController],
  providers: [InternationalsService],
  exports: [InternationalsService],
})
export class InternationalsModule {}
