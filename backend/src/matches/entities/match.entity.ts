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
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { MatchPlayerStat } from './match-player-stat.entity';

@Entity({ name: 'matches' })
export class Match {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_matches_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_matches_career',
  })
  career!: Career;

  @Index('IDX_matches_team_a_id')
  @Column({ type: 'int', unsigned: true })
  teamAId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'teamAId',
    foreignKeyConstraintName: 'FK_matches_team_a',
  })
  teamA!: CareerTeam;

  @Index('IDX_matches_team_b_id')
  @Column({ type: 'int', unsigned: true })
  teamBId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'teamBId',
    foreignKeyConstraintName: 'FK_matches_team_b',
  })
  teamB!: CareerTeam;

  @Index('IDX_matches_winner_team_id')
  @Column({ type: 'int', unsigned: true })
  winnerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'winnerTeamId',
    foreignKeyConstraintName: 'FK_matches_winner_team',
  })
  winnerTeam!: CareerTeam;

  @Column({ type: 'int', unsigned: true })
  seed!: number;

  @Column({ type: 'double' })
  durationMinutes!: number;

  @Column({ type: 'double' })
  teamABaseAbility!: number;

  @Column({ type: 'double' })
  teamARngModifier!: number;

  @Column({ type: 'double' })
  teamAPerformance!: number;

  @Column({
    type: 'enum',
    enum: TeamStrategy,
    default: TeamStrategy.BALANCED,
  })
  teamAStrategy!: TeamStrategy;

  @Column({ type: 'double' })
  teamBBaseAbility!: number;

  @Column({ type: 'double' })
  teamBRngModifier!: number;

  @Column({ type: 'double' })
  teamBPerformance!: number;

  @Column({
    type: 'enum',
    enum: TeamStrategy,
    default: TeamStrategy.BALANCED,
  })
  teamBStrategy!: TeamStrategy;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @OneToMany(() => MatchPlayerStat, (playerStat) => playerStat.match)
  playerStats!: MatchPlayerStat[];
}
