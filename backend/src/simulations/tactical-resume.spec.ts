import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, FindOperator, Repository } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CalendarsService } from '../calendars/calendars.service';
import { CalendarStopReason } from '../calendars/enums/calendar-stop-reason.enum';
import { EventQueueService } from '../event-queue/event-queue.service';
import { InternationalFixture } from '../internationals/entities/international-fixture.entity';
import { InternationalTournament } from '../internationals/entities/international-tournament.entity';
import { InternationalsService } from '../internationals/internationals.service';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueFixtureStatus } from '../leagues/enums/league-fixture-status.enum';
import { LeagueStageStatus } from '../leagues/enums/league-stage-status.enum';
import { LeaguesService } from '../leagues/leagues.service';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import { MatchSeriesService } from '../match-series/match-series.service';
import { MatchTacticalRun } from '../matches/entities/match-tactical-run.entity';
import { ManagerCareerState } from '../manager-career/entities/manager-career-state.entity';
import {
  lockActiveManagerCareer,
  tacticalSeriesExecutionKey,
} from '../manager-career/manager-access';
import { ManagerCareerService } from '../manager-career/manager-career.service';
import { FastSimStopReason } from './enums/fast-sim-stop-reason.enum';
import { SimulationsService } from './simulations.service';

/** Exercise the real scoped guard; only persistence and unrelated calendar work are mocked. */
function scenario(
  kind: 'DOMESTIC' | 'INTERNATIONAL' = 'DOMESTIC',
  managedGame = false,
) {
  const career = { id: 1, accountId: 7, currentDate: '2026-01-01' };
  const managed = {
    id: managedGame ? 1 : 99,
    careerId: 1,
    isUserControlled: true,
  };
  const executionKey = tacticalSeriesExecutionKey(1, 50, 2);
  let pending: Record<string, unknown> | null = {
    id: 23,
    careerId: 1,
    matchId: null,
    executionKey,
    status: 'RUNNING',
    input: {
      context: { careerId: 1, seriesId: 50, gameId: 23 },
      teams: [{ teamId: 1 }, { teamId: 2 }],
    },
    draft: { gameNumber: 2, completed: true, assignmentsConfirmed: true },
  };
  const sourceSeries = { id: 50, bestOf: 3, games: [{ winnerTeamId: 1 }] };
  const fixture = {
    id: 10,
    leagueSplitId: 20,
    seriesId: 50,
    series: sourceSeries,
    leagueSplit: { careerId: 1, career },
    leagueStage: { status: LeagueStageStatus.ACTIVE, currentRound: 1 },
    roundNumber: 1,
    scheduledDate: career.currentDate,
    bestOf: 3,
    teamAId: 1,
    teamBId: 2,
  };
  const international = {
    id: 11,
    tournamentId: 30,
    seriesId: 50,
    series: sourceSeries,
    key: 'G1',
  };
  const tournament = {
    id: 30,
    careerId: 1,
    rosterConfirmed: true,
    registeredRosters: {},
    state: {
      games: [
        {
          key: 'G1',
          day: career.currentDate,
          winner: null,
          a: { teamId: 1 },
          b: { teamId: 2 },
          bestOf: 3,
        },
      ],
    },
  };
  const manager = {
    findOne: jest.fn(
      (
        entity: unknown,
        options: { where: { executionKey?: string | FindOperator<string> } },
      ) => {
        if (entity === Career) return Promise.resolve(career);
        if (entity === ManagerCareerState)
          return Promise.resolve({
            status: 'ACTIVE',
            careerTeamId: managed.id,
          });
        if (entity === LeagueFixture)
          return Promise.resolve(kind === 'DOMESTIC' ? fixture : null);
        if (entity === InternationalFixture)
          return Promise.resolve(
            kind === 'INTERNATIONAL' ? international : null,
          );
        if (entity !== MatchTacticalRun || !pending)
          return Promise.resolve(null);
        const filter = options.where.executionKey;
        if (filter instanceof FindOperator)
          return Promise.resolve(
            filter.value === pending.executionKey ? null : pending,
          );
        return Promise.resolve(
          !filter || filter === pending.executionKey ? pending : null,
        );
      },
    ),
    findOneBy: jest.fn((entity: unknown) =>
      Promise.resolve(
        entity === InternationalTournament ? tournament : managed,
      ),
    ),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    exists: jest.fn(),
  };
  const db = {
    manager,
    transaction: jest.fn(
      (action: (value: typeof manager) => Promise<unknown>) => action(manager),
    ),
  };
  const events = {
    processThroughDate: jest.fn(),
    findBlockingEvents: jest.fn().mockResolvedValue([]),
  };
  const seriesResponse = {
    seriesId: 50,
    status: MatchSeriesStatus.IN_PROGRESS,
    teams: [{ teamId: 1 }, { teamId: 2 }],
    games: sourceSeries.games,
  };
  const series = {
    findOne: jest.fn().mockResolvedValue(seriesResponse),
    simulateNextGame: jest.fn().mockResolvedValue(seriesResponse),
  };
  const managerCareer = { prepareLeague: jest.fn(), reviewLeague: jest.fn() };
  const fixtureDto = {
    id: 10,
    leagueSplitId: 20,
    seriesId: 50,
    bestOf: 3,
    status: LeagueFixtureStatus.IN_PROGRESS,
    scheduledDate: career.currentDate,
    teamA: { id: 1 },
    teamB: { id: 2 },
    teamAWins: 1,
    teamBWins: 0,
    winnerTeamId: null,
  };
  const split = { id: 20, fixtures: [fixtureDto] };
  const completed = {
    ...fixtureDto,
    status: LeagueFixtureStatus.COMPLETED,
    teamAWins: 2,
    winnerTeamId: 1,
  };
  const leagues = {
    findOne: jest.fn().mockResolvedValue(split),
    simulateNextFixtureGame: jest.fn().mockImplementation(() => {
      pending = null;
      return Promise.resolve({
        fixtureId: 10,
        series: {
          ...seriesResponse,
          status: MatchSeriesStatus.COMPLETED,
          winnerTeamId: 1,
          bestOf: 3,
          games: [{ winnerTeamId: 1 }, { winnerTeamId: 1 }],
        },
        split: { id: 20, fixtures: [completed] },
      });
    }),
  };
  const internationals = { simulate: jest.fn(), findAll: jest.fn() };
  let calendar = {
    careerId: 1,
    currentDate: career.currentDate,
    blockingEvents: [],
    dueMatches: [],
    manager: { status: 'ACTIVE' },
    transferWindow: { isOpen: false },
  };
  const calendars = {
    findOne: jest.fn(() => Promise.resolve(calendar)),
    advance: jest.fn(() => {
      career.currentDate = '2026-01-02';
      calendar = { ...calendar, currentDate: career.currentDate };
      return Promise.resolve({
        ...calendar,
        stopReason: CalendarStopReason.TARGET_REACHED,
      });
    }),
  };
  const simulations = new SimulationsService(
    db as unknown as DataSource,
    {
      findOne: jest.fn().mockResolvedValue(managed),
    } as unknown as Repository<CareerTeam>,
    calendars as unknown as CalendarsService,
    events as unknown as EventQueueService,
    leagues as unknown as LeaguesService,
    internationals as unknown as InternationalsService,
  );
  return {
    career,
    fixture,
    split,
    sourceSeries,
    executionKey,
    manager,
    db,
    events,
    series,
    managerCareer,
    leagues,
    internationals,
    calendars,
    simulations,
    setPendingKey: (key: string) => {
      pending!.executionKey = key;
    },
    finishLease: () => {
      pending!.status = 'FINISHED';
    },
  };
}

