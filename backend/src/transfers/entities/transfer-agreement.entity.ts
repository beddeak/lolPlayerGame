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
import { TransferAgreementStatus } from '../transfer.types';

@Entity({ name: 'transfer_agreements' })
@Index('IDX_transfer_agreements_buyer_status', ['buyerCareerTeamId', 'status'])
export class TransferAgreement {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('IDX_transfer_agreements_career_id')
  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_transfer_agreements_career',
  })
  career!: Career;

  @Column({ type: 'int', unsigned: true })
  buyerCareerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'buyerCareerTeamId',
    foreignKeyConstraintName: 'FK_transfer_agreements_buyer_team',
  })
  buyerCareerTeam!: CareerTeam;

  @Index('IDX_transfer_agreements_seller_team_id')
  @Column({ type: 'int', unsigned: true })
  sellerCareerTeamId!: number;

  @ManyToOne(() => CareerTeam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'sellerCareerTeamId',
    foreignKeyConstraintName: 'FK_transfer_agreements_seller_team',
  })
  sellerCareerTeam!: CareerTeam;

  @Index('IDX_transfer_agreements_player_id')
  @Column({ type: 'int', unsigned: true })
  careerPlayerId!: number;

  @ManyToOne(() => CareerPlayer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'careerPlayerId',
    foreignKeyConstraintName: 'FK_transfer_agreements_player',
  })
  careerPlayer!: CareerPlayer;

  @Column({ type: 'int', unsigned: true })
  offeredFee!: number;

  @Column({ type: 'int', unsigned: true })
  requiredFee!: number;

  @Column({ type: 'enum', enum: TransferAgreementStatus })
  status!: TransferAgreementStatus;

  @Column({ type: 'date' })
  offeredDate!: string;

  @Column({ type: 'date' })
  resolvedDate!: string;

  @Column({ type: 'varchar', length: 255 })
  reason!: string;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
