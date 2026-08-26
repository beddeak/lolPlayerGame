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
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Career } from '../../careers/entities/career.entity';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { MatchSeries } from '../../match-series/entities/match-series.entity';
import { SetBonusSnapshot } from '../../set-bonuses/set-bonus.types';
import { MatchPlayerStat } from './match-player-stat.entity';

@Entity({ name: 'matches' })
@Unique('UQ_matches_series_game_number', ['seriesId', 'seriesGameNumber'])
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

  @Index('IDX_matches_series_id')
  @Column({ type: 'int', unsigned: true, nullable: true })
  seriesId!: number | null;

  @ManyToOne(() => MatchSeries, (series) => series.games, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'seriesId',
    foreignKeyConstraintName: 'FK_matches_series',
  })
  series!: MatchSeries | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  seriesGameNumber!: number | null;

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

  @Column({ type: 'tinyint', unsigned: true, default: 50 })
  teamAStrategyProficiency!: number;

  @Column({ type: 'double', default: 0 })
  teamAStrategyProficiencyModifier!: number;

  @Column({ type: 'double', default: 0 })
  teamAMetaModifier!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 50 })
  teamAChemistry!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 50 })
  teamAEffectiveChemistry!: number;

  @Column({ type: 'double', default: 0 })
  teamAChemistryModifier!: number;

  @Column({ type: 'double', default: 0 })
  teamASetBonusModifier!: number;

  @Column({ type: 'json', nullable: true })
  teamAActiveSetBonuses!: SetBonusSnapshot[] | null;

  @Column({ type: 'double', default: 0 })
  teamAArchetypeModifier!: number;

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

  @Column({ type: 'tinyint', unsigned: true, default: 50 })
  teamBStrategyProficiency!: number;

  @Column({ type: 'double', default: 0 })
  teamBStrategyProficiencyModifier!: number;

  @Column({ type: 'double', default: 0 })
  teamBMetaModifier!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 50 })
  teamBChemistry!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 50 })
  teamBEffectiveChemistry!: number;

  @Column({ type: 'double', default: 0 })
  teamBChemistryModifier!: number;

  @Column({ type: 'double', default: 0 })
  teamBSetBonusModifier!: number;

  @Column({ type: 'json', nullable: true })
  teamBActiveSetBonuses!: SetBonusSnapshot[] | null;

  @Column({ type: 'double', default: 0 })
  teamBArchetypeModifier!: number;

  @Column({
    type: 'enum',
    enum: TeamStrategy,
    default: TeamStrategy.BALANCED,
  })
  currentMeta!: TeamStrategy;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @OneToMany(() => MatchPlayerStat, (playerStat) => playerStat.match)
  playerStats!: MatchPlayerStat[];
}
