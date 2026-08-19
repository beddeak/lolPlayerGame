import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Position } from '../enums/position.enum';
import { Player } from './player.entity';
import { Theme } from './theme.entity';

@Entity({ name: 'player_cards' })
@Unique('UQ_player_cards_player_theme_year', [
  'playerId',
  'themeId',
  'cardYear',
])
export class PlayerCard {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_player_cards_player_id')
  @Column({ type: 'int', unsigned: true })
  playerId!: number;

  @ManyToOne(() => Player, (player) => player.playerCards, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'playerId' })
  player!: Player;

  @Index('IDX_player_cards_theme_id')
  @Column({ type: 'int', unsigned: true })
  themeId!: number;

  @ManyToOne(() => Theme, (theme) => theme.playerCards, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'themeId' })
  theme!: Theme;

  @Column({ type: 'smallint', unsigned: true })
  cardYear!: number;

  @Column({ type: 'tinyint', unsigned: true })
  startingAge!: number;

  @Column({ type: 'enum', enum: Position })
  mainPosition!: Position;

  @Column({ type: 'tinyint', unsigned: true })
  mechanics!: number;

  @Column({ type: 'tinyint', unsigned: true })
  gameSense!: number;

  @Column({ type: 'tinyint', unsigned: true })
  laning!: number;

  @Column({ type: 'tinyint', unsigned: true })
  teamFight!: number;

  @Column({ type: 'tinyint', unsigned: true })
  macro!: number;

  @Column({ type: 'tinyint', unsigned: true })
  teamPlay!: number;

  @Column({ type: 'tinyint', unsigned: true })
  mental!: number;

  @Column({ type: 'tinyint', unsigned: true })
  championPool!: number;

  @Column({ type: 'tinyint', unsigned: true })
  potential!: number;
}
