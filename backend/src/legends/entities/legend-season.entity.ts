import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Career } from '../../careers/entities/career.entity';
import { LegendEvent } from './legend-event.entity';

@Entity({ name: 'legend_seasons' })
@Unique('UQ_legend_seasons_career_year', ['careerId', 'year'])
export class LegendSeason {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_legend_seasons_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_legend_seasons_career',
  })
  career!: Career;

  @Column({ type: 'smallint', unsigned: true })
  year!: number;

  @Column({ type: 'varchar', length: 64, select: false })
  seed!: string;

  @Column({ type: 'tinyint', unsigned: true })
  eventCount!: number;

  @Column({ type: 'smallint', unsigned: true })
  zeroEventStreak!: number;

  @OneToMany(() => LegendEvent, (event) => event.season)
  events!: LegendEvent[];
}
