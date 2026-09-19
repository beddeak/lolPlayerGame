import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Career } from '../../careers/entities/career.entity';
import { InternationalKind } from '../tournament.types';
import type { TournamentState } from '../tournament.types';

@Entity('international_tournaments')
@Unique('UQ_international_career_year_kind', ['careerId', 'year', 'kind'])
export class InternationalTournament {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true }) id!: number;
  @Index('IDX_international_career')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;
  @ManyToOne(() => Career, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_international_career',
  })
  career!: Career;
  @Column({ type: 'smallint', unsigned: true }) year!: number;
  @Column({ type: 'enum', enum: InternationalKind }) kind!: InternationalKind;
  @Column({ type: 'json' }) state!: TournamentState;
  @Column({ type: 'json' }) registeredRosters!: Record<string, number[]>;
  @Column({ type: 'boolean', default: false }) rosterConfirmed!: boolean;
}
