import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { TeamStrategy } from '../enums/team-strategy.enum';
import { CareerTeam } from './career-team.entity';

@Entity({ name: 'career_team_strategy_proficiencies' })
@Unique('UQ_team_strategy_proficiencies_team_strategy', [
  'careerTeamId',
  'strategy',
])
export class CareerTeamStrategyProficiency {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_team_strategy_proficiencies_career_team_id')
  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(
    () => CareerTeam,
    (careerTeam) => careerTeam.strategyProficiencies,
    { nullable: false, onDelete: 'CASCADE' },
  )
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_team_strategy_proficiencies_career_team',
  })
  careerTeam!: CareerTeam;

  @Column({ type: 'enum', enum: TeamStrategy })
  strategy!: TeamStrategy;

  @Column({ type: 'tinyint', unsigned: true })
  proficiency!: number;
}
