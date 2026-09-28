import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Career } from '../../careers/entities/career.entity';
import { Match } from './match.entity';
import type { EngineInput } from '../simulation-v2/contracts';
import type { TacticalReplayManifest } from '../simulation-v2/replay';
import type { TeamStrategy } from '../../careers/enums/team-strategy.enum';

export type TacticalRunStatus =
  'RUNNING' | 'FINISHED' | 'HORIZON_REACHED' | 'ERROR';

@Entity({ name: 'match_tactical_runs' })
export class MatchTacticalRun {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('UQ_tactical_run_execution', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  executionKey!: string;

  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_tactical_run_career',
  })
  career!: Career;

  @Index('UQ_tactical_run_match', { unique: true })
  @Column({ type: 'int', unsigned: true, nullable: true })
  matchId!: number | null;

  @ManyToOne(() => Match, (match) => match.tacticalRuns, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'matchId',
    foreignKeyConstraintName: 'FK_tactical_run_match',
  })
  match!: Match | null;

  @Column({ type: 'varchar', length: 24 })
  status!: TacticalRunStatus;

  @Column({ type: 'varchar', length: 80 })
  engineVersion!: string;

  @Column({ type: 'varchar', length: 64 })
  inputHash!: string;

  @Column({ type: 'json', nullable: true, select: false })
  input!: EngineInput | null;

  @Column({ type: 'json' })
  draft!: import('../../drafts/draft-state').DraftState;

  @Column({ type: 'json' })
  feedbackIds!: number[];

  @Column({ type: 'varchar', length: 40 })
  currentMeta!: TeamStrategy;

  @Column({ type: 'int', unsigned: true, default: 0 })
  simTimeMs!: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  leaseToken!: string | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ type: 'longblob', nullable: true, select: false })
  checkpoint!: Buffer | null;

  @Column({ type: 'json', nullable: true })
  manifest!: TacticalReplayManifest | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  error!: string | null;
}
