import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';

export enum SocialProvider {
  GOOGLE = 'GOOGLE',
}

@Entity({ name: 'social_identities' })
@Index('UQ_social_identities_provider_subject', ['provider', 'subject'], {
  unique: true,
})
@Index('UQ_social_identities_account_provider', ['accountId', 'provider'], {
  unique: true,
})
export class SocialIdentity {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'enum', enum: SocialProvider })
  provider!: SocialProvider;

  @Column({ type: 'varchar', length: 255, collation: 'utf8mb4_bin' })
  subject!: string;

  @Column({ type: 'int', unsigned: true })
  accountId!: number;

  @Column({ type: 'varchar', length: 191 })
  email!: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_social_identities_account',
  })
  account!: Account;
}
