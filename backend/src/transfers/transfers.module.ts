import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Career } from '../careers/entities/career.entity';
import { Roster } from '../careers/entities/roster.entity';
import { ContractOffer } from '../contracts/entities/contract-offer.entity';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import { TransferAgreement } from './entities/transfer-agreement.entity';
import { TransferRecord } from './entities/transfer-record.entity';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Career,
      CareerTeam,
      CareerPlayer,
      Roster,
      ContractOffer,
      PlayerContract,
      TransferAgreement,
      TransferRecord,
    ]),
  ],
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
