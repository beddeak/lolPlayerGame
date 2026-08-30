import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Career } from './career.entity';
import { TrainingSession } from './training-session.entity';

@Entity({ name: 'training_periods' })
@Unique('UQ_training_periods_career_number', ['careerId', 'periodNumber'])
export class TrainingPeriod {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_training_periods_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, (career) => career.trainingPeriods, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_training_periods_career',
  })
  career!: Career;

  @Column({ type: 'int', unsigned: true })
  periodNumber!: number;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @OneToMany(() => TrainingSession, (session) => session.trainingPeriod)
  sessions!: TrainingSession[];
}
