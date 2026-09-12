import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Region } from '../../careers/enums/region.enum';
import { ClubRoster } from './club-roster.entity';

@Entity({ name: 'club_catalog' })
@Unique('UQ_club_catalog_code', ['code'])
export class Club {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'enum', enum: Region })
  region!: Region;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  initialChemistry!: number | null;

  @OneToMany(() => ClubRoster, (roster) => roster.club)
  rosters!: ClubRoster[];
}
