import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerCard } from './entities/player-card.entity';
import { Player } from './entities/player.entity';
import { Theme } from './entities/theme.entity';
import { PlayerCardsController } from './player-cards.controller';
import { PlayerCardsService } from './player-cards.service';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Player, Theme, PlayerCard])],
  providers: [PlayersService, ThemesService, PlayerCardsService],
  controllers: [PlayersController, ThemesController, PlayerCardsController],
  exports: [PlayersService, ThemesService, PlayerCardsService],
})
export class PlayersModule {}
