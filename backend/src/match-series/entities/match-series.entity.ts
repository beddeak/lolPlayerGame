import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Career } from '../../careers/entities/career.entity';
import { Match } from '../../matches/entities/match.entity';
import { MatchFeedback } from './match-feedback.entity';

@Entity({ name: 'match_series' })
export class MatchSeries {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_match_series_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_match_series_career',
  })
  career!: Career;

  @Index('IDX_match_series_team_a_id')
  @Column({ type: 'int', unsigned: true })
  teamAId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'teamAId',
    foreignKeyConstraintName: 'FK_match_series_team_a',
  })
  teamA!: CareerTeam;

  @Index('IDX_match_series_team_b_id')
  @Column({ type: 'int', unsigned: true })
  teamBId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'teamBId',
    foreignKeyConstraintName: 'FK_match_series_team_b',
  })
  teamB!: CareerTeam;

  @Column({ type: 'int', unsigned: true })
  seed!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 3 })
  bestOf!: number;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @OneToMany(() => Match, (match) => match.series)
  games!: Match[];

  @OneToMany(() => MatchFeedback, (feedback) => feedback.series)
  feedbacks!: MatchFeedback[];
}
