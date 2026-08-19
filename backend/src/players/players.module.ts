import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerCard } from './entities/player-card.entity';
import { Player } from './entities/player.entity';
import { Theme } from './entities/theme.entity';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Player, Theme, PlayerCard])],
  providers: [PlayersService],
  controllers: [PlayersController],
})
export class PlayersModule {}
