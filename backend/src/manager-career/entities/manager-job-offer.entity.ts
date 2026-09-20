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
import { Career } from '../../careers/entities/career.entity';
import { CareerTeam } from '../../careers/entities/career-team.entity';

export const MANAGER_JOB_OFFER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
] as const;
export type ManagerJobOfferStatus = (typeof MANAGER_JOB_OFFER_STATUSES)[number];

@Entity({ name: 'manager_job_offers' })
@Unique('UQ_manager_job_offers_season_team', [
  'careerId',
  'seasonYear',
  'toCareerTeamId',
])
@Index('IDX_manager_job_offers_career_status', ['careerId', 'status'])
export class ManagerJobOffer {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true }) id!: number;
  @Column({ type: 'int', unsigned: true }) careerId!: number;
  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_manager_job_offer_career',
  })
  career!: Career;
  @Column({ type: 'smallint', unsigned: true }) seasonYear!: number;
  @Column({ type: 'int', unsigned: true }) fromCareerTeamId!: number;
  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'fromCareerTeamId',
    foreignKeyConstraintName: 'FK_manager_job_offer_from_team',
  })
  fromTeam!: CareerTeam;
  @Column({ type: 'int', unsigned: true }) toCareerTeamId!: number;
  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'toCareerTeamId',
    foreignKeyConstraintName: 'FK_manager_job_offer_to_team',
  })
  toTeam!: CareerTeam;
  @Column({
    type: 'enum',
    enum: [...MANAGER_JOB_OFFER_STATUSES],
    default: 'PENDING',
  })
  status!: ManagerJobOfferStatus;
  @Column({ type: 'date' }) offeredDate!: string;
  @Column({ type: 'date' }) expiresDate!: string;
  @Column({ type: 'date', nullable: true }) resolvedDate!: string | null;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
