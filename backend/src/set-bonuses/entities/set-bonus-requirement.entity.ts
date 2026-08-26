import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { SetBonus } from './set-bonus.entity';

@Entity({ name: 'set_bonus_requirements' })
export class SetBonusRequirement {
  @PrimaryColumn({ type: 'int', unsigned: true })
  setBonusId!: number;

  @ManyToOne(() => SetBonus, (setBonus) => setBonus.requirements, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'setBonusId',
    foreignKeyConstraintName: 'FK_set_bonus_requirements_set_bonus',
  })
  setBonus!: SetBonus;

  @Index('IDX_set_bonus_requirements_player_card_id')
  @PrimaryColumn({ type: 'int', unsigned: true })
  playerCardId!: number;

  @ManyToOne(() => PlayerCard, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'playerCardId',
    foreignKeyConstraintName: 'FK_set_bonus_requirements_player_card',
  })
  playerCard!: PlayerCard;
}
