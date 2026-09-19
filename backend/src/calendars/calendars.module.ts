import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Career } from '../careers/entities/career.entity';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { EventQueueModule } from '../event-queue/event-queue.module';
import { CalendarsController } from './calendars.controller';
import { CalendarsService } from './calendars.service';
import { LeaguesModule } from '../leagues/leagues.module';
import { SeasonScheduleService } from './season-schedule.service';
import { ManagerCareerModule } from '../manager-career/manager-career.module';
import { InternationalsModule } from '../internationals/internationals.module';
import { DailyFormRecoveryService } from './daily-form-recovery.service';

@Module({
  imports: [
    AuthModule,
    EventQueueModule,
    LeaguesModule,
    ManagerCareerModule,
    InternationalsModule,
    TypeOrmModule.forFeature([Career, LeagueFixture]),
  ],
  controllers: [CalendarsController],
  providers: [
    CalendarsService,
    SeasonScheduleService,
    DailyFormRecoveryService,
  ],
  exports: [CalendarsService],
})
export class CalendarsModule {}
