import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CareerPlayer } from './career-player.entity';
import { CareerTeamStrategyProficiency } from './career-team-strategy-proficiency.entity';
import { Career } from './career.entity';
import { Roster } from './roster.entity';
import { Region } from '../enums/region.enum';
import { TeamStrategy } from '../enums/team-strategy.enum';
import { TEAM_CHEMISTRY_CONFIG } from '../config/team-chemistry.config';

@Entity({ name: 'career_teams' })
@Unique('UQ_career_teams_career_code', ['careerId', 'code'])
export class CareerTeam {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_career_teams_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, (career) => career.careerTeams, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_career_teams_career',
  })
  career!: Career;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'enum', enum: Region })
  region!: Region;

  @Column({ type: 'boolean', default: false })
  isUserControlled!: boolean;

  @Column({
    type: 'enum',
    enum: TeamStrategy,
    default: TeamStrategy.BALANCED,
  })
  teamStrategy!: TeamStrategy;

  @Column({
    type: 'tinyint',
    unsigned: true,
    default: TEAM_CHEMISTRY_CONFIG.initial,
  })
  chemistry!: number;

  @OneToMany(() => CareerPlayer, (careerPlayer) => careerPlayer.currentTeam)
  careerPlayers!: CareerPlayer[];

  @OneToMany(() => Roster, (roster) => roster.careerTeam)
  rosters!: Roster[];

  @OneToMany(
    () => CareerTeamStrategyProficiency,
    (strategyProficiency) => strategyProficiency.careerTeam,
  )
  strategyProficiencies!: CareerTeamStrategyProficiency[];
}
