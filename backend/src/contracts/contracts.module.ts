import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractOffer } from './entities/contract-offer.entity';
import { PlayerContract } from './entities/player-contract.entity';
import { TransfersModule } from '../transfers/transfers.module';
import { AiClubSupportModule } from '../ai-clubs/ai-club-support.module';

@Module({
  imports: [
    AuthModule,
    TransfersModule,
    AiClubSupportModule,
    TypeOrmModule.forFeature([
      Career,
      CareerPlayer,
      CareerTeam,
      CalendarEvent,
      ContractOffer,
      PlayerContract,
    ]),
  ],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
