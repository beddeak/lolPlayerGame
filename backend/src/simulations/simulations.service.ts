import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CalendarsService } from '../calendars/calendars.service';
import {
  addCalendarDays,
  calendarDaysBetween,
} from '../calendars/calendar-date';
import { CalendarResponseDto } from '../calendars/dto/calendar-response.dto';
import { CalendarAdvanceMode } from '../calendars/enums/calendar-advance-mode.enum';
import { CalendarStopReason } from '../calendars/enums/calendar-stop-reason.enum';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Career } from '../careers/entities/career.entity';
import { CalendarEventResponseDto } from '../event-queue/dto/calendar-event-response.dto';
import { EventQueueService } from '../event-queue/event-queue.service';
import { LeagueFixtureGameResponseDto } from '../leagues/dto/league-split-response.dto';
import { LeagueFixtureStatus } from '../leagues/enums/league-fixture-status.enum';
import { LeaguesService } from '../leagues/leagues.service';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import { SIMULATION_CONFIG } from './config/simulation.config';
import { FastSimDto } from './dto/fast-sim.dto';
import { QuickSimDto } from './dto/quick-sim.dto';
import {
  FastSimFixtureResponseDto,
  FastSimResponseDto,
  QuickSimResponseDto,
} from './dto/simulation-response.dto';
import { FastSimStopReason } from './enums/fast-sim-stop-reason.enum';
import { SimulationMode } from './enums/simulation-mode.enum';
import { InternationalsService } from '../internationals/internationals.service';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { TrainingSession } from '../careers/entities/training-session.entity';
import { TrainingCategory } from '../careers/enums/training-category.enum';
import { getTrainingWeek } from '../careers/config/training-week';
import {
  assertManagerActive,
  withExpectedManagerTeam,
} from '../manager-career/manager-access';

interface PreparedSimulationDate {
  career: Career;
  blockingEvents: CalendarEventResponseDto[];
}