describe('same-game tactical resume across outer simulation endpoints', () => {
  it.each(['RUNNING', 'FINISHED'])(
    'quick resumes %s at the same set without reapplying current-date work',
    async (status) => {
      const value = scenario();
      if (status === 'FINISHED') value.finishLease();
      const result = await value.simulations.quickSim(7, 1, {
        leagueSplitId: 20,
        fixtureId: 10,
      });
      expect(result.gamesSimulated).toBe(1);
      expect(value.events.processThroughDate).not.toHaveBeenCalled();
      expect(value.leagues.simulateNextFixtureGame).toHaveBeenCalledTimes(1);
      expect(value.manager.findOne).toHaveBeenCalledWith(
        LeagueFixture,
        expect.objectContaining({
          where: {
            id: 10,
            leagueSplitId: 20,
            leagueSplit: { careerId: 1, career: { accountId: 7 } },
          },
        }),
      );
    },
  );

  it('rejects a different pending set before quick can process events or run games', async () => {
    const value = scenario();
    value.setPendingKey(tacticalSeriesExecutionKey(1, 50, 3));
    await expect(
      value.simulations.quickSim(7, 1, { leagueSplitId: 20, fixtureId: 10 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(value.events.processThroughDate).not.toHaveBeenCalled();
    expect(value.leagues.simulateNextFixtureGame).not.toHaveBeenCalled();
  });

  it('league resume skips repeated manager preparation and keeps the scope out of later actions', async () => {
    const value = scenario();
    const league = new LeaguesService(
      value.db as unknown as DataSource,
      {
        findOneBy: jest.fn().mockResolvedValue(value.career),
      } as unknown as Repository<Career>,
      {} as Repository<LeagueSplit>,
      value.series as unknown as MatchSeriesService,
      value.events as unknown as EventQueueService,
      value.managerCareer as unknown as ManagerCareerService,
    );
    jest.spyOn(league, 'findOne').mockResolvedValue(value.split as never);
    await league.simulateNextFixtureGame(7, 1, 20, 10, false, 2);
    expect(value.series.simulateNextGame).toHaveBeenCalledWith(7, 50, {
      requireDraft: true,
      expectedGameNumber: 2,
    });
    expect(value.managerCareer.prepareLeague).not.toHaveBeenCalled();
    expect(value.events.processThroughDate).not.toHaveBeenCalled();
    await expect(
      lockActiveManagerCareer(value.manager as unknown as EntityManager, 7, 1),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      league.simulateNextFixtureGame(7, 1, 20, 10, false, 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('international preparation resolves only its owned series and refuses a stale requested set', async () => {
    const value = scenario('INTERNATIONAL');
    const international = new InternationalsService(
      value.db as unknown as DataSource,
      value.leagues as unknown as LeaguesService,
      value.series as unknown as MatchSeriesService,
      value.events as unknown as EventQueueService,
    );
    const result = await international.prepareFixture(7, 1, 30, 11);
    expect(result.series.seriesId).toBe(50);
    expect(value.manager.save).not.toHaveBeenCalled();
    expect(value.manager.update).not.toHaveBeenCalled();
    await expect(
      international.simulate(7, 1, 30, 11, { single: true, gameNumber: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(value.series.simulateNextGame).not.toHaveBeenCalled();
    expect(value.manager.findOne).toHaveBeenCalledWith(
      InternationalFixture,
      expect.objectContaining({
        where: {
          id: 11,
          tournamentId: 30,
          tournament: { careerId: 1, career: { accountId: 7 } },
        },
      }),
    );
  });

  it('fast resumes an AI fixture first and then continues normal daily work within the fixture budget', async () => {
    const value = scenario();
    const result = await value.simulations.fastSim(7, 1, {
      days: 1,
      maxFixtures: 2,
    });
    expect(result.simulatedFixtures).toHaveLength(1);
    expect(result.simulatedFixtures[0].seriesId).toBe(50);
    expect(result.fixtureLimit).toBe(2);
    expect(result.stopReason).toBe(FastSimStopReason.TARGET_REACHED);
    expect(value.events.processThroughDate).toHaveBeenCalledTimes(1);
    expect(
      value.events.processThroughDate.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      value.leagues.simulateNextFixtureGame.mock.invocationCallOrder[0],
    );
    expect(value.calendars.advance).toHaveBeenCalledTimes(1);
  });

  it('fast consumes one fixture budget on AI resume and does not advance a day at the limit', async () => {
    const value = scenario();
    const result = await value.simulations.fastSim(7, 1, {
      days: 1,
      maxFixtures: 1,
    });
    expect(result.stopReason).toBe(FastSimStopReason.FIXTURE_LIMIT);
    expect(result.simulatedFixtures).toHaveLength(1);
    expect(value.events.processThroughDate).not.toHaveBeenCalled();
    expect(value.calendars.advance).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'fast resumes only the already-started managed set (focus=%s)',
    async (focusManagedTeam) => {
      const value = scenario('DOMESTIC', true);
      const result = await value.simulations.fastSim(7, 1, {
        days: 3,
        maxFixtures: 5,
        focusManagedTeam,
      });
      expect(result.stopReason).toBe(FastSimStopReason.MANAGED_MATCH);
      expect(value.leagues.simulateNextFixtureGame).toHaveBeenCalledTimes(1);
      expect(value.leagues.simulateNextFixtureGame).toHaveBeenCalledWith(
        7,
        1,
        20,
        10,
        false,
        2,
      );
      expect(value.events.processThroughDate).not.toHaveBeenCalled();
      expect(value.calendars.advance).not.toHaveBeenCalled();
    },
  );

  it('fast preserves an unresolvable pending input and reports its run boundary without calendar work', async () => {
    const value = scenario();
    value.setPendingKey('foreign-pinned-execution');
    await expect(
      value.simulations.fastSim(7, 1, { days: 1 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ status: 'PENDING_MATCH', runId: 23 }),
    });
    expect(value.events.processThroughDate).not.toHaveBeenCalled();
    expect(value.leagues.simulateNextFixtureGame).not.toHaveBeenCalled();
    expect(value.calendars.advance).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'fast resumes the pending international fixture with the correct single-set boundary (managed=%s)',
    async (managedGame) => {
      const value = scenario('INTERNATIONAL', managedGame);
      const result = await value.simulations.fastSim(7, 1, {
        days: 1,
        maxFixtures: 1,
      });
      expect(value.internationals.simulate).toHaveBeenCalledWith(
        7,
        1,
        30,
        11,
        managedGame ? { single: true, gameNumber: 2 } : undefined,
      );
      expect(result.stopReason).toBe(
        managedGame
          ? FastSimStopReason.MANAGED_MATCH
          : FastSimStopReason.FIXTURE_LIMIT,
      );
      expect(result.simulatedInternationalFixtures).toHaveLength(
        managedGame ? 0 : 1,
      );
      expect(value.events.processThroughDate).not.toHaveBeenCalled();
      expect(value.calendars.advance).not.toHaveBeenCalled();
    },
  );
});
