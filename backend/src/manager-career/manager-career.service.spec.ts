import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Roster } from '../careers/entities/roster.entity';
import { Region } from '../careers/enums/region.enum';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import {
  LeagueFixtureResponseDto,
  LeagueSplitResponseDto,
} from '../leagues/dto/league-split-response.dto';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueFixtureStatus } from '../leagues/enums/league-fixture-status.enum';
import { LeagueSplitStatus } from '../leagues/enums/league-split-status.enum';
import { LeagueStageStatus } from '../leagues/enums/league-stage-status.enum';
import { Position } from '../players/enums/position.enum';
import { TransferRecord } from '../transfers/entities/transfer-record.entity';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import { ManagerReview } from './entities/manager-review.entity';
import { ManagerCareerService } from './manager-career.service';

/** Fresh copies on every read/save make persistence assertions meaningful. */
function memoryManager() {
  const tables = new Map<object, object[]>();
  const rows = <T extends object>(entity: new () => T): T[] =>
    (tables.get(entity) ?? []) as T[];
  const put = <T extends object>(entity: new () => T, ...values: T[]) => {
    tables.set(entity, structuredClone([...rows(entity), ...values]));
  };
  type Query = {
    where?: unknown;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
  };
  function matches(row: unknown, where: unknown): boolean {
    if (Array.isArray(where))
      return where.some((condition: unknown) => matches(row, condition));
    if (!where) return true;
    if (!row || typeof row !== 'object' || typeof where !== 'object')
      return false;
    const record = row as Record<string, unknown>;
    return Object.entries(where).every(([key, value]) =>
      value && typeof value === 'object'
        ? matches(record[key], value)
        : record[key] === value,
    );
  }
  function read(entity: object, query: Query = {}): object[] {
    const result = (tables.get(entity) ?? []).filter((row) =>
      matches(row, query.where),
    );
    if (query.order) {
      result.sort((a, b) => {
        for (const [key, order] of Object.entries(query.order ?? {})) {
          const left = (a as Record<string, string | number>)[key];
          const right = (b as Record<string, string | number>)[key];
          const direction = left < right ? -1 : left > right ? 1 : 0;
          if (direction) return order === 'DESC' ? -direction : direction;
        }
        return 0;
      });
    }
    return structuredClone(
      query.take === undefined ? result : result.slice(0, query.take),
    );
  }
  const mock = {
    findOneBy: jest.fn((entity: object, where: unknown) =>
      Promise.resolve(read(entity, { where })[0] ?? null),
    ),
    findOne: jest.fn((entity: object, query: Query) =>
      Promise.resolve(read(entity, query)[0] ?? null),
    ),
    find: jest.fn((entity: object, query: Query) =>
      Promise.resolve(read(entity, query)),
    ),
    existsBy: jest.fn((entity: object, where: unknown) =>
      Promise.resolve(read(entity, { where }).length > 0),
    ),
    create: jest.fn((_entity: object, values: object) =>
      structuredClone(values),
    ),
    save: jest.fn((entity: object, value: object & { id?: number }) => {
      const entries = tables.get(entity) ?? [];
      value.id ??=
        Math.max(0, ...entries.map((row) => (row as { id: number }).id)) + 1;
      const index = entries.findIndex(
        (row) => (row as { id: number }).id === value.id,
      );
      if (index < 0) entries.push(structuredClone(value));
      else entries[index] = structuredClone(value);
      tables.set(entity, entries);
      return Promise.resolve(structuredClone(value));
    }),
  };
  return { manager: mock as unknown as EntityManager, mock, rows, put };
}

