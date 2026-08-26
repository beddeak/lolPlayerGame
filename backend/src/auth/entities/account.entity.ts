import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Career } from '../../careers/entities/career.entity';

@Entity({ name: 'accounts' })
export class Account {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Index('UQ_accounts_email', { unique: true })
  @Column({ type: 'varchar', length: 191 })
  email!: string;

  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 50 })
  displayName!: string;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;

  @OneToMany(() => Career, (career) => career.account)
  careers!: Career[];
}
