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
import { Career } from '../../careers/entities/career.entity';
import { Region } from '../../careers/enums/region.enum';
import { LeagueFixture } from './league-fixture.entity';
import { LeagueStage } from './league-stage.entity';

@Entity({ name: 'league_splits' })
@Unique('UQ_league_splits_career_year_region_number', [
  'careerId',
  'year',
  'region',
  'splitNumber',
])
export class LeagueSplit {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_league_splits_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, (career) => career.leagueSplits, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_league_splits_career',
  })
  career!: Career;

  @Column({ type: 'smallint', unsigned: true })
  year!: number;

  @Column({ type: 'enum', enum: Region })
  region!: Region;

  @Column({ type: 'tinyint', unsigned: true })
  splitNumber!: number;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @OneToMany(() => LeagueFixture, (fixture) => fixture.leagueSplit)
  fixtures!: LeagueFixture[];

  @OneToMany(() => LeagueStage, (stage) => stage.leagueSplit)
  stages!: LeagueStage[];
}
