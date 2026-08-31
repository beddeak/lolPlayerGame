import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Career } from '../careers/entities/career.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { EventQueueController } from './event-queue.controller';
import { EventQueueService } from './event-queue.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Career, CalendarEvent])],
  controllers: [EventQueueController],
  providers: [EventQueueService],
  exports: [EventQueueService],
})
export class EventQueueModule {}
