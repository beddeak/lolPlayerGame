import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CareerPlayer } from '../../careers/entities/career-player.entity';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Career } from '../../careers/entities/career.entity';
import {
  type ContractPromiseRecord,
  type ContractTerms,
  PlayerContractStatus,
} from '../contract.types';
import { ContractOffer } from './contract-offer.entity';

@Entity({ name: 'player_contracts' })
@Unique('UQ_player_contracts_player', ['careerPlayerId'])
@Unique('UQ_player_contracts_source_offer', ['sourceOfferId'])
export class PlayerContract {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_player_contracts_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_player_contracts_career',
  })
  career!: Career;

  @Index('IDX_player_contracts_team_id')
  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_player_contracts_team',
  })
  careerTeam!: CareerTeam;

  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(() => CareerPlayer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_player_contracts_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'int', unsigned: true })
  sourceOfferId!: number;

  @ManyToOne(() => ContractOffer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'sourceOfferId',
    foreignKeyConstraintName: 'FK_player_contracts_source_offer',
  })
  sourceOffer!: ContractOffer;

  @Column({ type: 'date' })
  signedDate!: string;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({
    type: 'enum',
    enum: PlayerContractStatus,
    default: PlayerContractStatus.ACTIVE,
  })
  status!: PlayerContractStatus;

  @Column({ type: 'date', nullable: true })
  endedDate!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endReason!: string | null;

  @Column({ type: 'json' })
  terms!: ContractTerms;

  @Column({ type: 'json' })
  promises!: ContractPromiseRecord[];
}
