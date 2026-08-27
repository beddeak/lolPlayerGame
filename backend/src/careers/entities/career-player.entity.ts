import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { Position } from '../../players/enums/position.enum';
import { CAREER_PLAYER_STATE_CONFIG } from '../config/player-state.config';
import { Career } from './career.entity';
import { CareerPlayerRoleProficiency } from './career-player-role-proficiency.entity';
import { CareerTeam } from './career-team.entity';
import { Roster } from './roster.entity';

@Entity({ name: 'career_players' })
@Unique('UQ_career_players_career_card', ['careerId', 'playerCardId'])
export class CareerPlayer {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_career_players_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, (career) => career.careerPlayers, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_career_players_career',
  })
  career!: Career;

  @Index('IDX_career_players_player_card_id')
  @Column({ type: 'int', unsigned: true })
  playerCardId!: number;

  @ManyToOne(() => PlayerCard, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'playerCardId',
    foreignKeyConstraintName: 'FK_career_players_player_card',
  })
  playerCard!: PlayerCard;

  @Index('IDX_career_players_current_team_id')
  @Column({ type: 'int', unsigned: true, nullable: true })
  currentTeamId!: number | null;

  @ManyToOne(() => CareerTeam, (careerTeam) => careerTeam.careerPlayers, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'currentTeamId',
    foreignKeyConstraintName: 'FK_career_players_current_team',
  })
  currentTeam!: CareerTeam | null;

  @Column({ type: 'tinyint', unsigned: true })
  currentAge!: number;

  @Column({ type: 'enum', enum: Position })
  currentPosition!: Position;

  @Column({ type: 'tinyint', unsigned: true })
  currentMechanics!: number;

  @Column({ type: 'tinyint', unsigned: true })
  currentGameSense!: number;

  @Column({ type: 'tinyint', unsigned: true })
  currentLaning!: number;

  @Column({ type: 'tinyint', unsigned: true })
  currentTeamFight!: number;

  @Column({ type: 'tinyint', unsigned: true })
  currentMacro!: number;

  @Column({ type: 'tinyint', unsigned: true })
  currentTeamPlay!: number;

  @Column({ type: 'tinyint', unsigned: true })
  currentMental!: number;

  @Column({ type: 'tinyint', unsigned: true })
  currentChampionPool!: number;

  @Column({
    type: 'tinyint',
    unsigned: true,
    default: CAREER_PLAYER_STATE_CONFIG.initial.form,
  })
  form!: number;

  @Column({
    type: 'tinyint',
    unsigned: true,
    default: CAREER_PLAYER_STATE_CONFIG.initial.condition,
  })
  condition!: number;

  @OneToOne(() => Roster, (roster) => roster.careerPlayer)
  roster!: Roster | null;

  @OneToMany(
    () => CareerPlayerRoleProficiency,
    (roleProficiency) => roleProficiency.careerPlayer,
  )
  roleProficiencies!: CareerPlayerRoleProficiency[];
}
