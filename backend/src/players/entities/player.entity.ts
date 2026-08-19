import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PlayerCard } from './player-card.entity';

@Entity({ name: 'players' })
export class Player {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  nickname!: string;

  @Column({ type: 'varchar', length: 50 })
  nationality!: string;

  @OneToMany(() => PlayerCard, (playerCard) => playerCard.player)
  playerCards!: PlayerCard[];
}
