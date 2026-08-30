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
import { CareerPlayerPositionProficiency } from './entities/career-player-position-proficiency.entity';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { CareerTeam } from './entities/career-team.entity';
import { CareerTeamStrategyProficiency } from './entities/career-team-strategy-proficiency.entity';
import { Career } from './entities/career.entity';
import { Roster } from './entities/roster.entity';
import { TrainingPeriod } from './entities/training-period.entity';
import { TrainingSession } from './entities/training-session.entity';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Career,
      CareerTeam,
      CareerTeamStrategyProficiency,
      CareerPlayer,
      CareerPlayerPositionProficiency,
      CareerPlayerRoleProficiency,
      Roster,
      TrainingPeriod,
      TrainingSession,
      PlayerCard,
      SetBonus,
    ]),
  ],
  providers: [CareersService, CareerTeamsService, TrainingService],
  controllers: [CareersController, CareerTeamsController, TrainingController],
  exports: [CareersService, CareerTeamsService, TrainingService],
})
export class CareersModule {}
