import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerCard } from '../players/entities/player-card.entity';
import { CareerTeamsController } from './career-teams.controller';
import { CareerTeamsService } from './career-teams.service';
import { CareersController } from './careers.controller';
import { CareersService } from './careers.service';
import { CareerPlayer } from './entities/career-player.entity';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { CareerTeam } from './entities/career-team.entity';
import { Career } from './entities/career.entity';
import { Roster } from './entities/roster.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Career,
      CareerTeam,
      CareerPlayer,
      CareerPlayerRoleProficiency,
      Roster,
      PlayerCard,
    ]),
  ],
  providers: [CareersService, CareerTeamsService],
  controllers: [CareersController, CareerTeamsController],
  exports: [CareersService, CareerTeamsService],
})
export class CareersModule {}
