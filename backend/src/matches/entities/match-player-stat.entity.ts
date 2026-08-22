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
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { Position } from '../../players/enums/position.enum';
import { Match } from './match.entity';

@Entity({ name: 'match_player_stats' })
@Unique('UQ_match_player_stats_match_player', ['matchId', 'careerPlayerId'])
export class MatchPlayerStat {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_match_player_stats_match_id')
  @Column({ type: 'int', unsigned: true })
  matchId!: number;

  @ManyToOne(() => Match, (match) => match.playerStats, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'matchId',
    foreignKeyConstraintName: 'FK_match_player_stats_match',
  })
  match!: Match;

  @Index('IDX_match_player_stats_career_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(() => CareerPlayer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_match_player_stats_career_player',
  })
  careerPlayer!: CareerPlayer;

  @Index('IDX_match_player_stats_career_team_id')
  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_match_player_stats_career_team',
  })
  careerTeam!: CareerTeam;

  @Column({ type: 'enum', enum: Position })
  position!: Position;

  @Column({ type: 'enum', enum: PlayerInstruction, nullable: true })
  playerInstruction!: PlayerInstruction | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  roleProficiency!: number | null;

  @Column({ type: 'tinyint', unsigned: true })
  kills!: number;

  @Column({ type: 'tinyint', unsigned: true })
  deaths!: number;

  @Column({ type: 'tinyint', unsigned: true })
  assists!: number;

  @Column({ type: 'double' })
  kda!: number;

  @Column({ type: 'double' })
  dpm!: number;

  @Column({ type: 'double' })
  damageShare!: number;

  @Column({ type: 'int', unsigned: true })
  gold!: number;

  @Column({ type: 'double' })
  goldShare!: number;

  @Column({ type: 'smallint' })
  gdAt15!: number;

  @Column({ type: 'smallint' })
  csdAt15!: number;

  @Column({ type: 'double' })
  kp!: number;

  @Column({ type: 'double' })
  rating!: number;
}
