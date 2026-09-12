import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Career } from '../../careers/entities/career.entity';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import type { ManagerJobStatus } from '../manager-policy';

@Entity({ name: 'manager_career_states' })
@Unique('UQ_manager_career_states_career', ['careerId'])
export class ManagerCareerState {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true }) id!: number;
  @Column({ type: 'int', unsigned: true }) careerId!: number;
  @ManyToOne(() => Career, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_manager_state_career',
  })
  career!: Career;
  @Column({ type: 'int', unsigned: true }) careerTeamId!: number;
  @ManyToOne(() => CareerTeam, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_manager_state_team',
  })
  team!: CareerTeam;
  @Column({
    type: 'enum',
    enum: ['ACTIVE', 'WARNING', 'DISMISSED'],
    default: 'ACTIVE',
  })
  status!: ManagerJobStatus;
  @Column({ type: 'double', default: 65 }) fanApproval!: number;
  @Column({ type: 'double', default: 65 }) boardConfidence!: number;
  @Column({ type: 'date' }) trackingStartedDate!: string;
  @Column({ type: 'smallint', unsigned: true }) reviewYear!: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) played!: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) wins!: number;
  @Column({ type: 'double', default: 0 }) expectedWins!: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) winningStreak!: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) losingStreak!: number;
  @Column({ type: 'int', unsigned: true, nullable: true }) warningAtPlayed!:
    number | null;
  @Column({ type: 'date', nullable: true }) warnedDate!: string | null;
  @Column({ type: 'date', nullable: true }) dismissedDate!: string | null;
}
