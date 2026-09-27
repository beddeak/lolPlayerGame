import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CalendarsModule } from '../calendars/calendars.module';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Career } from '../careers/entities/career.entity';
import { EventQueueModule } from '../event-queue/event-queue.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { SimulationsController } from './simulations.controller';
import { SimulationsService } from './simulations.service';
import { InternationalsModule } from '../internationals/internationals.module';

@Module({
  imports: [
    AuthModule,
    CalendarsModule,
    EventQueueModule,
    LeaguesModule,
    InternationalsModule,
    TypeOrmModule.forFeature([Career, CareerTeam]),
  ],
  controllers: [SimulationsController],
  providers: [SimulationsService],
})
export class SimulationsModule {}