function setup() {
  const store = memoryManager();
  const career = Object.assign(new Career(), {
    id: 1,
    accountId: 7,
    currentDate: '2026-02-01',
    currentYear: 2026,
  });
  const managedTeam = Object.assign(new CareerTeam(), {
    id: 10,
    careerId: 1,
    isUserControlled: true,
    region: Region.LCK,
  });
  store.put(Career, career);
  store.put(
    CareerTeam,
    managedTeam,
    Object.assign(new CareerTeam(), {
      id: 11,
      careerId: 1,
      isUserControlled: false,
      region: Region.LCK,
    }),
  );
  const split = Object.assign(new LeagueSplit(), {
    id: 20,
    careerId: 1,
    year: 2026,
    splitNumber: 1,
    region: Region.LCK,
    stages: [
      {
        id: 30,
        sequence: 1,
        status: LeagueStageStatus.ACTIVE,
        participants: [{ careerTeamId: 10 }, { careerTeamId: 11 }],
      },
    ],
  });
  store.put(LeagueSplit, split);
  for (const teamId of [10, 11]) {
    store.put(
      Roster,
      ...Object.values(Position).map((position, index) =>
        Object.assign(new Roster(), {
          id: teamId * 10 + index,
          careerTeamId: teamId,
          careerTeam: { careerId: 1 },
          role: RosterRole.STARTER,
          starterPosition: position,
          careerPlayerId: teamId * 10 + index,
          careerPlayer: Object.assign(new CareerPlayer(), {
            id: teamId * 10 + index,
            currentMechanics: 80,
            currentGameSense: 80,
            currentLaning: 80,
            currentTeamFight: 80,
            currentMacro: 80,
            currentTeamPlay: 80,
            currentMental: 80,
            currentChampionPool: 80,
            potential: 100,
            playerCard: { ovr: 99, potential: 100 },
          }),
        }),
      ),
    );
  }
  const service = new ManagerCareerService({
    manager: store.manager,
  } as DataSource);
  const dto: LeagueSplitResponseDto = Object.assign(
    new LeagueSplitResponseDto(),
    {
      id: 20,
      careerId: 1,
      year: 2026,
      splitNumber: 1,
      region: Region.LCK,
      name: 'LCK Split 1',
      status: LeagueSplitStatus.IN_PROGRESS,
      fixtures: [],
      standings: [],
      stages: [],
    },
  );
  const fixture = (
    id: number,
    winnerTeamId = 11,
    status = LeagueFixtureStatus.COMPLETED,
  ) =>
    Object.assign(new LeagueFixtureResponseDto(), {
      id,
      leagueStageId: 30,
      bestOf: 3,
      status,
      teamA: { id: 10, code: 'HLE', name: 'HLE' },
      teamB: { id: 11, code: 'GEN', name: 'GEN' },
      teamAWins: winnerTeamId === 10 ? 2 : 1,
      teamBWins: winnerTeamId === 11 ? 2 : 1,
      winnerTeamId,
    });
  const state = () => store.rows(ManagerCareerState)[0];
  const reviews = () => store.rows(ManagerReview);
  const events = () => store.rows(CalendarEvent);
  return {
    ...store,
    career,
    managedTeam,
    service,
    split,
    dto,
    fixture,
    state,
    reviews,
    events,
  };
}

