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

export const MANAGER_REVIEW_TYPES = [
  'BASELINE',
  'EXPECTATION',
  'SERIES',
  'SPLIT',
  'TRANSFER',
  'SEASON',
  'WARNING',
  'RECOVERED',
  'DISMISSED',
] as const;
export type ManagerReviewType = (typeof MANAGER_REVIEW_TYPES)[number];

@Entity({ name: 'manager_reviews' })
@Unique('UQ_manager_reviews_source', ['careerId', 'sourceKey'])
@Index('IDX_manager_reviews_career_date', ['careerId', 'reviewedDate'])
export class ManagerReview {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true }) id!: number;
  @Column({ type: 'int', unsigned: true }) careerId!: number;
  @ManyToOne(() => Career, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_manager_reviews_career',
  })
  career!: Career;
  @Column({ type: 'varchar', length: 96 }) sourceKey!: string;
  @Column({ type: 'enum', enum: [...MANAGER_REVIEW_TYPES] })
  type!: ManagerReviewType;
  @Column({ type: 'date' }) reviewedDate!: string;
  @Column({ type: 'varchar', length: 128 }) title!: string;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @Column({ type: 'double', default: 0 }) fanDelta!: number;
  @Column({ type: 'double', default: 0 }) boardDelta!: number;
  @Column({ type: 'double' }) fanApproval!: number;
  @Column({ type: 'double' }) boardConfidence!: number;
  @Column({ type: 'json', nullable: true }) payload!: Record<
    string,
    unknown
  > | null;
  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
