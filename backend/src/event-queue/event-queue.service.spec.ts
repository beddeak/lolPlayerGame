import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventStatus } from './enums/calendar-event-status.enum';
import { CalendarEventType } from './enums/calendar-event-type.enum';
import { EventQueueService } from './event-queue.service';

describe('EventQueueService', () => {
  const career = { id: 1, accountId: 7 } as Career;
  const eventsRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value: CalendarEvent) => value),
    save: jest.fn((value: CalendarEvent) => Promise.resolve(value)),
  };
  const careersRepository = {
    existsBy: jest.fn(),
  };
  const entityManager = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((_: unknown, value: unknown) => Promise.resolve(value)),
    getRepository: jest.fn(() => eventsRepository),
  };
  const dataSource = {
    manager: entityManager,
    transaction: jest.fn(
      (work: (manager: typeof entityManager) => Promise<unknown>) =>
        work(entityManager),
    ),
  };

  let service: EventQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    careersRepository.existsBy.mockResolvedValue(true);
    eventsRepository.find.mockResolvedValue([]);
    eventsRepository.findOne.mockResolvedValue(null);
    entityManager.find.mockResolvedValue([]);
    entityManager.findOne.mockResolvedValue(null);
    service = new EventQueueService(
      dataSource as unknown as DataSource,
      careersRepository as unknown as Repository<Career>,
      eventsRepository as unknown as Repository<CalendarEvent>,
    );
  });

  it('returns an owned career event queue in schedule order', async () => {
    const event = createEvent(1, false);
    eventsRepository.find.mockResolvedValue([event]);

    const result = await service.findAll(7, career.id, {});

    expect(result.map((item) => item.id)).toEqual([event.id]);
    expect(eventsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { careerId: career.id },
        order: { scheduledDate: 'ASC', id: 'ASC' },
      }),
    );
  });

  it('does not expose another account career queue', async () => {
    careersRepository.existsBy.mockResolvedValue(false);

    await expect(service.findAll(8, career.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('auto-completes non-blocking events and readies blocking events', async () => {
    const newsEvent = createEvent(1, false);
    const meetingEvent = createEvent(2, true);
    entityManager.find.mockResolvedValue([newsEvent, meetingEvent]);

    const result = await service.processThroughDate(
      entityManager as never,
      career.id,
      '2026-11-23',
    );

    expect(newsEvent.status).toBe(CalendarEventStatus.COMPLETED);
    expect(newsEvent.completedAt).toBeInstanceOf(Date);
    expect(meetingEvent.status).toBe(CalendarEventStatus.READY);
    expect(meetingEvent.completedAt).toBeNull();
    expect(result.blockingEvents.map((event) => event.id)).toEqual([
      meetingEvent.id,
    ]);
  });

  it('resolves a ready user-action event', async () => {
    const event = createEvent(2, true);
    event.status = CalendarEventStatus.READY;
    entityManager.findOne.mockResolvedValue(event);

    const result = await service.resolve(7, career.id, event.id);

    expect(result.status).toBe(CalendarEventStatus.COMPLETED);
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('rejects resolving scheduled or non-blocking events', async () => {
    const scheduledEvent = createEvent(2, true);
    entityManager.findOne.mockResolvedValue(scheduledEvent);

    await expect(
      service.resolve(7, career.id, scheduledEvent.id),
    ).rejects.toBeInstanceOf(ConflictException);

    const nonBlockingEvent = createEvent(3, false);
    nonBlockingEvent.status = CalendarEventStatus.READY;
    entityManager.findOne.mockResolvedValue(nonBlockingEvent);

    await expect(
      service.resolve(7, career.id, nonBlockingEvent.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enqueues future module events as scheduled', async () => {
    const event = await service.enqueue(career.id, {
      scheduledDate: '2026-11-19',
      type: CalendarEventType.TRANSFER_WINDOW_OPEN,
      requiresUserAction: false,
      payload: { season: 2026 },
    });

    expect(event).toEqual(
      expect.objectContaining({
        careerId: career.id,
        scheduledDate: '2026-11-19',
        type: CalendarEventType.TRANSFER_WINDOW_OPEN,
        status: CalendarEventStatus.SCHEDULED,
        requiresUserAction: false,
        payload: { season: 2026 },
      }),
    );
  });
});

function createEvent(id: number, requiresUserAction: boolean): CalendarEvent {
  return {
    id,
    careerId: 1,
    scheduledDate: '2026-11-23',
    type: CalendarEventType.PLAYER_MEETING,
    status: CalendarEventStatus.SCHEDULED,
    requiresUserAction,
    payload: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
  } as CalendarEvent;
}
