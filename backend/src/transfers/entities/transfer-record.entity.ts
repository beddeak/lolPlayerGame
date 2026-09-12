import {
  Column,
  CreateDateColumn,
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
import { ContractOffer } from '../../contracts/entities/contract-offer.entity';
import { TransferRecordType } from '../transfer.types';
import { TransferAgreement } from './transfer-agreement.entity';

@Entity({ name: 'transfer_records' })
@Index('IDX_transfer_records_career_date', ['careerId', 'completedDate'])
@Unique('UQ_transfer_records_contract_offer', ['contractOfferId'])
@Unique('UQ_transfer_records_agreement', ['transferAgreementId'])
export class TransferRecord {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_transfer_records_career',
  })
  career!: Career;

  @Index('IDX_transfer_records_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(() => CareerPlayer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_transfer_records_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'int', unsigned: true, nullable: true })
  sourceCareerTeamId!: number | null;

  @ManyToOne(() => CareerTeam, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'sourceCareerTeamId',
    foreignKeyConstraintName: 'FK_transfer_records_source_team',
  })
  sourceCareerTeam!: CareerTeam | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  destinationCareerTeamId!: number | null;

  @ManyToOne(() => CareerTeam, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'destinationCareerTeamId',
    foreignKeyConstraintName: 'FK_transfer_records_destination_team',
  })
  destinationCareerTeam!: CareerTeam | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  transferAgreementId!: number | null;

  @ManyToOne(() => TransferAgreement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'transferAgreementId',
    foreignKeyConstraintName: 'FK_transfer_records_agreement',
  })
  transferAgreement!: TransferAgreement | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  contractOfferId!: number | null;

  @ManyToOne(() => ContractOffer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'contractOfferId',
    foreignKeyConstraintName: 'FK_transfer_records_contract_offer',
  })
  contractOffer!: ContractOffer | null;

  @Column({ type: 'enum', enum: TransferRecordType })
  type!: TransferRecordType;

  @Column({ type: 'int', unsigned: true, default: 0 })
  transferFee!: number;

  @Column({ type: 'date' })
  completedDate!: string;

  /** Actual managed starting lineup at the transfer boundary; legacy/AI-only records stay null. */
  @Column({ type: 'double', nullable: true })
  managerLineupBefore!: number | null;

  @Column({ type: 'double', nullable: true })
  managerLineupAfter!: number | null;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
