import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Career } from '../careers/entities/career.entity';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { EventQueueModule } from '../event-queue/event-queue.module';
import { CalendarsController } from './calendars.controller';
import { CalendarsService } from './calendars.service';

@Module({
  imports: [
    AuthModule,
    EventQueueModule,
    TypeOrmModule.forFeature([Career, LeagueFixture]),
  ],
  controllers: [CalendarsController],
  providers: [CalendarsService],
  exports: [CalendarsService],
})
export class CalendarsModule {}
