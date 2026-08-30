import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Position } from '../../players/enums/position.enum';
import { TrainingCategory } from '../enums/training-category.enum';
import { TrainingType } from '../enums/training-type.enum';
import { PlayerInstruction } from '../enums/player-instruction.enum';
import { TeamStrategy } from '../enums/team-strategy.enum';
import { CareerPlayer } from './career-player.entity';
import { CareerTeam } from './career-team.entity';
import { TrainingPeriod } from './training-period.entity';

@Entity({ name: 'training_sessions' })
@Unique('UQ_training_sessions_period_category_sequence', [
  'trainingPeriodId',
  'category',
  'categorySequence',
])
export class TrainingSession {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_training_sessions_period_id')
  @Column({ type: 'int', unsigned: true })
  trainingPeriodId!: number;

  @ManyToOne(() => TrainingPeriod, (period) => period.sessions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'trainingPeriodId',
    foreignKeyConstraintName: 'FK_training_sessions_period',
  })
  trainingPeriod!: TrainingPeriod;

  @Index('IDX_training_sessions_career_team_id')
  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_training_sessions_career_team',
  })
  careerTeam!: CareerTeam;

  @Index('IDX_training_sessions_career_player_id')
  @Column({ type: 'int', unsigned: true, nullable: true })
  careerPlayerId!: number | null;

  @ManyToOne(() => CareerPlayer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_training_sessions_career_player',
  })
  careerPlayer!: CareerPlayer | null;

  @Column({ type: 'enum', enum: TrainingCategory })
  category!: TrainingCategory;

  @Column({ type: 'enum', enum: TrainingType })
  type!: TrainingType;

  @Column({ type: 'tinyint', unsigned: true })
  categorySequence!: number;

  @Column({ type: 'enum', enum: TeamStrategy, nullable: true })
  strategy!: TeamStrategy | null;

  @Column({ type: 'enum', enum: Position, nullable: true })
  position!: Position | null;

  @Column({ type: 'enum', enum: PlayerInstruction, nullable: true })
  instruction!: PlayerInstruction | null;

  @Column({ type: 'boolean', nullable: true })
  growthSucceeded!: boolean | null;

  @Column({ type: 'tinyint', unsigned: true })
  resultBefore!: number;

  @Column({ type: 'tinyint' })
  resultDelta!: number;

  @Column({ type: 'tinyint', unsigned: true })
  resultAfter!: number;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  conditionBefore!: number | null;

  @Column({ type: 'tinyint', nullable: true })
  conditionDelta!: number | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  conditionAfter!: number | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  formBefore!: number | null;

  @Column({ type: 'tinyint', nullable: true })
  formDelta!: number | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  formAfter!: number | null;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