@Injectable()
export class SimulationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CareerTeam)
    private readonly careerTeamsRepository: Repository<CareerTeam>,
    private readonly calendarsService: CalendarsService,
    private readonly eventQueueService: EventQueueService,
    private readonly leaguesService: LeaguesService,
    private readonly internationalsService: InternationalsService,
  ) {}

  async quickSim(
    accountId: number,
    careerId: number,
    dto: QuickSimDto,
  ): Promise<QuickSimResponseDto> {
    const prepared = await this.prepareCurrentDate(accountId, careerId);

    if (prepared.blockingEvents.length > 0) {
      throw new ConflictException(
        `Career ${careerId} has unresolved blocking events: ${prepared.blockingEvents
          .map((event) => event.id)
          .join(', ')}`,
      );
    }

    const managedTeam = await this.findManagedTeam(accountId, careerId);
    return withExpectedManagerTeam(careerId, managedTeam.id, () =>
      this.runQuickSim(accountId, careerId, dto),
    );
  }

  async fastSim(
    accountId: number,
    careerId: number,
    dto: FastSimDto,
  ): Promise<FastSimResponseDto> {
    if (dto.focusManagedTeam)
      return this.continueToDecision(accountId, careerId, dto);
    const prepared = await this.prepareCurrentDate(accountId, careerId);
    const previousDate = prepared.career.currentDate;
    const targetDate = addCalendarDays(previousDate, dto.days);
    const fixtureLimit =
      dto.maxFixtures ?? SIMULATION_CONFIG.defaultFastSimFixtureLimit;
    const managedTeam = await this.findManagedTeam(accountId, careerId);
    return withExpectedManagerTeam(careerId, managedTeam.id, async () => {
      const simulatedFixtures: FastSimFixtureResponseDto[] = [];
      let calendar = await this.calendarsService.findOne(accountId, careerId);

      if (prepared.blockingEvents.length > 0) {
        const closedCalendar = await this.advancePastClosingTransferBlockers(
          accountId,
          careerId,
          calendar,
          targetDate,
        );
        if (closedCalendar) {
          return this.toFastSimResponse(
            previousDate,
            targetDate,
            fixtureLimit,
            FastSimStopReason.TRANSFER_WINDOW_BOUNDARY,
            simulatedFixtures,
            closedCalendar,
          );
        }
        return this.toFastSimResponse(
          previousDate,
          targetDate,
          fixtureLimit,
          FastSimStopReason.BLOCKING_EVENT,
          simulatedFixtures,
          calendar,
        );
      }

      while (true) {
        if (calendar.manager?.status === 'DISMISSED') {
          return this.toFastSimResponse(
            previousDate,
            targetDate,
            fixtureLimit,
            FastSimStopReason.MANAGER_DISMISSED,
            simulatedFixtures,
            calendar,
          );
        }
        if (calendar.blockingEvents.length > 0) {
          const closedCalendar = await this.advancePastClosingTransferBlockers(
            accountId,
            careerId,
            calendar,
            targetDate,
          );
          if (closedCalendar) {
            return this.toFastSimResponse(
              previousDate,
              targetDate,
              fixtureLimit,
              FastSimStopReason.TRANSFER_WINDOW_BOUNDARY,
              simulatedFixtures,
              closedCalendar,
            );
          }
          return this.toFastSimResponse(
            previousDate,
            targetDate,
            fixtureLimit,
            FastSimStopReason.BLOCKING_EVENT,
            simulatedFixtures,
            calendar,
          );
        }

        const aiFixtures = calendar.dueMatches.filter(
          (fixture) => !this.includesTeam(fixture, managedTeam.id),
        );

        for (const fixture of aiFixtures) {
          if (simulatedFixtures.length >= fixtureLimit) {
            calendar = await this.calendarsService.findOne(accountId, careerId);

            return this.toFastSimResponse(
              previousDate,
              targetDate,
              fixtureLimit,
              FastSimStopReason.FIXTURE_LIMIT,
              simulatedFixtures,
              calendar,
            );
          }

          const result = await this.runQuickSim(accountId, careerId, {
            leagueSplitId: fixture.leagueSplitId,
            fixtureId: fixture.id,
          });
          simulatedFixtures.push(
            this.toFastSimFixture(result, fixture.scheduledDate),
          );
        }

        calendar = await this.calendarsService.findOne(accountId, careerId);

        if (
          calendar.dueMatches.some((fixture) =>
            this.includesTeam(fixture, managedTeam.id),
          )
        ) {
          return this.toFastSimResponse(
            previousDate,
            targetDate,
            fixtureLimit,
            FastSimStopReason.MANAGED_MATCH,
            simulatedFixtures,
            calendar,
          );
        }

        if (calendar.currentDate >= targetDate) {
          return this.toFastSimResponse(
            previousDate,
            targetDate,
            fixtureLimit,
            FastSimStopReason.TARGET_REACHED,
            simulatedFixtures,
            calendar,
          );
        }

        const wasWindowOpen = calendar.transferWindow.isOpen;
        const advanced = await this.calendarsService.advance(
          accountId,
          careerId,
          {
            mode: CalendarAdvanceMode.ONE_DAY,
          },
        );
        calendar = advanced;
        if (calendar.transferWindow.isOpen !== wasWindowOpen) {
          return this.toFastSimResponse(
            previousDate,
            targetDate,
            fixtureLimit,
            FastSimStopReason.TRANSFER_WINDOW_BOUNDARY,
            simulatedFixtures,
            calendar,
          );
        }
        if (advanced.stopReason === CalendarStopReason.SEASON_BOUNDARY) {
          return this.toFastSimResponse(
            previousDate,
            targetDate,
            fixtureLimit,
            FastSimStopReason.SEASON_BOUNDARY,
            simulatedFixtures,
            calendar,
          );
        }
      }
    });
  }

  /** Bounded batches keep cancellation possible without discarding committed games. */
  private async continueToDecision(
    accountId: number,
    careerId: number,
    dto: FastSimDto,
  ): Promise<FastSimResponseDto> {
    const prepared = await this.prepareCurrentDate(accountId, careerId);
    const previousDate = prepared.career.currentDate;
    const targetDate = addCalendarDays(previousDate, dto.days);
    const limit =
      dto.maxFixtures ?? SIMULATION_CONFIG.defaultFastSimFixtureLimit;
    const managed = await this.findManagedTeam(accountId, careerId);
    return withExpectedManagerTeam(careerId, managed.id, async () => {
      let calendar = await this.calendarsService.findOne(accountId, careerId);
      const domestic: FastSimFixtureResponseDto[] = [];
      const international: Array<{ tournamentId: number; fixtureId: number }> =
        [];
      let checkedWeek = '';
      const finish = (reason: FastSimStopReason) => ({
        ...this.toFastSimResponse(
          previousDate,
          targetDate,
          limit,
          reason,
          domestic,
          calendar,
        ),
        simulatedInternationalFixtures: international,
      });
      while (true) {
        if (calendar.manager?.status === 'DISMISSED')
          return finish(FastSimStopReason.MANAGER_DISMISSED);
        const blockers = calendar.blockingEvents;
        const isInternationalGame = (event: CalendarEventResponseDto) =>
          event.type === CalendarEventType.SCHEDULED_GAME &&
          typeof event.payload?.internationalFixtureId === 'number' &&
          typeof event.payload?.tournamentId === 'number';
        if (blockers.some((event) => !isInternationalGame(event)))
          return finish(FastSimStopReason.BLOCKING_EVENT);
        if (blockers.length) {
          const data = await this.internationalsService.findAll(
            accountId,
            careerId,
          );
          const due = data.tournaments.flatMap((tournament) =>
            tournament.fixtures
              .filter((game) => game.playable && game.id !== null)
              .map((game) => ({ tournamentId: tournament.id, game })),
          );
          if (
            due.some(
              ({ game }) =>
                game.teamAId === managed.id || game.teamBId === managed.id,
            )
          )
            return finish(FastSimStopReason.MANAGED_MATCH);
          const next = due[0];
          if (!next) return finish(FastSimStopReason.BLOCKING_EVENT);
          if (domestic.length + international.length >= limit)
            return finish(FastSimStopReason.FIXTURE_LIMIT);
          await this.internationalsService.simulate(
            accountId,
            careerId,
            next.tournamentId,
            next.game.id!,
          );
          international.push({
            tournamentId: next.tournamentId,
            fixtureId: next.game.id!,
          });
          calendar = await this.calendarsService.findOne(accountId, careerId);
          continue;
        }
        if (
          calendar.dueMatches.some((fixture) =>
            this.includesTeam(fixture, managed.id),
          )
        )
          return finish(FastSimStopReason.MANAGED_MATCH);
        const week = getTrainingWeek(calendar.currentDate).weekStartsAt;
        if (week !== checkedWeek) {
          const used = await this.dataSource.manager.exists(TrainingSession, {
            where: {
              trainingPeriod: { careerId, weekStartsAt: week },
              category: TrainingCategory.TEAM,
            },
          });
          if (!used) return finish(FastSimStopReason.WEEKLY_ACTIVITY);
          checkedWeek = week;
        }
        if (calendar.currentDate >= targetDate)
          return finish(FastSimStopReason.TARGET_REACHED);
        const remaining = limit - domestic.length - international.length;
        if (remaining <= 0) return finish(FastSimStopReason.FIXTURE_LIMIT);
        // Reuse the existing transactional daily pipeline (form, contracts, schedules,
        // league progression and manager reviews), never jump the stored date.
        const step = await this.fastSim(accountId, careerId, {
          days: 1,
          maxFixtures: remaining,
        });
        domestic.push(...step.simulatedFixtures);
        calendar = step.calendar;
        if (step.stopReason === FastSimStopReason.BLOCKING_EVENT) continue;
        if (
          ![
            FastSimStopReason.TARGET_REACHED,
            FastSimStopReason.FIXTURE_LIMIT,
          ].includes(step.stopReason)
        )
          return finish(step.stopReason);
        if (step.stopReason === FastSimStopReason.FIXTURE_LIMIT)
          return finish(step.stopReason);
      }
    });
  }

  private async advancePastClosingTransferBlockers(
    accountId: number,
    careerId: number,
    calendar: CalendarResponseDto,
    targetDate: string,
  ): Promise<CalendarResponseDto | null> {
    if (
      calendar.currentDate >= targetDate ||
      !calendar.canCloseTransferWindow ||
      calendar.dueMatches.length > 0 ||
      !calendar.transferWindow.isOpen ||
      calendar.currentDate !== calendar.transferWindow.endsAt
    ) {
      return null;
    }
    const advanced = await this.calendarsService.advance(accountId, careerId, {
      mode: CalendarAdvanceMode.ONE_DAY,
    });
    return advanced.currentDate > calendar.currentDate ? advanced : null;
  }

  private async runQuickSim(
    accountId: number,
    careerId: number,
    dto: QuickSimDto,
  ): Promise<QuickSimResponseDto> {
    const split = await this.leaguesService.findOne(
      accountId,
      careerId,
      dto.leagueSplitId,
    );
    const fixture = split.fixtures.find(
      (candidate) => candidate.id === dto.fixtureId,
    );

    if (!fixture) {
      throw new NotFoundException(
        `LeagueFixture ${dto.fixtureId} was not found in LeagueSplit ${dto.leagueSplitId}`,
      );
    }

    if (fixture.status === LeagueFixtureStatus.COMPLETED) {
      throw new ConflictException(
        `LeagueFixture ${dto.fixtureId} is already completed`,
      );
    }

    const existingGames = fixture.teamAWins + fixture.teamBWins;
    let result: LeagueFixtureGameResponseDto | null = null;

    for (
      let gameNumber = existingGames + 1;
      gameNumber <= fixture.bestOf;
      gameNumber += 1
    ) {
      result = await this.leaguesService.simulateNextFixtureGame(
        accountId,
        careerId,
        dto.leagueSplitId,
        dto.fixtureId,
      );

      if (result.series.status === MatchSeriesStatus.COMPLETED) {
        return {
          mode: SimulationMode.QUICK,
          fixtureId: dto.fixtureId,
          gamesSimulated: result.series.games.length - existingGames,
          series: result.series,
          split: result.split,
        };
      }
    }

    throw new ConflictException(
      `LeagueFixture ${dto.fixtureId} did not complete within BO${fixture.bestOf}`,
    );
  }

  private async prepareCurrentDate(
    accountId: number,
    careerId: number,
  ): Promise<PreparedSimulationDate> {
    return this.dataSource.transaction(async (manager) => {
      const career = await manager.findOne(Career, {
        where: { id: careerId, accountId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!career) {
        throw new NotFoundException(`Career ${careerId} was not found`);
      }

      await assertManagerActive(manager, careerId);

      await this.eventQueueService.processThroughDate(
        manager,
        careerId,
        career.currentDate,
      );
      const blockingEvents = await this.eventQueueService.findBlockingEvents(
        manager,
        careerId,
        career.currentDate,
      );

      return { career, blockingEvents };
    });
  }

  private async findManagedTeam(
    accountId: number,
    careerId: number,
  ): Promise<CareerTeam> {
    const managedTeam = await this.careerTeamsRepository.findOne({
      where: {
        careerId,
        isUserControlled: true,
        career: { accountId },
      },
      relations: { career: true },
    });

    if (!managedTeam) {
      throw new ConflictException(
        `Career ${careerId} does not have a user-controlled team`,
      );
    }

    return managedTeam;
  }

  private includesTeam(
    fixture: CalendarResponseDto['dueMatches'][number],
    teamId: number,
  ): boolean {
    return fixture.teamA.id === teamId || fixture.teamB.id === teamId;
  }

  private toFastSimFixture(
    result: QuickSimResponseDto,
    scheduledDate: string,
  ): FastSimFixtureResponseDto {
    const fixture = result.split.fixtures.find(
      (candidate) => candidate.id === result.fixtureId,
    );

    if (!fixture || result.series.winnerTeamId === null) {
      throw new ConflictException(
        `Completed simulation result is missing for LeagueFixture ${result.fixtureId}`,
      );
    }

    return {
      fixtureId: fixture.id,
      leagueSplitId: result.split.id,
      scheduledDate,
      seriesId: result.series.seriesId,
      bestOf: result.series.bestOf,
      gamesSimulated: result.gamesSimulated,
      teamAId: fixture.teamA.id,
      teamBId: fixture.teamB.id,
      teamAWins: fixture.teamAWins,
      teamBWins: fixture.teamBWins,
      winnerTeamId: result.series.winnerTeamId,
    };
  }

  private toFastSimResponse(
    previousDate: string,
    targetDate: string,
    fixtureLimit: number,
    stopReason: FastSimStopReason,
    simulatedFixtures: FastSimFixtureResponseDto[],
    calendar: CalendarResponseDto,
  ): FastSimResponseDto {
    return {
      mode: SimulationMode.FAST,
      careerId: calendar.careerId,
      previousDate,
      currentDate: calendar.currentDate,
      targetDate,
      advancedDays: calendarDaysBetween(previousDate, calendar.currentDate),
      stopReason,
      fixtureLimit,
      simulatedFixtures,
      blockingEvents: calendar.blockingEvents,
      calendar,
    };
  }
}
