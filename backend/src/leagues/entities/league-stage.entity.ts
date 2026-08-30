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
import type { LeagueStageSettings } from '../league-format.types';
import { LeagueStageFormat } from '../enums/league-stage-format.enum';
import { LeagueStageStatus } from '../enums/league-stage-status.enum';
import { LeagueFixture } from './league-fixture.entity';
import { LeagueSplit } from './league-split.entity';
import { LeagueStageParticipant } from './league-stage-participant.entity';

@Entity({ name: 'league_stages' })
@Unique('UQ_league_stages_split_sequence', ['leagueSplitId', 'sequence'])
@Unique('UQ_league_stages_split_code', ['leagueSplitId', 'code'])
export class LeagueStage {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_league_stages_split_id')
  @Column({ type: 'int', unsigned: true })
  leagueSplitId!: number;

  @ManyToOne(() => LeagueSplit, (split) => split.stages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'leagueSplitId',
    foreignKeyConstraintName: 'FK_league_stages_split',
  })
  leagueSplit!: LeagueSplit;

  @Column({ type: 'tinyint', unsigned: true })
  sequence!: number;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'enum', enum: LeagueStageFormat })
  format!: LeagueStageFormat;

  @Column({ type: 'enum', enum: LeagueStageStatus })
  status!: LeagueStageStatus;

  @Column({ type: 'tinyint', unsigned: true })
  bestOf!: number;

  @Column({ type: 'smallint', unsigned: true, default: 1 })
  currentRound!: number;

  @Column({ type: 'json' })
  settings!: LeagueStageSettings;

  @OneToMany(() => LeagueStageParticipant, (participant) => participant.stage)
  participants!: LeagueStageParticipant[];

  @OneToMany(() => LeagueFixture, (fixture) => fixture.leagueStage)
  fixtures!: LeagueFixture[];
}
