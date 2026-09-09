import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CareerPlayer } from '../../careers/entities/career-player.entity';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Career } from '../../careers/entities/career.entity';
import {
  type ContractOfferHistoryEntry,
  ContractOfferStatus,
  ContractOfferType,
  type ContractResponse,
  type ContractTerms,
} from '../contract.types';
import { TransferAgreement } from '../../transfers/entities/transfer-agreement.entity';

@Entity({ name: 'contract_offers' })
export class ContractOffer {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_contract_offers_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_contract_offers_career',
  })
  career!: Career;

  @Index('IDX_contract_offers_team_id')
  @Column({ type: 'int', unsigned: true })
  careerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerTeamId',
    foreignKeyConstraintName: 'FK_contract_offers_team',
  })
  careerTeam!: CareerTeam;

  @Index('IDX_contract_offers_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(() => CareerPlayer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_contract_offers_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({
    type: 'enum',
    enum: ContractOfferType,
    default: ContractOfferType.RENEWAL,
  })
  offerType!: ContractOfferType;

  @Index('IDX_contract_offers_source_team_id')
  @Column({ type: 'int', unsigned: true, nullable: true })
  sourceCareerTeamId!: number | null;

  @ManyToOne(() => CareerTeam, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'sourceCareerTeamId',
    foreignKeyConstraintName: 'FK_contract_offers_source_team',
  })
  sourceCareerTeam!: CareerTeam | null;

  @Index('IDX_contract_offers_transfer_agreement_id')
  @Column({ type: 'int', unsigned: true, nullable: true })
  transferAgreementId!: number | null;

  @ManyToOne(() => TransferAgreement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'transferAgreementId',
    foreignKeyConstraintName: 'FK_contract_offers_transfer_agreement',
  })
  transferAgreement!: TransferAgreement | null;

  @Column({
    type: 'enum',
    enum: ContractOfferStatus,
    default: ContractOfferStatus.WAITING_PLAYER_RESPONSE,
  })
  status!: ContractOfferStatus;

  @Column({ type: 'int', unsigned: true, default: 1 })
  revision!: number;

  @Column({ type: 'date' })
  offeredDate!: string;

  @Column({ type: 'date' })
  responseDate!: string;

  @Column({ type: 'int', unsigned: true, nullable: true })
  responseEventId!: number | null;

  @Column({ type: 'json' })
  terms!: ContractTerms;

  @Column({ type: 'json', nullable: true })
  counterTerms!: ContractTerms | null;

  @Column({ type: 'json', nullable: true })
  response!: ContractResponse | null;

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  extensionsUsed!: number;

  @Column({ type: 'json' })
  history!: ContractOfferHistoryEntry[];

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
