import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SetBonusRequirement } from './set-bonus-requirement.entity';

@Entity({ name: 'set_bonuses' })
@Unique('UQ_set_bonuses_code', ['code'])
export class SetBonus {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  chemistryBonus!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  laningBonus!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  teamFightBonus!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  macroBonus!: number;

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  teamPlayBonus!: number;

  @OneToMany(() => SetBonusRequirement, (requirement) => requirement.setBonus)
  requirements!: SetBonusRequirement[];
}
