import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Position } from '../../players/enums/position.enum';
import { CareerPlayer } from './career-player.entity';

@Entity({ name: 'career_player_position_proficiencies' })
@Unique('UQ_position_proficiencies_player_position', [
  'careerPlayerId',
  'position',
])
export class CareerPlayerPositionProficiency {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_position_proficiencies_career_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(
    () => CareerPlayer,
    (careerPlayer) => careerPlayer.positionProficiencies,
    { nullable: false, onDelete: 'CASCADE' },
  )
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_position_proficiencies_career_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'enum', enum: Position })
  position!: Position;

  @Column({ type: 'tinyint', unsigned: true })
  proficiency!: number;
}
