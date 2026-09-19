import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Account } from './account.entity';

export enum GoogleAuthAction {
  LOGIN = 'LOGIN',
  LINK = 'LINK',
}

@Entity({ name: 'google_auth_challenges' })
export class GoogleAuthChallenge {
  @PrimaryColumn({ type: 'char', length: 64, collation: 'utf8mb4_bin' })
  tokenHash!: string;

  @Column({ type: 'char', length: 64, collation: 'utf8mb4_bin' })
  nonceHash!: string;

  @Column({ type: 'enum', enum: GoogleAuthAction })
  action!: GoogleAuthAction;

  @Index('IDX_google_auth_challenges_account')
  @Column({ type: 'int', unsigned: true, nullable: true })
  accountId!: number | null;

  @Index('IDX_google_auth_challenges_expires')
  @Column({ type: 'datetime', precision: 3 })
  expiresAt!: Date;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_google_auth_challenges_account',
  })
  account!: Account | null;
}
