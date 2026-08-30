import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CareerPlayer } from '../../careers/entities/career-player.entity';
import { PlayerPersonality } from '../../players/enums/player-personality.enum';
import { MatchFeedback } from './match-feedback.entity';

@Entity({ name: 'match_feedback_player_effects' })
@Unique('UQ_feedback_player_effects_feedback_player', [
  'feedbackId',
  'careerPlayerId',
])
export class MatchFeedbackPlayerEffect {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_feedback_player_effects_feedback_id')
  @Column({ type: 'int', unsigned: true })
  feedbackId!: number;

  @ManyToOne(() => MatchFeedback, (feedback) => feedback.effects, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'feedbackId',
    foreignKeyConstraintName: 'FK_feedback_player_effects_feedback',
  })
  feedback!: MatchFeedback;

  @Index('IDX_feedback_player_effects_career_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(() => CareerPlayer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_feedback_player_effects_career_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'enum', enum: PlayerPersonality })
  personality!: PlayerPersonality;

  @Column({ type: 'tinyint', unsigned: true })
  mentalBefore!: number;

  @Column({ type: 'tinyint' })
  mentalDelta!: number;

  @Column({ type: 'tinyint', unsigned: true })
  mentalAfter!: number;

  @Column({ type: 'tinyint', unsigned: true })
  formBefore!: number;

  @Column({ type: 'tinyint' })
  formDelta!: number;

  @Column({ type: 'tinyint', unsigned: true })
  formAfter!: number;

  @Column({ type: 'tinyint', unsigned: true })
  coachTrustBefore!: number;

  @Column({ type: 'tinyint' })
  coachTrustDelta!: number;

  @Column({ type: 'tinyint', unsigned: true })
  coachTrustAfter!: number;
}
