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
import { CareerPlayer } from '../../careers/entities/career-player.entity';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Match } from '../../matches/entities/match.entity';
import { FeedbackOption } from '../enums/feedback-option.enum';
import { FeedbackType } from '../enums/feedback-type.enum';
import { MatchFeedbackPlayerEffect } from './match-feedback-player-effect.entity';
import { MatchSeries } from './match-series.entity';

@Entity({ name: 'match_feedbacks' })
@Unique('UQ_match_feedbacks_series_game', ['seriesId', 'afterGameNumber'])
export class MatchFeedback {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_match_feedbacks_series_id')
  @Column({ type: 'int', unsigned: true })
  seriesId!: number;

  @ManyToOne(() => MatchSeries, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'seriesId',
    foreignKeyConstraintName: 'FK_match_feedbacks_series',
  })
  series!: MatchSeries;

  @Index('IDX_match_feedbacks_after_game_id')
  @Column({ type: 'int', unsigned: true })
  afterGameId!: number;

  @ManyToOne(() => Match, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'afterGameId',
    foreignKeyConstraintName: 'FK_match_feedbacks_after_game',
  })
  afterGame!: Match;

  @Column({ type: 'tinyint', unsigned: true })
  afterGameNumber!: number;

  @Column({ type: 'enum', enum: FeedbackType })
  type!: FeedbackType;

  @Column({ type: 'enum', enum: FeedbackOption })
  option!: FeedbackOption;

  @Index('IDX_match_feedbacks_target_team_id')
  @Column({ type: 'int', unsigned: true })
  targetTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'targetTeamId',
    foreignKeyConstraintName: 'FK_match_feedbacks_target_team',
  })
  targetTeam!: CareerTeam;

  @Index('IDX_match_feedbacks_target_player_id')
  @Column({ type: 'int', unsigned: true, nullable: true })
  targetCareerPlayerId!: number | null;

  @ManyToOne(() => CareerPlayer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'targetCareerPlayerId',
    foreignKeyConstraintName: 'FK_match_feedbacks_target_player',
  })
  targetCareerPlayer!: CareerPlayer | null;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @OneToMany(
    () => MatchFeedbackPlayerEffect,
    (playerEffect) => playerEffect.feedback,
  )
  effects!: MatchFeedbackPlayerEffect[];
}
