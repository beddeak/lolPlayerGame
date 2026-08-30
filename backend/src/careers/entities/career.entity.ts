import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../auth/entities/account.entity';
import { CareerPlayer } from './career-player.entity';
import { CareerTeam } from './career-team.entity';
import { TeamStrategy } from '../enums/team-strategy.enum';
import { TrainingPeriod } from './training-period.entity';
import { LeagueSplit } from '../../leagues/entities/league-split.entity';

@Entity({ name: 'careers' })
export class Career {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_careers_account_id')
  @Column({ type: 'int', unsigned: true })
  accountId!: number;

  @ManyToOne(() => Account, (account) => account.careers, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_careers_account',
  })
  account!: Account;

  @Column({ type: 'smallint', unsigned: true })
  startYear!: number;

  @Column({ type: 'smallint', unsigned: true })
  currentYear!: number;

  @Column({
    type: 'enum',
    enum: TeamStrategy,
    default: TeamStrategy.BALANCED,
  })
  currentMeta!: TeamStrategy;

  @OneToMany(() => CareerTeam, (careerTeam) => careerTeam.career)
  careerTeams!: CareerTeam[];

  @OneToMany(() => CareerPlayer, (careerPlayer) => careerPlayer.career)
  careerPlayers!: CareerPlayer[];

  @OneToMany(() => TrainingPeriod, (trainingPeriod) => trainingPeriod.career)
  trainingPeriods!: TrainingPeriod[];

  @OneToMany(() => LeagueSplit, (leagueSplit) => leagueSplit.career)
  leagueSplits!: LeagueSplit[];
}
