import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Career } from '../../careers/entities/career.entity';

export enum AiClubDifficulty {
  EASY = 'EASY',
}

@Entity({ name: 'ai_club_states' })
@Unique('UQ_ai_club_states_career_team', ['careerTeamId'])
export class AiClubState {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_ai_club_states_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_ai_club_states_career',
  })
  career!: Career;

  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_ai_club_states_team',
  })
  careerTeam!: CareerTeam;

  @Column({
    type: 'enum',
    enum: AiClubDifficulty,
    default: AiClubDifficulty.EASY,
  })
  difficulty!: AiClubDifficulty;

  @Column({ type: 'smallint', unsigned: true })
  budgetYear!: number;

  @Column({ type: 'int', unsigned: true })
  annualSalaryBudget!: number;

  @Column({ type: 'int', unsigned: true })
  transferBudget!: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  transferSpent!: number;

  @Column({ type: 'date', nullable: true })
  lastDecisionDate!: string | null;
}
