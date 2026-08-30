import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { MatchSeries } from '../../match-series/entities/match-series.entity';
import { LeagueSplit } from './league-split.entity';
import { LeagueStage } from './league-stage.entity';

@Entity({ name: 'league_fixtures' })
@Unique('UQ_league_fixtures_split_number', ['leagueSplitId', 'fixtureNumber'])
@Unique('UQ_league_fixtures_stage_number', [
  'leagueStageId',
  'stageFixtureNumber',
])
@Unique('UQ_league_fixtures_series_id', ['seriesId'])
export class LeagueFixture {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_league_fixtures_split_id')
  @Column({ type: 'int', unsigned: true })
  leagueSplitId!: number;

  @ManyToOne(() => LeagueSplit, (split) => split.fixtures, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'leagueSplitId',
    foreignKeyConstraintName: 'FK_league_fixtures_split',
  })
  leagueSplit!: LeagueSplit;

  @Index('IDX_league_fixtures_stage_id')
  @Column({ type: 'int', unsigned: true })
  leagueStageId!: number;

  @ManyToOne(() => LeagueStage, (stage) => stage.fixtures, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'leagueStageId',
    foreignKeyConstraintName: 'FK_league_fixtures_stage',
  })
  leagueStage!: LeagueStage;

  @Column({ type: 'smallint', unsigned: true })
  fixtureNumber!: number;

  @Column({ type: 'smallint', unsigned: true })
  stageFixtureNumber!: number;

  @Column({ type: 'smallint', unsigned: true })
  roundNumber!: number;

  @Index('IDX_league_fixtures_team_a_id')
  @Column({ type: 'int', unsigned: true })
  teamAId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'teamAId',
    foreignKeyConstraintName: 'FK_league_fixtures_team_a',
  })
  teamA!: CareerTeam;

  @Index('IDX_league_fixtures_team_b_id')
  @Column({ type: 'int', unsigned: true })
  teamBId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'teamBId',
    foreignKeyConstraintName: 'FK_league_fixtures_team_b',
  })
  teamB!: CareerTeam;

  @Column({ type: 'int', unsigned: true })
  seed!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 3 })
  bestOf!: number;

  @Index('IDX_league_fixtures_series_id')
  @Column({ type: 'int', unsigned: true, nullable: true })
  seriesId!: number | null;

  @ManyToOne(() => MatchSeries, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'seriesId',
    foreignKeyConstraintName: 'FK_league_fixtures_series',
  })
  series!: MatchSeries | null;
}
