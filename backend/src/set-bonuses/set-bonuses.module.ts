import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerCard } from '../players/entities/player-card.entity';
import { SetBonusRequirement } from './entities/set-bonus-requirement.entity';
import { SetBonus } from './entities/set-bonus.entity';
import { SetBonusesController } from './set-bonuses.controller';
import { SetBonusesService } from './set-bonuses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SetBonus, SetBonusRequirement, PlayerCard]),
  ],
  controllers: [SetBonusesController],
  providers: [SetBonusesService],
  exports: [SetBonusesService],
})
export class SetBonusesModule {}
