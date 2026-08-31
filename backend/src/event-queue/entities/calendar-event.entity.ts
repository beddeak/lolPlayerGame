import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Career } from '../../careers/entities/career.entity';
import { CalendarEventStatus } from '../enums/calendar-event-status.enum';
import { CalendarEventType } from '../enums/calendar-event-type.enum';

@Entity({ name: 'calendar_events' })
@Index('IDX_calendar_events_career_date', ['careerId', 'scheduledDate'])
@Index('IDX_calendar_events_career_status', ['careerId', 'status'])
export class CalendarEvent {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'int', unsigned: true })
  careerId!: number;

  @ManyToOne(() => Career, (career) => career.calendarEvents, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'careerId',
    foreignKeyConstraintName: 'FK_calendar_events_career',
  })
  career!: Career;

  @Column({ type: 'date' })
  scheduledDate!: string;

  @Column({ type: 'enum', enum: CalendarEventType })
  type!: CalendarEventType;

  @Column({
    type: 'enum',
    enum: CalendarEventStatus,
    default: CalendarEventStatus.SCHEDULED,
  })
  status!: CalendarEventStatus;

  @Column({ type: 'boolean', default: false })
  requiresUserAction!: boolean;

  @Column({ type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({ type: 'timestamp', precision: 0, nullable: true })
  completedAt!: Date | null;
}
