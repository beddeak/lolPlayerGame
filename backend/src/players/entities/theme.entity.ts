import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PlayerCard } from './player-card.entity';

@Entity({ name: 'themes' })
@Unique('UQ_themes_code', ['code'])
export class Theme {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @OneToMany(() => PlayerCard, (playerCard) => playerCard.theme)
  playerCards!: PlayerCard[];
}
