import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { RosterRole } from '../../careers/enums/roster-role.enum';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { Position } from '../../players/enums/position.enum';
import { Club } from './club.entity';

@Entity({ name: 'club_roster_templates' })
@Unique('UQ_club_roster_templates_club_card', ['clubId', 'playerCardId'])
@Unique('UQ_club_roster_templates_club_position', ['clubId', 'position'])
export class ClubRoster {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_club_roster_templates_club_id')
  @Column({ type: 'int', unsigned: true })
  clubId!: number;

  @ManyToOne(() => Club, (club) => club.rosters, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'clubId',
    foreignKeyConstraintName: 'FK_club_roster_templates_club',
  })
  club!: Club;

  @Index('IDX_club_roster_templates_player_card_id')
  @Column({ type: 'int', unsigned: true })
  playerCardId!: number;

  @ManyToOne(() => PlayerCard, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'playerCardId',
    foreignKeyConstraintName: 'FK_club_roster_templates_player_card',
  })
  playerCard!: PlayerCard;

  @Column({ type: 'enum', enum: RosterRole })
  role!: RosterRole;

  @Column({ type: 'enum', enum: Position, nullable: true })
  position!: Position | null;

  @Column({ type: 'enum', enum: ChampionArchetype, nullable: true })
  championArchetype!: ChampionArchetype | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  initialCoachTrust!: number | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  initialForm!: number | null;
}
