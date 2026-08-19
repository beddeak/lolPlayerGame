import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PlayerCard } from './player-card.entity';

@Entity({ name: 'themes' })
export class Theme {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @OneToMany(() => PlayerCard, (playerCard) => playerCard.theme)
  playerCards!: PlayerCard[];
}
