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
import { PlayerInstruction } from '../enums/player-instruction.enum';
import { CareerPlayer } from './career-player.entity';

@Entity({ name: 'career_player_role_proficiencies' })
@Unique('UQ_role_proficiencies_player_position_instruction', [
  'careerPlayerId',
  'position',
  'instruction',
])
export class CareerPlayerRoleProficiency {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_role_proficiencies_career_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(
    () => CareerPlayer,
    (careerPlayer) => careerPlayer.roleProficiencies,
    { nullable: false, onDelete: 'CASCADE' },
  )
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_role_proficiencies_career_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'enum', enum: Position })
  position!: Position;

  @Column({ type: 'enum', enum: PlayerInstruction })
  instruction!: PlayerInstruction;

  @Column({ type: 'tinyint', unsigned: true })
  proficiency!: number;
}