describe('ManagerCareerService persistence and integration rules', () => {
  it('returns legacy defaults without initializing state or writing on GET', async () => {
    const h = setup();
    const overview = await h.service.findOne(7, 1);
    expect(overview).toMatchObject({
      careerId: 1,
      careerTeamId: 10,
      status: 'ACTIVE',
      fanApproval: 65,
      boardConfidence: 65,
      canManage: true,
      trackingStartedDate: null,
      record: { played: 0, wins: 0, losses: 0, expectedWins: 0 },
      warning: null,
      recentReviews: [],
    });
    expect(h.mock.save).not.toHaveBeenCalled();
    expect(h.mock.create).not.toHaveBeenCalled();
    expect(h.rows(ManagerCareerState)).toEqual([]);
  });

  it('rejects other account careers instead of exposing manager status', async () => {
    const h = setup();
    await expect(h.service.findOne(8, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.mock.findOneBy).toHaveBeenCalledTimes(1);
    expect(h.mock.save).not.toHaveBeenCalled();
  });

  it('rejects missing managed clubs', async () => {
    const h = setup();
    h.rows(CareerTeam).forEach((team) => {
      team.isUserControlled = false;
    });
    await expect(
      h.service.describe(h.manager, h.career),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('whitelists public fields and hides private review payloads and expectation rows', async () => {
    const h = setup();
    await h.service.initialize(h.manager, h.career);
    await h.service.prepareLeague(h.manager, h.career, 20);
    h.put(
      ManagerReview,
      Object.assign(new ManagerReview(), {
        id: 2,
        careerId: 1,
        sourceKey: 'SERIES:1',
        type: 'SERIES',
        reviewedDate: '2026-02-01',
        title: '공식 평가',
        reason: '공개 사유',
        fanDelta: -1,
        boardDelta: 0,
        fanApproval: 64,
        boardConfidence: 65,
        payload: { potential: 99, strengths: { 10: 80 }, hiddenPlan: 'secret' },
      }),
    );
    const overview = await h.service.findOne(7, 1);
    expect(overview.recentReviews).toHaveLength(1);
    expect(overview.recentReviews[0]).toMatchObject({
      title: '공식 평가',
      reason: '공개 사유',
      fanDelta: -1,
    });
    expect(JSON.stringify(overview)).not.toMatch(
      /potential|payload|strengths|hiddenPlan|secret|EXPECTATION/,
    );
    expect(h.mock.save).toHaveBeenCalledTimes(2);
  });

  it('baselines completed legacy series and splits once without grading unfinished or unrelated matches', async () => {
    const h = setup();
    const dbFixture = (
      id: number,
      winners: number[],
      teamAId = 10,
      teamBId = 11,
    ) =>
      Object.assign(new LeagueFixture(), {
        id,
        bestOf: 3,
        teamAId,
        teamBId,
        leagueSplit: { careerId: 1 },
        series: { games: winners.map((winnerTeamId) => ({ winnerTeamId })) },
      });
    h.put(
      LeagueFixture,
      dbFixture(1, [11, 10, 11]),
      dbFixture(2, [10, 11]),
      dbFixture(3, [12, 12], 12, 13),
    );
    h.rows(LeagueSplit)[0].stages[0].status = LeagueStageStatus.COMPLETED;
    await h.service.initialize(h.manager, h.career);
    await h.service.initialize(h.manager, h.career);
    expect(h.state()).toMatchObject({
      played: 0,
      fanApproval: 65,
      boardConfidence: 65,
      trackingStartedDate: '2026-02-01',
    });
    expect(
      h.reviews().map((review) => [review.sourceKey, review.type]),
    ).toEqual([
      ['SERIES:1', 'BASELINE'],
      ['SPLIT:20', 'BASELINE'],
    ]);
    expect(h.rows(ManagerCareerState)).toHaveLength(1);
    expect(h.events()).toEqual([]);
  });

  it('does not retroactively grade baselined history when a complete DTO is reviewed', async () => {
    const h = setup();
    h.put(
      LeagueFixture,
      Object.assign(new LeagueFixture(), {
        id: 1,
        bestOf: 3,
        teamAId: 10,
        teamBId: 11,
        leagueSplit: { careerId: 1 },
        series: { games: [{ winnerTeamId: 11 }, { winnerTeamId: 11 }] },
      }),
    );
    h.rows(LeagueSplit)[0].stages[0].status = LeagueStageStatus.COMPLETED;
    h.dto.status = LeagueSplitStatus.COMPLETED;
    h.dto.fixtures = [h.fixture(1)];
    h.dto.standings = [
      { teamId: 10, rank: 2 },
    ] as LeagueSplitResponseDto['standings'];
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toMatchObject({
      played: 0,
      wins: 0,
      expectedWins: 0,
      fanApproval: 65,
      boardConfidence: 65,
    });
    expect(h.events()).toEqual([]);
  });

  it('freezes expectation once from all current eight starter stats, ignoring cards and reserves', async () => {
    const h = setup();
    h.rows(Roster)
      .filter((row) => row.careerTeamId === 10)
      .forEach((row) => {
        row.careerPlayer.currentMechanics = 88;
        row.careerPlayer.currentGameSense = 72;
      });
    h.put(
      Roster,
      Object.assign(new Roster(), {
        id: 500,
        careerTeamId: 10,
        careerTeam: { careerId: 1 },
        role: RosterRole.BENCH,
        careerPlayer: { currentMechanics: 1000 },
      }),
    );
    await h.service.prepareLeague(h.manager, h.career, 20);
    const expectation = h.reviews().find((row) => row.type === 'EXPECTATION');
    expect(expectation?.payload).toEqual({
      strengths: { 10: 80, 11: 80 },
      teamCount: 2,
      expectedRank: 1.5,
    });
    h.rows(Roster)
      .filter((row) => row.role === RosterRole.STARTER)
      .forEach((row) => {
        row.careerPlayer.currentMechanics = 1;
      });
    await h.service.prepareLeague(h.manager, h.career, 20);
    expect(h.reviews().filter((row) => row.type === 'EXPECTATION')).toEqual([
      expectation,
    ]);
    expect(h.state()).toMatchObject({
      played: 0,
      fanApproval: 65,
      boardConfidence: 65,
    });
    expect(h.events()).toEqual([]);
  });

  it('does not create expectations for a league the managed club did not enter', async () => {
    const h = setup();
    h.rows(LeagueSplit)[0].stages[0].participants = [
      { careerTeamId: 12 },
      { careerTeamId: 13 },
    ] as LeagueSplit['stages'][number]['participants'];
    await h.service.prepareLeague(h.manager, h.career, 20);
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.reviews()).toEqual([]);
    expect(h.state().played).toBe(0);
  });

  it('does not create expectations for missing splits or one-team fields', async () => {
    const h = setup();
    await h.service.prepareLeague(h.manager, h.career, 999);
    h.rows(LeagueSplit)[0].stages[0].participants = [
      { careerTeamId: 10 },
    ] as LeagueSplit['stages'][number]['participants'];
    await h.service.prepareLeague(h.manager, h.career, 20);
    expect(h.reviews()).toEqual([]);
  });

  it('does not evaluate a set or incomplete official series', async () => {
    const h = setup();
    h.dto.fixtures = [
      h.fixture(1, 10, LeagueFixtureStatus.IN_PROGRESS),
      h.fixture(2, 10, LeagueFixtureStatus.SCHEDULED),
    ];
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toMatchObject({
      played: 0,
      wins: 0,
      fanApproval: 65,
      boardConfidence: 65,
    });
    expect(h.reviews().map((row) => row.type)).toEqual(['EXPECTATION']);
    expect(h.events()).toEqual([]);
  });

  it('grades a full BO3 once and leaves match scores untouched on replay', async () => {
    const h = setup();
    h.dto.fixtures = [h.fixture(1, 10)];
    const snapshot = structuredClone(h.dto);
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    const firstState = structuredClone(h.state());
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toEqual(firstState);
    expect(h.state()).toMatchObject({
      played: 1,
      wins: 1,
      expectedWins: 0.5,
      winningStreak: 1,
      losingStreak: 0,
    });
    expect(
      h.reviews().filter((row) => row.sourceKey === 'SERIES:1'),
    ).toHaveLength(1);
    expect(h.events()).toHaveLength(1);
    expect(h.events()[0]).toMatchObject({
      type: CalendarEventType.MANAGER_REVIEW,
      status: CalendarEventStatus.COMPLETED,
      requiresUserAction: false,
    });
    expect(h.dto).toEqual(snapshot);
  });

  it('recognizes the managed club on team B and ignores AI-only results', async () => {
    const h = setup();
    const managed = h.fixture(1, 10);
    [managed.teamA, managed.teamB] = [managed.teamB, managed.teamA];
    const ai = h.fixture(2, 12);
    ai.teamA.id = 12;
    ai.teamB.id = 13;
    h.dto.fixtures = [ai, managed];
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toMatchObject({ played: 1, wins: 1 });
    expect(
      h.reviews().find((row) => row.sourceKey === 'SERIES:2'),
    ).toBeUndefined();
  });

  it('warns after sustained poor results and dismisses only after three more official series', async () => {
    const h = setup();
    await h.service.prepareLeague(h.manager, h.career, 20);
    for (let id = 1; id <= 9; id++) {
      h.career.currentDate = `2026-02-${String(id).padStart(2, '0')}`;
      h.dto.fixtures.push(h.fixture(id));
      await h.service.reviewLeague(h.manager, h.career, h.dto);
      expect(h.state().played).toBe(id);
      if (id < 6) expect(h.state().status).toBe('ACTIVE');
      if (id >= 6 && id < 9)
        expect(h.state()).toMatchObject({
          status: 'WARNING',
          warningAtPlayed: 6,
          warnedDate: '2026-02-06',
          dismissedDate: null,
        });
    }
    expect(h.state()).toMatchObject({
      status: 'DISMISSED',
      played: 9,
      wins: 0,
      expectedWins: 4.5,
      warningAtPlayed: 6,
      warnedDate: '2026-02-06',
      dismissedDate: '2026-02-09',
    });
    expect(
      h
        .events()
        .filter(
          (event) => event.type === CalendarEventType.JOB_SECURITY_WARNING,
        ),
    ).toHaveLength(1);
    expect(
      h
        .events()
        .filter((event) => event.type === CalendarEventType.MANAGER_DISMISSED),
    ).toHaveLength(1);
    expect(
      h
        .events()
        .every(
          (event) =>
            event.status === CalendarEventStatus.COMPLETED &&
            !event.requiresUserAction,
        ),
    ).toBe(true);
    const snapshot = structuredClone(h.state());
    h.dto.fixtures.push(h.fixture(10, 10));
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toEqual(snapshot);
    expect(h.dto.fixtures[8]).toMatchObject({
      teamAWins: 1,
      teamBWins: 2,
      winnerTeamId: 11,
      status: LeagueFixtureStatus.COMPLETED,
    });
    expect(
      h.reviews().filter((row) => row.sourceKey.startsWith('SERIES:')),
    ).toHaveLength(9);
    const overview = await h.service.findOne(7, 1);
    expect(overview).toMatchObject({
      status: 'DISMISSED',
      canManage: false,
      record: { played: 9, losses: 9 },
    });
  });

  it('clears the warning date on recovery while retaining the original warning review', async () => {
    const h = setup();
    await h.service.prepareLeague(h.manager, h.career, 20);
    Object.assign(h.state(), {
      status: 'WARNING',
      played: 6,
      wins: 0,
      expectedWins: 3,
      losingStreak: 6,
      fanApproval: 40,
      boardConfidence: 55,
      warningAtPlayed: 6,
      warnedDate: '2026-01-30',
    });
    h.dto.fixtures = [h.fixture(7, 10)];
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state().status).toBe('WARNING');
    h.dto.fixtures.push(h.fixture(8, 10));
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toMatchObject({
      status: 'ACTIVE',
      warnedDate: null,
      warningAtPlayed: null,
      winningStreak: 2,
    });
    expect(h.reviews().find((row) => row.sourceKey === 'SERIES:8')?.type).toBe(
      'RECOVERED',
    );
    expect((await h.service.describe(h.manager, h.career)).warning).toBeNull();
  });

  it('applies final split placement once and never bypasses warning/grace solely from rating changes', async () => {
    const h = setup();
    await h.service.prepareLeague(h.manager, h.career, 20);
    Object.assign(h.state(), { fanApproval: 26, boardConfidence: 36 });
    h.dto.status = LeagueSplitStatus.COMPLETED;
    h.dto.standings = [
      { teamId: 10, rank: 1 },
      { teamId: 11, rank: 2 },
    ] as LeagueSplitResponseDto['standings'];
    h.dto.stages = [
      { sequence: 1, standings: h.dto.standings },
      {
        sequence: 2,
        standings: [
          { teamId: 11, rank: 1 },
          { teamId: 10, rank: 2 },
        ],
      },
    ] as LeagueSplitResponseDto['stages'];
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    const state = structuredClone(h.state());
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toEqual(state);
    expect(state).toMatchObject({
      fanApproval: 20,
      boardConfidence: 32,
      played: 0,
      status: 'ACTIVE',
    });
    expect(
      h.reviews().filter((row) => row.sourceKey === 'SPLIT:20'),
    ).toHaveLength(1);
    expect(h.events()).toHaveLength(1);
  });

  it('does not invent a split placement when no managed standing is present', async () => {
    const h = setup();
    h.dto.status = LeagueSplitStatus.COMPLETED;
    h.dto.standings = [
      { teamId: 11, rank: 1 },
    ] as LeagueSplitResponseDto['standings'];
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(
      h.reviews().find((row) => row.sourceKey === 'SPLIT:20'),
    ).toBeUndefined();
  });

  it('reviews actual pre/post lineup snapshots instead of current rosters or the player card', async () => {
    const h = setup();
    h.put(
      TransferRecord,
      Object.assign(new TransferRecord(), {
        id: 1,
        careerId: 1,
        careerPlayerId: 101,
        sourceCareerTeamId: null,
        destinationCareerTeamId: 10,
        completedDate: '2026-02-01',
        managerLineupBefore: 80,
        managerLineupAfter: 85,
      }),
      Object.assign(new TransferRecord(), {
        id: 2,
        careerId: 1,
        careerPlayerId: 102,
        sourceCareerTeamId: 10,
        destinationCareerTeamId: 11,
        completedDate: '2026-02-01',
        managerLineupBefore: 85,
        managerLineupAfter: 77,
      }),
    );
    h.rows(Roster).forEach((row) => {
      row.careerPlayer.currentMechanics = 100;
    });
    const news = await h.service.processDay(h.manager, h.career, '2026-02-01');
    expect(h.state()).toMatchObject({
      fanApproval: 64.4,
      boardConfidence: 64.55,
      played: 0,
    });
    expect(
      h.reviews().map((row) => [row.sourceKey, row.fanDelta, row.boardDelta]),
    ).toEqual([
      ['TRANSFER:1', 1, 0.75],
      ['TRANSFER:2', -1.6, -1.2],
    ]);
    expect(news).toHaveLength(2);
    expect(h.mock.find.mock.calls.some(([entity]) => entity === Roster)).toBe(
      false,
    );
    await h.service.processDay(h.manager, h.career, '2026-02-02');
    expect(h.reviews()).toHaveLength(2);
  });

  it('does not reward unchanged lineups such as reserve-only moves', async () => {
    const h = setup();
    h.put(
      TransferRecord,
      Object.assign(new TransferRecord(), {
        id: 1,
        careerId: 1,
        careerPlayerId: 101,
        sourceCareerTeamId: null,
        destinationCareerTeamId: 10,
        completedDate: '2026-02-01',
        managerLineupBefore: 80,
        managerLineupAfter: 80,
      }),
    );
    await h.service.processDay(h.manager, h.career, '2026-02-01');
    expect(h.state()).toMatchObject({ fanApproval: 65, boardConfidence: 65 });
    expect(h.reviews()[0]).toMatchObject({
      type: 'TRANSFER',
      fanDelta: 0,
      boardDelta: 0,
    });
  });

  it('grades each actual transfer once, preserving neutral sell-and-rebuy effects', async () => {
    const h = setup();
    const record = (
      id: number,
      completedDate: string,
      source = 10,
      destination = 11,
    ) =>
      Object.assign(new TransferRecord(), {
        id,
        careerId: 1,
        careerPlayerId: 101,
        sourceCareerTeamId: source,
        destinationCareerTeamId: destination,
        completedDate,
        managerLineupBefore: source === 10 ? 80 : 70,
        managerLineupAfter: source === 10 ? 70 : 80,
      });
    h.put(
      TransferRecord,
      record(1, '2026-02-01'),
      record(2, '2026-02-02', 11, 10),
      record(3, '2027-02-01'),
    );
    await h.service.processDay(h.manager, h.career, '2026-02-02');
    expect(h.reviews().filter((row) => row.type === 'TRANSFER')).toHaveLength(
      2,
    );
    expect(h.state()).toMatchObject({ fanApproval: 65, boardConfidence: 65 });
    await h.service.processDay(h.manager, h.career, '2026-02-03');
    expect(h.reviews().filter((row) => row.type === 'TRANSFER')).toHaveLength(
      2,
    );
    expect(h.state()).toMatchObject({ fanApproval: 65, boardConfidence: 65 });
    await h.service.processDay(h.manager, h.career, '2027-02-01');
    expect(
      h
        .reviews()
        .filter((row) => row.type === 'TRANSFER')
        .map((row) => row.sourceKey),
    ).toEqual(['TRANSFER:1', 'TRANSFER:2', 'TRANSFER:3']);
    expect(h.state()).toMatchObject({ fanApproval: 63, boardConfidence: 63.5 });
  });

  it('does not let a zero-effect reserve signing swallow a later starter departure for the same player', async () => {
    const h = setup();
    h.put(
      TransferRecord,
      Object.assign(new TransferRecord(), {
        id: 1,
        careerId: 1,
        careerPlayerId: 101,
        sourceCareerTeamId: null,
        destinationCareerTeamId: 10,
        completedDate: '2026-02-01',
        managerLineupBefore: 80,
        managerLineupAfter: 80,
      }),
      Object.assign(new TransferRecord(), {
        id: 2,
        careerId: 1,
        careerPlayerId: 101,
        sourceCareerTeamId: 10,
        destinationCareerTeamId: 11,
        completedDate: '2026-02-02',
        managerLineupBefore: 80,
        managerLineupAfter: 70,
      }),
    );
    await h.service.processDay(h.manager, h.career, '2026-02-01');
    expect(h.state()).toMatchObject({ fanApproval: 65, boardConfidence: 65 });
    await h.service.processDay(h.manager, h.career, '2026-02-02');
    expect(h.state()).toMatchObject({ fanApproval: 63, boardConfidence: 63.5 });
    expect(h.reviews().map((row) => [row.sourceKey, row.fanDelta])).toEqual([
      ['TRANSFER:1', 0],
      ['TRANSFER:2', -2],
    ]);
    expect(
      await h.service.processDay(h.manager, h.career, '2026-02-02'),
    ).toEqual([]);
    expect(h.reviews()).toHaveLength(2);
  });

  it('ignores legacy missing snapshots, future transfers and other clubs or careers', async () => {
    const h = setup();
    const record = (id: number, overrides: Partial<TransferRecord>) =>
      Object.assign(
        new TransferRecord(),
        {
          id,
          careerId: 1,
          careerPlayerId: 100 + id,
          sourceCareerTeamId: null,
          destinationCareerTeamId: 10,
          completedDate: '2026-02-01',
          managerLineupBefore: 80,
          managerLineupAfter: 90,
        },
        overrides,
      );
    h.put(
      TransferRecord,
      record(1, { managerLineupBefore: null }),
      record(2, { managerLineupAfter: null }),
      record(3, { completedDate: '2026-02-02' }),
      record(4, { destinationCareerTeamId: 11 }),
      record(5, { careerId: 2 }),
    );
    expect(
      await h.service.processDay(h.manager, h.career, '2026-02-01'),
    ).toEqual([]);
    expect(h.reviews()).toEqual([]);
    expect(h.state()).toMatchObject({ fanApproval: 65, boardConfidence: 65 });
  });

  it('preserves ratings, cumulative results and warning grace across the year boundary exactly once', async () => {
    const h = setup();
    await h.service.initialize(h.manager, h.career);
    Object.assign(h.state(), {
      status: 'WARNING',
      played: 20,
      wins: 4,
      expectedWins: 10,
      losingStreak: 6,
      fanApproval: 30,
      boardConfidence: 40,
      warningAtPlayed: 19,
      warnedDate: '2026-12-29',
    });
    const state = structuredClone(h.state());
    const news = await h.service.processDay(h.manager, h.career, '2027-01-01');
    expect(h.state()).toEqual({ ...state, reviewYear: 2027 });
    expect(news).toHaveLength(1);
    expect(h.reviews()[0]).toMatchObject({
      sourceKey: 'SEASON:2027',
      type: 'SEASON',
      reviewedDate: '2027-01-01',
      fanDelta: 0,
      boardDelta: 0,
    });
    expect(
      await h.service.processDay(h.manager, h.career, '2027-01-02'),
    ).toEqual([]);
    expect(h.reviews()).toHaveLength(1);
    const overview = await h.service.describe(h.manager, h.career);
    expect(overview).toMatchObject({
      reviewYear: 2027,
      record: { played: 20, wins: 4, losses: 16 },
      warning: {
        issuedDate: '2026-12-29',
        issuedAtPlayed: 19,
        minimumAdditionalSeries: 3,
      },
    });
  });

  it('does not reset or mutate a dismissed manager on later date, transfer or league processing', async () => {
    const h = setup();
    await h.service.initialize(h.manager, h.career);
    Object.assign(h.state(), {
      status: 'DISMISSED',
      dismissedDate: '2026-02-01',
      fanApproval: 20,
      boardConfidence: 30,
    });
    const state = structuredClone(h.state());
    h.put(
      TransferRecord,
      Object.assign(new TransferRecord(), {
        id: 1,
        careerId: 1,
        careerPlayerId: 101,
        sourceCareerTeamId: null,
        destinationCareerTeamId: 10,
        completedDate: '2027-01-01',
        managerLineupBefore: 0,
        managerLineupAfter: 100,
      }),
    );
    h.mock.save.mockClear();
    await h.service.processDay(h.manager, h.career, '2027-01-01');
    await h.service.prepareLeague(h.manager, h.career, 20);
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    expect(h.state()).toEqual(state);
    expect(h.mock.save).not.toHaveBeenCalled();
    expect(h.reviews()).toEqual([]);
    expect(h.events()).toEqual([]);
  });

  it('ignores a stale old-year day instead of rolling the review year and warning backwards', async () => {
    const h = setup();
    await h.service.initialize(h.manager, h.career);
    Object.assign(h.state(), {
      status: 'WARNING',
      played: 20,
      wins: 4,
      expectedWins: 10,
      losingStreak: 6,
      fanApproval: 30,
      boardConfidence: 40,
      warningAtPlayed: 19,
      warnedDate: '2026-12-29',
    });
    await h.service.processDay(h.manager, h.career, '2027-01-01');
    const state = structuredClone(h.state());
    h.mock.save.mockClear();
    expect(
      await h.service.processDay(h.manager, h.career, '2026-12-30'),
    ).toEqual([]);
    expect(h.state()).toEqual(state);
    expect(h.reviews().map((row) => row.sourceKey)).toEqual(['SEASON:2027']);
    expect(h.mock.save).not.toHaveBeenCalled();
  });

  it('stores public series rating deltas with at most two decimals', async () => {
    const h = setup();
    h.rows(Roster)
      .filter((row) => row.careerTeamId === 11)
      .forEach((row) => {
        row.careerPlayer.currentMechanics = 73;
      });
    h.dto.fixtures = [h.fixture(1)];
    await h.service.reviewLeague(h.manager, h.career, h.dto);
    const review = h.reviews().find((row) => row.type === 'SERIES');
    expect(review).toBeDefined();
    for (const delta of [review!.fanDelta, review!.boardDelta])
      expect(delta).toBe(Number(delta.toFixed(2)));
  });

  it('returns at most fifteen recent public reviews in newest-first order', async () => {
    const h = setup();
    await h.service.initialize(h.manager, h.career);
    for (let id = 1; id <= 35; id++)
      h.put(
        ManagerReview,
        Object.assign(new ManagerReview(), {
          id,
          careerId: 1,
          sourceKey: `SERIES:${id}`,
          type: 'SERIES',
          reviewedDate: '2026-02-01',
          title: `Review ${id}`,
          reason: 'Public',
          fanApproval: 65,
          boardConfidence: 65,
          fanDelta: 0,
          boardDelta: 0,
        }),
      );
    const overview = await h.service.describe(h.manager, h.career);
    expect(overview.recentReviews.map((row) => row.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => 35 - index),
    );
  });
});
