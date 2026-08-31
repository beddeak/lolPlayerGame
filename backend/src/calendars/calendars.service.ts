import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CalendarEventResponseDto } from '../event-queue/dto/calendar-event-response.dto';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { EventQueueService } from '../event-queue/event-queue.service';
import { getSeriesWinsRequired } from '../match-series/config/bo3-series.config';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import {
  addCalendarDays,
  calendarDaysBetween,
  getCalendarYear,
} from './calendar-date';
import { AdvanceCalendarDto } from './dto/advance-calendar.dto';
import {
  CalendarAdvanceResponseDto,
  CalendarFixtureResponseDto,
  CalendarResponseDto,
} from './dto/calendar-response.dto';
import { CalendarAdvanceMode } from './enums/calendar-advance-mode.enum';
import { CalendarStopReason } from './enums/calendar-stop-reason.enum';

@Injectable()
export class CalendarsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Career)
    private readonly careersRepository: Repository<Career>,
    @InjectRepository(LeagueFixture)
    private readonly fixturesRepository: Repository<LeagueFixture>,
    private readonly eventQueueService: EventQueueService,
  ) {}

  async findOne(
    accountId: number,
    careerId: number,
  ): Promise<CalendarResponseDto> {
    const career = await this.careersRepository.findOneBy({
      id: careerId,
      accountId,
    });

    if (!career) {
      throw new NotFoundException(`Career ${careerId} was not found`);
    }

    const fixtures = await this.findIncompleteFixtures(
      this.fixturesRepository,
      careerId,
    );

    const blockingEvents = await this.eventQueueService.findBlockingEvents(
      this.dataSource.manager,
      careerId,
      career.currentDate,
    );

    return this.toResponse(career, fixtures, blockingEvents);
  }

  async advance(
    accountId: number,
    careerId: number,
    dto: AdvanceCalendarDto,
  ): Promise<CalendarAdvanceResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const career = await manager.findOne(Career, {
        where: { id: careerId, accountId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!career) {
        throw new NotFoundException(`Career ${careerId} was not found`);
      }

      const fixtures = await this.findIncompleteFixtures(manager, careerId);
      const previousDate = career.currentDate;
      const nextEvent =
        dto.mode === CalendarAdvanceMode.NEXT_EVENT
          ? await this.eventQueueService.findNextScheduledEvent(
              manager,
              careerId,
            )
          : null;
      const processedEvents: CalendarEventResponseDto[] = [];
      let blockingEvents: CalendarEventResponseDto[] = [];
      let stopReason = CalendarStopReason.TARGET_REACHED;
      const currentDayResult = await this.eventQueueService.processThroughDate(
        manager,
        careerId,
        career.currentDate,
      );

      processedEvents.push(...currentDayResult.processedEvents);
      blockingEvents = await this.eventQueueService.findBlockingEvents(
        manager,
        careerId,
        career.currentDate,
      );

      if (blockingEvents.length > 0) {
        stopReason = CalendarStopReason.BLOCKING_EVENT;
      } else if (this.hasDueMatch(fixtures, career.currentDate)) {
        stopReason = CalendarStopReason.MATCH_DAY;
      } else {
        const requestedDate = this.getRequestedDate(
          career,
          fixtures,
          dto.mode,
          nextEvent,
        );

        while (career.currentDate < requestedDate) {
          career.currentDate = addCalendarDays(career.currentDate, 1);
          career.currentYear = getCalendarYear(career.currentDate);
          const dayResult = await this.eventQueueService.processThroughDate(
            manager,
            careerId,
            career.currentDate,
          );

          processedEvents.push(...dayResult.processedEvents);
          blockingEvents = await this.eventQueueService.findBlockingEvents(
            manager,
            careerId,
            career.currentDate,
          );

          if (blockingEvents.length > 0) {
            stopReason = CalendarStopReason.BLOCKING_EVENT;
            break;
          }

          if (this.hasDueMatch(fixtures, career.currentDate)) {
            stopReason = CalendarStopReason.MATCH_DAY;
            break;
          }
        }
      }

      await manager.save(Career, career);

      return {
        ...this.toResponse(career, fixtures, blockingEvents),
        mode: dto.mode,
        previousDate,
        advancedDays: calendarDaysBetween(previousDate, career.currentDate),
        stopReason,
        processedEvents,
      };
    });
  }

  private getRequestedDate(
    career: Career,
    fixtures: LeagueFixture[],
    mode: CalendarAdvanceMode,
    nextEvent: CalendarEvent | null,
  ): string {
    if (mode === CalendarAdvanceMode.ONE_DAY) {
      return addCalendarDays(career.currentDate, 1);
    }

    if (mode === CalendarAdvanceMode.THREE_DAYS) {
      return addCalendarDays(career.currentDate, 3);
    }

    if (mode === CalendarAdvanceMode.NEXT_EVENT) {
      if (!nextEvent) {
        throw new ConflictException(
          `Career ${career.id} does not have a scheduled event`,
        );
      }

      return nextEvent.scheduledDate <= career.currentDate
        ? career.currentDate
        : nextEvent.scheduledDate;
    }

    const nextMatch = fixtures[0];

    if (!nextMatch) {
      throw new ConflictException(
        `Career ${career.id} does not have a scheduled match`,
      );
    }

    return nextMatch.scheduledDate <= career.currentDate
      ? career.currentDate
      : nextMatch.scheduledDate;
  }

  private async findIncompleteFixtures(
    repository: Repository<LeagueFixture> | EntityManager,
    careerId: number,
  ): Promise<LeagueFixture[]> {
    const fixtureRepository =
      'getRepository' in repository
        ? repository.getRepository(LeagueFixture)
        : repository;
    const fixtures = await fixtureRepository.find({
      where: { leagueSplit: { careerId } },
      relations: {
        leagueSplit: true,
        leagueStage: true,
        teamA: true,
        teamB: true,
        series: { games: true },
      },
      order: { scheduledDate: 'ASC', id: 'ASC' },
    });

    return fixtures.filter((fixture) => !this.isCompleted(fixture));
  }

  private isCompleted(fixture: LeagueFixture): boolean {
    if (!fixture.series) {
      return false;
    }

    const winsRequired = getSeriesWinsRequired(fixture.bestOf);
    const wins = new Map<number, number>();

    for (const game of fixture.series.games ?? []) {
      wins.set(game.winnerTeamId, (wins.get(game.winnerTeamId) ?? 0) + 1);
    }

    return [...wins.values()].some((count) => count >= winsRequired);
  }

  private toResponse(
    career: Career,
    fixtures: LeagueFixture[],
    blockingEvents: CalendarEventResponseDto[],
  ): CalendarResponseDto {
    const dueMatches = fixtures.filter(
      (fixture) => fixture.scheduledDate <= career.currentDate,
    );

    return {
      careerId: career.id,
      currentDate: career.currentDate,
      currentYear: career.currentYear,
      nextMatch: fixtures[0] ? this.toFixtureResponse(fixtures[0]) : null,
      dueMatches: dueMatches.map((fixture) => this.toFixtureResponse(fixture)),
      blockingEvents,
    };
  }

  private hasDueMatch(fixtures: LeagueFixture[], date: string): boolean {
    return fixtures.some((fixture) => fixture.scheduledDate <= date);
  }

  private toFixtureResponse(
    fixture: LeagueFixture,
  ): CalendarFixtureResponseDto {
    return {
      id: fixture.id,
      scheduledDate: fixture.scheduledDate,
      leagueSplitId: fixture.leagueSplitId,
      leagueStageId: fixture.leagueStageId,
      year: fixture.leagueSplit.year,
      region: fixture.leagueSplit.region,
      splitNumber: fixture.leagueSplit.splitNumber,
      stageCode: fixture.leagueStage.code,
      roundNumber: fixture.roundNumber,
      bestOf: fixture.bestOf,
      teamA: {
        id: fixture.teamA.id,
        code: fixture.teamA.code,
        name: fixture.teamA.name,
      },
      teamB: {
        id: fixture.teamB.id,
        code: fixture.teamB.code,
        name: fixture.teamB.name,
      },
    };
  }
}
