import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CareerPlayer } from './career-player.entity';
import { CareerTeam } from './career-team.entity';
import { TeamStrategy } from '../enums/team-strategy.enum';

@Entity({ name: 'careers' })
export class Career {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

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
}
