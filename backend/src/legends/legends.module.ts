import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContractsModule } from '../contracts/contracts.module';
import { TransfersModule } from '../transfers/transfers.module';
import { LegendEvent } from './entities/legend-event.entity';
import { LegendEventPlayer } from './entities/legend-event-player.entity';
import { LegendSeason } from './entities/legend-season.entity';
import { LegendAiService } from './legend-ai.service';
import { LegendsController } from './legends.controller';
import { LegendsService } from './legends.service';

@Module({
  imports: [
    AuthModule,
    ContractsModule,
    TransfersModule,
    TypeOrmModule.forFeature([LegendSeason, LegendEvent, LegendEventPlayer]),
  ],
  controllers: [LegendsController],
  providers: [LegendsService, LegendAiService],
  exports: [LegendsService],
})
export class LegendsModule {}
