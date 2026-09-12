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
import { CareerPlayer } from '../../careers/entities/career-player.entity';
import { LegendEvent } from './legend-event.entity';

@Entity({ name: 'legend_event_players' })
@Unique('UQ_legend_event_players_career_player', ['careerPlayerId'])
export class LegendEventPlayer {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_legend_event_players_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_legend_event_players_career',
  })
  career!: Career;

  @Index('IDX_legend_event_players_event_id')
  @Column({ type: 'int', unsigned: true })
  legendEventId!: number;

  @ManyToOne(() => LegendEvent, (event) => event.players, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'legendEventId',
    foreignKeyConstraintName: 'FK_legend_event_players_event',
  })
  legendEvent!: LegendEvent;

  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(() => CareerPlayer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_legend_event_players_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'json' })
  interestedTeamIds!: number[];

  @Index('IDX_legend_event_players_ai_date')
  @Column({ type: 'date' })
  aiDecisionDate!: string;

  @Column({ type: 'date', nullable: true })
  aiProcessedDate!: string | null;
}
