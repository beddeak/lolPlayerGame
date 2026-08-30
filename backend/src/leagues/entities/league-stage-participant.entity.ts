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
import { LeagueStage } from './league-stage.entity';

@Entity({ name: 'league_stage_participants' })
@Unique('UQ_league_stage_participants_stage_team', [
  'leagueStageId',
  'careerTeamId',
])
export class LeagueStageParticipant {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_league_stage_participants_stage_id')
  @Column({ type: 'int', unsigned: true })
  leagueStageId!: number;

  @ManyToOne(() => LeagueStage, (stage) => stage.participants, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'leagueStageId',
    foreignKeyConstraintName: 'FK_league_stage_participants_stage',
  })
  stage!: LeagueStage;

  @Index('IDX_league_stage_participants_team_id')
  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_league_stage_participants_team',
  })
  team!: CareerTeam;

  @Column({ type: 'smallint', unsigned: true })
  initialSeed!: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  groupCode!: string | null;
}
