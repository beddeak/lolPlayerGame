import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlayerCard } from '../players/entities/player-card.entity';
import { SetBonus } from '../set-bonuses/entities/set-bonus.entity';
import { CareerTeamsController } from './career-teams.controller';
import { CareerTeamsService } from './career-teams.service';
import { CareersController } from './careers.controller';
import { CareersService } from './careers.service';
import { CareerPlayer } from './entities/career-player.entity';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { CareerTeam } from './entities/career-team.entity';
import { CareerTeamStrategyProficiency } from './entities/career-team-strategy-proficiency.entity';
import { Career } from './entities/career.entity';
import { Roster } from './entities/roster.entity';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Career,
      CareerTeam,
      CareerTeamStrategyProficiency,
      CareerPlayer,
      CareerPlayerRoleProficiency,
      Roster,
      PlayerCard,
      SetBonus,
    ]),
  ],
  providers: [CareersService, CareerTeamsService],
  controllers: [CareersController, CareerTeamsController],
  exports: [CareersService, CareerTeamsService],
})
export class CareersModule {}
