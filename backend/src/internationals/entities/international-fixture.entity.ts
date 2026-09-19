import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { MatchSeries } from '../../match-series/entities/match-series.entity';
import { CalendarEvent } from '../../event-queue/entities/calendar-event.entity';
import { InternationalTournament } from './international-tournament.entity';

@Entity('international_fixtures')
@Unique('UQ_international_fixture_key', ['tournamentId', 'key'])
@Unique('UQ_international_fixture_series', ['seriesId'])
export class InternationalFixture {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true }) id!: number;
  @Index('IDX_international_fixture_tournament')
  @Column({ type: 'int', unsigned: true })
  tournamentId!: number;
  @ManyToOne(() => InternationalTournament, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tournamentId',
    foreignKeyConstraintName: 'FK_international_fixture_tournament',
  })
  tournament!: InternationalTournament;
  @Column({ type: 'varchar', length: 40 }) key!: string;
  @Column({ type: 'int', unsigned: true, nullable: true }) seriesId!:
    number | null;
  @ManyToOne(() => MatchSeries, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'seriesId',
    foreignKeyConstraintName: 'FK_international_fixture_series',
  })
  series!: MatchSeries | null;
  @Index('IDX_international_fixture_event')
  @Column({ type: 'int', unsigned: true })
  eventId!: number;
  @ManyToOne(() => CalendarEvent, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'eventId',
    foreignKeyConstraintName: 'FK_international_fixture_event',
  })
  event!: CalendarEvent;
}
