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
import { getTransferWindow } from '../transfers/transfer-window';
import {
  getFullSeasonCalendar,
  isSeasonBoundary,
} from './config/full-season-calendar';
import { getLeagueSplitWindow } from './config/season-calendar.config';
import { SeasonScheduleService } from './season-schedule.service';
import { assertManagerActive } from '../manager-career/manager-access';
import { ManagerCareerService } from '../manager-career/manager-career.service';

@Injectable()
export class CalendarsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Career)
    private readonly careersRepository: Repository<Career>,
    @InjectRepository(LeagueFixture)
    private readonly fixturesRepository: Repository<LeagueFixture>,
    private readonly eventQueueService: EventQueueService,
    private readonly seasonScheduleService: SeasonScheduleService,
    private readonly managerCareerService: ManagerCareerService,
  ) {}

  async startSeason(
    accountId: number,
    careerId: number,
  ): Promise<CalendarResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const career = await manager.findOne(Career, {
        where: { id: careerId, accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!career)
        throw new NotFoundException(`Career ${careerId} was not found`);
      await assertManagerActive(manager, careerId);
      career.autoSchedule = true;
      await manager.save(Career, career);
      await this.seasonScheduleService.prepare(manager, career);
      const fixtures = await this.findIncompleteFixtures(manager, careerId);
      const blockingEvents = await this.eventQueueService.findBlockingEvents(
        manager,
        careerId,
        career.currentDate,
      );
      return this.toResponse(career, fixtures, blockingEvents, manager);
    });
  }

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

      await assertManagerActive(manager, careerId);

      let fixtures = await this.findIncompleteFixtures(manager, careerId);
      const previousDate = career.currentDate;
      const processedEvents: CalendarEventResponseDto[] = [];
      let blockingEvents: CalendarEventResponseDto[] = [];
      let stopReason = CalendarStopReason.TARGET_REACHED;
      const currentDayResult = await this.eventQueueService.processThroughDate(
        manager,
        careerId,
        career.currentDate,
      );

      processedEvents.push(...currentDayResult.processedEvents);
      if (career.autoSchedule) {
        await this.seasonScheduleService.prepare(manager, career);
        fixtures = await this.findIncompleteFixtures(manager, careerId);
      }
      blockingEvents = await this.eventQueueService.findBlockingEvents(
        manager,
        careerId,
        career.currentDate,
      );

      if (blockingEvents.length > 0) {
        const canCloseWindow = await this.canCloseTransferWindow(
          manager,
          career,
          fixtures,
          blockingEvents,
        );
        if (!canCloseWindow) {
          stopReason = CalendarStopReason.BLOCKING_EVENT;
        } else {
          if (dto.mode === CalendarAdvanceMode.NEXT_MATCH && !fixtures.length) {
            throw new ConflictException(
              `Career ${careerId} does not have a scheduled match`,
            );
          }
          career.currentDate = addCalendarDays(career.currentDate, 1);
          career.currentYear = getCalendarYear(career.currentDate);
          const closeResult = await this.eventQueueService.processThroughDate(
            manager,
            careerId,
            career.currentDate,
          );
          processedEvents.push(...closeResult.processedEvents);
          if (career.autoSchedule) {
            await this.seasonScheduleService.prepare(manager, career);
            fixtures = await this.findIncompleteFixtures(manager, careerId);
          }
          blockingEvents = await this.eventQueueService.findBlockingEvents(
            manager,
            careerId,
            career.currentDate,
          );
          stopReason =
            blockingEvents.length > 0
              ? CalendarStopReason.BLOCKING_EVENT
              : this.hasDueMatch(fixtures, career.currentDate)
                ? CalendarStopReason.MATCH_DAY
                : CalendarStopReason.TARGET_REACHED;
        }
      } else if (this.hasDueMatch(fixtures, career.currentDate)) {
        stopReason = CalendarStopReason.MATCH_DAY;
      } else {
        const nextEvent =
          dto.mode === CalendarAdvanceMode.NEXT_EVENT
            ? await this.eventQueueService.findNextScheduledEvent(
                manager,
                careerId,
              )
            : null;
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
          if (career.autoSchedule) {
            await this.seasonScheduleService.prepare(manager, career);
            fixtures = await this.findIncompleteFixtures(manager, careerId);
          }
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

      if (
        stopReason === CalendarStopReason.TARGET_REACHED &&
        getTransferWindow(previousDate).isOpen !==
          getTransferWindow(career.currentDate).isOpen
      ) {
        stopReason = CalendarStopReason.TRANSFER_WINDOW_BOUNDARY;
      } else if (
        stopReason === CalendarStopReason.TARGET_REACHED &&
        isSeasonBoundary(previousDate, career.currentDate)
      ) {
        stopReason = CalendarStopReason.SEASON_BOUNDARY;
      }

      await manager.save(Career, career);

      return {
        ...(await this.toResponse(career, fixtures, blockingEvents, manager)),
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
    const boundary = getFullSeasonCalendar(career.currentDate).nextBoundaryDate;
    let requestedDate: string;
    if (mode === CalendarAdvanceMode.ONE_DAY) {
      requestedDate = addCalendarDays(career.currentDate, 1);
    } else if (mode === CalendarAdvanceMode.THREE_DAYS) {
      requestedDate = addCalendarDays(career.currentDate, 3);
    } else if (mode === CalendarAdvanceMode.NEXT_EVENT) {
      if (!nextEvent && !boundary) {
        throw new ConflictException(
          `Career ${career.id} does not have a scheduled event`,
        );
      }
      requestedDate = [nextEvent?.scheduledDate, boundary]
        .filter((date): date is string => !!date)
        .sort()[0];
    } else {
      const nextMatch = fixtures[0];
      if (!nextMatch) {
        throw new ConflictException(
          `Career ${career.id} does not have a scheduled match`,
        );
      }
      requestedDate = nextMatch.scheduledDate;
    }
    if (boundary && boundary > career.currentDate && boundary < requestedDate) {
      requestedDate = boundary;
    }
    return requestedDate <= career.currentDate
      ? career.currentDate
      : requestedDate;
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

  private async toResponse(
    career: Career,
    fixtures: LeagueFixture[],
    blockingEvents: CalendarEventResponseDto[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<CalendarResponseDto> {
    const dueMatches = fixtures.filter(
      (fixture) => fixture.scheduledDate <= career.currentDate,
    );

    return {
      careerId: career.id,
      currentDate: career.currentDate,
      currentYear: career.currentYear,
      manager: await this.managerCareerService.describe(manager, career),
      autoSchedule: !!career.autoSchedule,
      season: getFullSeasonCalendar(career.currentDate),
      seasonReadiness: await this.seasonScheduleService.describe(
        manager,
        career,
      ),
      scheduleWarnings: fixtures.flatMap((fixture) => {
        const window = getLeagueSplitWindow(
          fixture.leagueSplit.year,
          fixture.leagueSplit.splitNumber,
        );
        if (fixture.scheduledDate <= window.endsAt) return [];
        return [
          {
            fixtureId: fixture.id,
            leagueSplitId: fixture.leagueSplitId,
            scheduledDate: fixture.scheduledDate,
            expectedEndDate: window.endsAt,
            message: `${fixture.leagueSplit.region} Split ${fixture.leagueSplit.splitNumber}: 기존 또는 늦게 시작한 일정이 시즌 기간을 넘었습니다. 경기 기록은 보존하며 미완료 경기를 먼저 진행합니다.`,
          },
        ];
      }),
      transferWindow: getTransferWindow(career.currentDate),
      canCloseTransferWindow: await this.canCloseTransferWindow(
        manager,
        career,
        fixtures,
        blockingEvents,
      ),
      nextMatch: fixtures[0] ? this.toFixtureResponse(fixtures[0]) : null,
      dueMatches: dueMatches.map((fixture) => this.toFixtureResponse(fixture)),
      blockingEvents,
    };
  }

  private hasDueMatch(fixtures: LeagueFixture[], date: string): boolean {
    return fixtures.some((fixture) => fixture.scheduledDate <= date);
  }

  private async canCloseTransferWindow(
    manager: EntityManager,
    career: Career,
    fixtures: LeagueFixture[],
    blockingEvents: CalendarEventResponseDto[],
  ): Promise<boolean> {
    if (this.hasDueMatch(fixtures, career.currentDate)) return false;
    return this.eventQueueService.canAdvancePastTransferWindowClose(
      manager,
      career.id,
      career.currentDate,
      blockingEvents,
    );
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
