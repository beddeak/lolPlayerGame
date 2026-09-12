import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CalendarEventResponseDto } from './dto/calendar-event-response.dto';
import { FindCalendarEventsQueryDto } from './dto/find-calendar-events-query.dto';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventStatus } from './enums/calendar-event-status.enum';
import { CalendarEventType } from './enums/calendar-event-type.enum';
import { ContractsService } from '../contracts/contracts.service';
import { getTransferWindow } from '../transfers/transfer-window';
import { LegendsService } from '../legends/legends.service';

export interface EnqueueCalendarEventInput {
  scheduledDate: string;
  type: CalendarEventType;
  requiresUserAction: boolean;
  payload?: Record<string, unknown> | null;
}

export interface ProcessedCalendarEvents {
  processedEvents: CalendarEventResponseDto[];
  blockingEvents: CalendarEventResponseDto[];
}

@Injectable()
export class EventQueueService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Career)
    private readonly careersRepository: Repository<Career>,
    @InjectRepository(CalendarEvent)
    private readonly eventsRepository: Repository<CalendarEvent>,
    private readonly contractsService: ContractsService,
    private readonly legendsService: LegendsService,
  ) {}

  async findAll(
    accountId: number,
    careerId: number,
    query: FindCalendarEventsQueryDto,
  ): Promise<CalendarEventResponseDto[]> {
    await this.assertOwnedCareer(accountId, careerId);
    const events = await this.eventsRepository.find({
      where: {
        careerId,
        ...(query.status ? { status: query.status } : {}),
      },
      order: { scheduledDate: 'ASC', id: 'ASC' },
    });

    return events
      .filter(
        (event) =>
          event.type !== CalendarEventType.LEGEND_REVEAL ||
          event.status !== CalendarEventStatus.SCHEDULED,
      )
      .map((event) => this.toResponse(event));
  }

  async resolve(
    accountId: number,
    careerId: number,
    eventId: number,
  ): Promise<CalendarEventResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(CalendarEvent, {
        where: {
          id: eventId,
          careerId,
          career: { accountId },
        },
        relations: { career: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        !event ||
        (event.type === CalendarEventType.LEGEND_REVEAL &&
          event.status === CalendarEventStatus.SCHEDULED)
      ) {
        throw new NotFoundException(
          `CalendarEvent ${eventId} was not found in Career ${careerId}`,
        );
      }

      if (
        event.type === CalendarEventType.CONTRACT_RESPONSE &&
        event.payload?.contractOfferId !== undefined
      ) {
        throw new ConflictException('계약 응답은 계약 화면에서 결정해 주세요.');
      }

      if (!event.requiresUserAction) {
        throw new ConflictException(
          `CalendarEvent ${eventId} does not require user action`,
        );
      }

      if (event.status !== CalendarEventStatus.READY) {
        throw new ConflictException(
          `CalendarEvent ${eventId} is not ready to resolve`,
        );
      }

      event.status = CalendarEventStatus.COMPLETED;
      event.completedAt = new Date();
      const savedEvent = await manager.save(CalendarEvent, event);

      return this.toResponse(savedEvent);
    });
  }

  async enqueue(
    careerId: number,
    input: EnqueueCalendarEventInput,
    manager?: EntityManager,
  ): Promise<CalendarEvent> {
    const repository = (manager ?? this.dataSource.manager).getRepository(
      CalendarEvent,
    );
    const event = repository.create({
      careerId,
      scheduledDate: input.scheduledDate,
      type: input.type,
      status: CalendarEventStatus.SCHEDULED,
      requiresUserAction: input.requiresUserAction,
      payload: input.payload ?? null,
      completedAt: null,
    });

    return repository.save(event);
  }

  async processThroughDate(
    manager: EntityManager,
    careerId: number,
    date: string,
  ): Promise<ProcessedCalendarEvents> {
    // Every response path locks career -> event/offer to serialize calendar and contract decisions.
    const savedCareer = await manager.findOne(Career, {
      where: { id: careerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!savedCareer)
      throw new NotFoundException(`Career ${careerId} was not found`);
    // Calendar advancement saves its local date at transaction end, not before each day.
    const career = {
      ...savedCareer,
      currentDate: date,
      currentYear: Number(date.slice(0, 4)),
    };
    await this.legendsService.prepareSeason(manager, career, date);
    await this.contractsService.closeExpiredTransferNegotiations(
      manager,
      careerId,
      date,
    );
    const events = await manager.find(CalendarEvent, {
      where: {
        careerId,
        status: CalendarEventStatus.SCHEDULED,
        scheduledDate: LessThanOrEqual(date),
      },
      order: { scheduledDate: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    for (const event of events) {
      if (
        event.type === CalendarEventType.CONTRACT_EXPIRATION &&
        event.payload?.playerContractId !== undefined
      ) {
        await this.contractsService.processExpirationEvent(
          manager,
          event,
          date,
        );
      }
    }

    for (const event of events) {
      if (event.type === CalendarEventType.LEGEND_REVEAL) {
        await this.legendsService.revealEvent(manager, career, event, date);
      }
    }
    const legendNews = await this.legendsService.processCompetition(
      manager,
      career,
      date,
    );

    for (const event of events) {
      if (
        event.type === CalendarEventType.CONTRACT_RESPONSE &&
        event.payload?.contractOfferId !== undefined
      ) {
        await this.contractsService.processResponseEvent(manager, event, date);
      }
    }

    for (const event of events) {
      if (event.requiresUserAction) {
        event.status = CalendarEventStatus.READY;
      } else {
        event.status = CalendarEventStatus.COMPLETED;
        event.completedAt = new Date();
      }
    }

    if (events.length > 0) {
      await manager.save(CalendarEvent, events);
    }

    const processedEvents = [...events, ...legendNews].map((event) =>
      this.toResponse(event),
    );

    return {
      processedEvents,
      blockingEvents: processedEvents.filter(
        (event) => event.status === CalendarEventStatus.READY,
      ),
    };
  }

  async canAdvancePastTransferWindowClose(
    manager: EntityManager,
    careerId: number,
    date: string,
    blockingEvents: CalendarEventResponseDto[],
  ): Promise<boolean> {
    const window = getTransferWindow(date);
    if (
      !window.isOpen ||
      date !== window.endsAt ||
      blockingEvents.length === 0 ||
      blockingEvents.some(
        (event) => event.type !== CalendarEventType.CONTRACT_RESPONSE,
      )
    ) {
      return false;
    }
    return this.contractsService.areAcquisitionResponseEvents(
      manager,
      careerId,
      blockingEvents.map((event) => event.id),
    );
  }

  async findBlockingEvents(
    repository: EntityManager | Repository<CalendarEvent>,
    careerId: number,
    date: string,
  ): Promise<CalendarEventResponseDto[]> {
    const eventRepository =
      'getRepository' in repository
        ? repository.getRepository(CalendarEvent)
        : repository;
    const events = await eventRepository.find({
      where: {
        careerId,
        status: CalendarEventStatus.READY,
        requiresUserAction: true,
        scheduledDate: LessThanOrEqual(date),
      },
      order: { scheduledDate: 'ASC', id: 'ASC' },
    });

    return events.map((event) => this.toResponse(event));
  }

  async findNextScheduledEvent(
    repository: EntityManager | Repository<CalendarEvent>,
    careerId: number,
  ): Promise<CalendarEvent | null> {
    const eventRepository =
      'getRepository' in repository
        ? repository.getRepository(CalendarEvent)
        : repository;

    return eventRepository.findOne({
      where: { careerId, status: CalendarEventStatus.SCHEDULED },
      order: { scheduledDate: 'ASC', id: 'ASC' },
    });
  }

  private async assertOwnedCareer(
    accountId: number,
    careerId: number,
  ): Promise<void> {
    const exists = await this.careersRepository.existsBy({
      id: careerId,
      accountId,
    });

    if (!exists) {
      throw new NotFoundException(`Career ${careerId} was not found`);
    }
  }

  private toResponse(event: CalendarEvent): CalendarEventResponseDto {
    return {
      id: event.id,
      careerId: event.careerId,
      scheduledDate: event.scheduledDate,
      type: event.type,
      status: event.status,
      requiresUserAction: event.requiresUserAction,
      payload: event.payload,
      createdAt: event.createdAt,
      completedAt: event.completedAt,
    };
  }
}
