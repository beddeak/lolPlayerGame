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
import { CalendarEvent } from '../../event-queue/entities/calendar-event.entity';
import { Theme } from '../../players/entities/theme.entity';
import { LegendSeason } from './legend-season.entity';
import { LegendEventPlayer } from './legend-event-player.entity';

@Entity({ name: 'legend_events' })
@Unique('UQ_legend_events_season_ordinal', ['seasonId', 'ordinal'])
@Unique('UQ_legend_events_calendar_event', ['calendarEventId'])
export class LegendEvent {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_legend_events_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_legend_events_career',
  })
  career!: Career;

  @Index('IDX_legend_events_season_id')
  @Column({ type: 'int', unsigned: true })
  seasonId!: number;

  @ManyToOne(() => LegendSeason, (season) => season.events, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'seasonId',
    foreignKeyConstraintName: 'FK_legend_events_season',
  })
  season!: LegendSeason;

  @Column({ type: 'tinyint', unsigned: true })
  ordinal!: number;

  @Index('IDX_legend_events_theme_id')
  @Column({ type: 'int', unsigned: true })
  themeId!: number;

  @ManyToOne(() => Theme, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'themeId',
    foreignKeyConstraintName: 'FK_legend_events_theme',
  })
  theme!: Theme;

  @Column({ type: 'json' })
  playerCardIds!: number[];

  @Index('IDX_legend_events_reveal_date')
  @Column({ type: 'date' })
  revealDate!: string;

  @Column({ type: 'date', nullable: true })
  revealedDate!: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  calendarEventId!: number | null;

  @ManyToOne(() => CalendarEvent, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'calendarEventId',
    foreignKeyConstraintName: 'FK_legend_events_calendar_event',
  })
  calendarEvent!: CalendarEvent | null;

  @OneToMany(() => LegendEventPlayer, (player) => player.legendEvent)
  players!: LegendEventPlayer[];
}
