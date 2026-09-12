import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Career } from '../careers/entities/career.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { ContractsModule } from '../contracts/contracts.module';
import { LegendsModule } from '../legends/legends.module';
import { EventQueueController } from './event-queue.controller';
import { EventQueueService } from './event-queue.service';

@Module({
  imports: [
    AuthModule,
    ContractsModule,
    LegendsModule,
    TypeOrmModule.forFeature([Career, CalendarEvent]),
  ],
  controllers: [EventQueueController],
  providers: [EventQueueService],
  exports: [EventQueueService],
})
export class EventQueueModule {}
