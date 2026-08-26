import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Position } from '../../players/enums/position.enum';
import { RosterRole } from '../enums/roster-role.enum';
import { PlayerInstruction } from '../enums/player-instruction.enum';
import { ChampionArchetype } from '../enums/champion-archetype.enum';
import { CareerPlayer } from './career-player.entity';
import { CareerTeam } from './career-team.entity';

@Entity({ name: 'rosters' })
@Unique('UQ_rosters_team_starter_position', ['careerTeamId', 'starterPosition'])
export class Roster {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_rosters_career_team_id')
  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(() => CareerTeam, (careerTeam) => careerTeam.rosters, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_rosters_career_team',
  })
  careerTeam!: CareerTeam;

  @Index('IDX_rosters_career_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @OneToOne(() => CareerPlayer, (careerPlayer) => careerPlayer.roster, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_rosters_career_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'enum', enum: RosterRole })
  role!: RosterRole;

  @Column({ type: 'enum', enum: Position, nullable: true })
  starterPosition!: Position | null;

  @Column({ type: 'enum', enum: PlayerInstruction, nullable: true })
  playerInstruction!: PlayerInstruction | null;

  @Column({ type: 'enum', enum: ChampionArchetype, nullable: true })
  championArchetype!: ChampionArchetype | null;
}
