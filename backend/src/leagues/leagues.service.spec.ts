import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { addCalendarDays } from '../calendars/calendar-date';
import { getLeagueSplitWindow } from '../calendars/config/season-calendar.config';
import { Region } from '../careers/enums/region.enum';
import { EventQueueService } from '../event-queue/event-queue.service';
import { MatchSeriesResponseDto } from '../match-series/dto/match-series-response.dto';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import { MatchSeriesService } from '../match-series/match-series.service';
import { Match } from '../matches/entities/match.entity';
import { LeagueFixture } from './entities/league-fixture.entity';
import { LeagueSplit } from './entities/league-split.entity';
import { LeagueStageParticipant } from './entities/league-stage-participant.entity';
import { LeagueStage } from './entities/league-stage.entity';
import { LeagueFixtureStatus } from './enums/league-fixture-status.enum';
import { LeagueStageFormat } from './enums/league-stage-format.enum';
import { LeagueStageStatus } from './enums/league-stage-status.enum';
import { LeaguesService } from './leagues.service';
import { ManagerCareerService } from '../manager-career/manager-career.service';

describe('LeaguesService', () => {
  const lckTeams = createTeams(10, Region.LCK, 1);
  const lplTeams = createTeams(4, Region.LPL, 101);
  const career = {
    id: 1,
    accountId: 7,
    currentYear: 2026,
    currentDate: '2026-01-01',
    careerTeams: [...lckTeams, ...lplTeams],
  } as Career;
  const entityManager = {
    create: jest.fn((_: unknown, value: unknown) => value),
    save: jest.fn(),
    findOne: jest.fn(),
    getRepository: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(
      (work: (manager: typeof entityManager) => Promise<unknown>) =>
        work(entityManager),
    ),
  };
  const careersRepository = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    existsBy: jest.fn(),
  };
  const leagueSplitsRepository = {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findOneOrFail: jest.fn(),
  };
  const matchSeriesService = {
    simulateNextGame: jest.fn(),
    findOne: jest.fn(),
  };
  const eventQueueService = {
    processThroughDate: jest.fn(),
    findBlockingEvents: jest.fn(),
  };

  let service: LeaguesService;
  let savedSplit: LeagueSplit | null;

  beforeEach(() => {
    jest.clearAllMocks();
    career.currentYear = 2026;
    career.currentDate = '2026-01-01';
    career.careerTeams = [...lckTeams, ...lplTeams];
    savedSplit = null;
    careersRepository.findOne.mockResolvedValue(career);
    careersRepository.findOneBy.mockResolvedValue(career);
    careersRepository.existsBy.mockResolvedValue(true);
    entityManager.findOne.mockImplementation((entity, options) =>
      entity === Career
        ? (careersRepository.findOne(options) as Promise<Career | null>)
        : null,
    );
    entityManager.getRepository.mockReturnValue(leagueSplitsRepository);
    leagueSplitsRepository.findOneOrFail.mockImplementation(() => savedSplit);
    eventQueueService.processThroughDate.mockResolvedValue({
      processedEvents: [],
      blockingEvents: [],
    });
    eventQueueService.findBlockingEvents.mockResolvedValue([]);
    leagueSplitsRepository.findOneBy.mockResolvedValue(null);
    leagueSplitsRepository.findOne.mockImplementation(() => savedSplit);
    leagueSplitsRepository.find.mockImplementation(() =>
      Promise.resolve(savedSplit ? [savedSplit] : []),
    );
    entityManager.save.mockImplementation((entity, value) => {
      if (entity === LeagueSplit) {
        (value as LeagueSplit).id = 10;
        savedSplit = value as LeagueSplit;
      }

      if (entity === LeagueStage && Array.isArray(value)) {
        (value as LeagueStage[]).forEach((stage, index) => {
          stage.id = 20 + index;
        });
      }

      if (entity === LeagueStageParticipant && Array.isArray(value)) {
        (value as LeagueStageParticipant[]).forEach((participant, index) => {
          participant.id = 200 + index;
        });
      }

      if (entity === LeagueFixture && Array.isArray(value)) {
        (value as LeagueFixture[]).forEach((fixture, index) => {
          fixture.id = 1000 + index;
        });
      }

      if (entity === MatchSeries) {
        (value as MatchSeries).id = 50;
      }

      return Promise.resolve(value);
    });
    matchSeriesService.simulateNextGame.mockResolvedValue(
      createSeriesResponse(),
    );
    service = new LeaguesService(
      dataSource as unknown as DataSource,
      careersRepository as unknown as Repository<Career>,
      leagueSplitsRepository as unknown as Repository<LeagueSplit>,
      matchSeriesService as unknown as MatchSeriesService,
      eventQueueService as unknown as EventQueueService,
      {
        prepareLeague: jest.fn(),
        reviewLeague: jest.fn(),
      } as unknown as ManagerCareerService,
    );
  });

  it('creates the LCK Split 1 cross-group battle and planned postseason', async () => {
    const result = await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });

    expect(result.region).toBe(Region.LCK);
    expect(result.name).toBe('LCK Split 1');
    expect(result.expectedTeamCount).toBe(10);
    expect(result.stages.map((stage) => stage.code)).toEqual([
      'GROUP_BATTLE',
      'PLAY_IN',
      'PLAYOFFS',
    ]);
    expect(result.stages[0].status).toBe(LeagueStageStatus.ACTIVE);
    expect(result.stages[1].status).toBe(LeagueStageStatus.PLANNED);
    expect(result.stages[0].fixtures).toHaveLength(25);
    expect(
      result.stages[0].fixtures.every(
        (fixture) =>
          result.stages[0].participants.find(
            (participant) => participant.teamId === fixture.teamA.id,
          )?.groupCode !==
          result.stages[0].participants.find(
            (participant) => participant.teamId === fixture.teamB.id,
          )?.groupCode,
      ),
    ).toBe(true);
    expect(entityManager.findOne).toHaveBeenCalledWith(Career, {
      where: { id: career.id, accountId: 7 },
      relations: { careerTeams: true },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('reuses a calendar split without rewriting existing dates or results', async () => {
    const created = await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    leagueSplitsRepository.findOneBy.mockResolvedValue(savedSplit);
    entityManager.save.mockClear();
    dataSource.transaction.mockClear();
    const reused = await service.ensureCalendarSplit(
      entityManager as unknown as EntityManager,
      career,
      Region.LCK,
      1,
    );
    expect(reused).toEqual(created);
    expect(entityManager.save).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('processes the post-lock date if another request advanced New Year first', async () => {
    careersRepository.findOneBy.mockResolvedValue({
      ...career,
      currentDate: '2026-12-31',
    });
    entityManager.findOne.mockImplementation((entity) =>
      Promise.resolve(
        entity === Career
          ? { ...career, currentYear: 2027, currentDate: '2027-01-01' }
          : null,
      ),
    );
    await (
      service as unknown as {
        assertNoBlockingEvents(
          accountId: number,
          careerId: number,
        ): Promise<void>;
      }
    ).assertNoBlockingEvents(7, career.id);
    expect(eventQueueService.processThroughDate).toHaveBeenCalledWith(
      entityManager,
      career.id,
      '2027-01-01',
    );
    expect(eventQueueService.findBlockingEvents).toHaveBeenCalledWith(
      entityManager,
      career.id,
      '2027-01-01',
    );
  });

  it('seeds a new Split 1 from the previous completed season only', async () => {
    career.careerTeams = lckTeams.slice(0, 2);
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    const priorSeason = savedSplit!;
    priorSeason.year = 2025;
    priorSeason.splitNumber = 3;
    priorSeason.stages.forEach((stage) => {
      stage.status = LeagueStageStatus.COMPLETED;
    });
    const final = priorSeason.stages[0].fixtures[0];
    final.seriesId = 99;
    final.series = {
      games: [{ winnerTeamId: final.teamBId }, { winnerTeamId: final.teamBId }],
    } as MatchSeries;
    leagueSplitsRepository.findOne.mockImplementation(
      ({ where }: { where: { year: number; splitNumber: number } }) =>
        Promise.resolve(
          where.year === 2025 && where.splitNumber === 3 ? priorSeason : null,
        ),
    );

    const result = await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    expect(result.stages[0].participants[0].teamId).toBe(final.teamBId);
    expect(leagueSplitsRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          careerId: career.id,
          year: 2025,
          region: Region.LCK,
          splitNumber: 3,
        },
      }),
    );
    priorSeason.stages[0].status = LeagueStageStatus.ACTIVE;
    const fallback = await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    expect(fallback.stages[0].participants.map((row) => row.teamId)).toEqual([
      1, 2,
    ]);
  });

  it.each([
    [Region.LCK, 2],
    [Region.LCK, 10],
    [Region.LPL, 2],
    [Region.LPL, 16],
    [Region.LEC, 2],
    [Region.LEC, 10],
    [Region.LCS, 2],
    [Region.LCS, 8],
    [Region.LCP, 8],
    [Region.CBLOL, 8],
  ] as const)(
    'finishes real dynamic %s brackets for %i teams within all three windows',
    async (region, teamCount) => {
      career.careerTeams = createTeams(teamCount, region, 1);
      const completedSplits: LeagueSplit[] = [];
      leagueSplitsRepository.findOne.mockImplementation(
        ({ where }: { where: { year?: number; splitNumber?: number } }) =>
          Promise.resolve(
            completedSplits.find(
              (split) =>
                split.year === where.year &&
                split.splitNumber === where.splitNumber,
            ) ?? null,
          ),
      );
      entityManager.findOne.mockImplementation((entity) =>
        Promise.resolve(entity === Career ? career : savedSplit),
      );

      for (const splitNumber of [1, 2, 3]) {
        const window = getLeagueSplitWindow(2026, splitNumber);
        career.currentDate = addCalendarDays(window.startsAt, -1);
        await service.createSplit(7, career.id, { region, splitNumber });
        const split = savedSplit!;
        let rounds = 0;
        while (
          split.stages.some(
            (stage) => stage.status === LeagueStageStatus.ACTIVE,
          )
        ) {
          expect(rounds++).toBeLessThan(100);
          const activeStage = split.stages.find(
            (stage) => stage.status === LeagueStageStatus.ACTIVE,
          )!;
          const due = activeStage.fixtures.filter(
            (fixture) => fixture.roundNumber === activeStage.currentRound,
          );
          expect(due.length).toBeGreaterThan(0);
          career.currentDate = due
            .map((fixture) => fixture.scheduledDate)
            .sort()
            .at(-1)!;
          for (const fixture of due) {
            fixture.seriesId = fixture.id;
            fixture.series = {
              games: Array.from(
                { length: Math.ceil(fixture.bestOf / 2) },
                () => ({
                  // Both upper/lower bracket winners occur across successive rounds.
                  winnerTeamId:
                    rounds % 2 === 0 ? fixture.teamAId : fixture.teamBId,
                }),
              ),
            } as MatchSeries;
          }
          await service['progressLeague'](7, career.id, split.id);
        }
        expect(
          split.stages.every(
            (stage) => stage.status === LeagueStageStatus.COMPLETED,
          ),
        ).toBe(true);
        if (region === Region.LCK && teamCount === 2 && splitNumber === 3) {
          const playIn = split.stages.find(
            (stage) => stage.code === 'PLAY_IN',
          )!;
          const final = split.stages.find(
            (stage) => stage.code === 'PLAYOFFS',
          )!;
          expect(split.stages[0].fixtures).toHaveLength(0);
          expect(playIn.participants).toHaveLength(1);
          expect(playIn.fixtures).toHaveLength(0);
          expect(final.participants).toHaveLength(2);
          expect(final.fixtures.length).toBeGreaterThanOrEqual(2);
        }
        expect(
          split.fixtures.every(
            (fixture) =>
              fixture.scheduledDate >= window.startsAt &&
              fixture.scheduledDate <= window.endsAt,
          ),
        ).toBe(true);
        for (let index = 1; index < split.stages.length; index++) {
          const previousDates = split.stages
            .slice(0, index)
            .flatMap((stage) =>
              stage.fixtures.map((fixture) => fixture.scheduledDate),
            );
          const stageDates = split.stages[index].fixtures.map(
            (fixture) => fixture.scheduledDate,
          );
          if (stageDates.length > 0 && previousDates.length > 0) {
            expect(stageDates.sort()[0] > previousDates.sort().at(-1)!).toBe(
              true,
            );
          }
        }
        completedSplits.push(split);
      }
    },
  );

  it('returns all eighteen regional split format definitions', async () => {
    const formats = await service.findFormats(7, career.id);

    expect(formats).toHaveLength(18);
    expect(
      formats.map((format) => `${format.region}:${format.splitNumber}`),
    ).toEqual(
      expect.arrayContaining([
        'LCK:1',
        'LCK:2',
        'LCK:3',
        'LPL:1',
        'LPL:2',
        'LPL:3',
        'LEC:1',
        'LEC:2',
        'LEC:3',
        'LCS:1',
        'LCS:2',
        'LCS:3',
      ]),
    );
  });

  it('creates each region independently and never mixes regional teams', async () => {
    const result = await service.createSplit(7, career.id, {
      region: Region.LPL,
      splitNumber: 2,
    });

    expect(result.region).toBe(Region.LPL);
    expect(result.stages[0].code).toBe('GROUP_STAGE');
    expect(result.stages[0].participants).toHaveLength(4);
    expect(
      result.stages[0].participants.every((participant) =>
        lplTeams.some((team) => team.id === participant.teamId),
      ),
    ).toBe(true);
  });

  it('creates LCS Split 1 as a three-round Swiss plan with round one only', async () => {
    career.careerTeams = createTeams(8, Region.LCS, 201);

    const result = await service.createSplit(7, career.id, {
      region: Region.LCS,
      splitNumber: 1,
    });

    expect(result.stages[0].code).toBe('SWISS_STAGE');
    expect(result.stages[0].settings.swissRounds).toBe(3);
    expect(result.stages[0].fixtures).toHaveLength(4);
    expect(
      result.stages[0].fixtures.every((fixture) => fixture.roundNumber === 1),
    ).toBe(true);
  });

  describe('Split 3 season prerequisites', () => {
    async function createPriorSplit(
      region: Region,
      year: number,
      completed: boolean,
    ) {
      career.currentYear = year;
      career.currentDate = `${year}-01-01`;
      career.careerTeams = createTeams(10, region, 1);
      await service.createSplit(7, career.id, { region, splitNumber: 2 });
      const split = savedSplit!;
      if (completed) {
        split.stages.forEach((stage) => {
          stage.status = LeagueStageStatus.COMPLETED;
        });
      }
      return split;
    }

    // Model the repository predicate, not a canned result that ignores the year.
    function useStoredSplits(splits: LeagueSplit[]) {
      leagueSplitsRepository.findOne.mockImplementation(
        ({
          where,
        }: {
          where: {
            careerId: number;
            region: Region;
            splitNumber?: number;
            year?: number;
          };
        }) =>
          Promise.resolve(
            splits.find(
              (split) =>
                split.careerId === where.careerId &&
                split.region === where.region &&
                (where.splitNumber === undefined ||
                  split.splitNumber === where.splitNumber) &&
                (where.year === undefined || split.year === where.year),
            ) ?? null,
          ),
      );
    }

    it.each([
      [Region.LCK, 2026],
      [Region.LCK, 2028],
      [Region.LPL, 2026],
      [Region.LPL, 2028],
    ])(
      'does not use %s Split 2 from %i to seed 2027',
      async (region, priorYear) => {
        const oldSplit = await createPriorSplit(region, priorYear, true);
        useStoredSplits([oldSplit]);
        career.currentYear = 2027;
        career.currentDate = '2027-07-29';
        entityManager.save.mockClear();

        await expect(
          service.createSplit(7, career.id, {
            region,
            splitNumber: 3,
          }),
        ).rejects.toThrow('must exist in 2027');
        expect(leagueSplitsRepository.findOne).toHaveBeenLastCalledWith(
          expect.objectContaining({
            where: { careerId: career.id, year: 2027, region, splitNumber: 2 },
          }),
        );
        expect(entityManager.save).not.toHaveBeenCalled();
      },
    );

    it.each([Region.LCK, Region.LPL])(
      'requires the current %s Split 2 to be completed',
      async (region) => {
        const oldSplit = await createPriorSplit(region, 2026, true);
        const currentSplit = await createPriorSplit(region, 2027, false);
        useStoredSplits([oldSplit, currentSplit]);
        entityManager.save.mockClear();

        await expect(
          service.createSplit(7, career.id, { region, splitNumber: 3 }),
        ).rejects.toThrow('in 2027 must be completed');
        expect(entityManager.save).not.toHaveBeenCalled();
      },
    );

    it.each([Region.LCK, Region.LPL])(
      'seeds %s Split 3 from the completed current season',
      async (region) => {
        const oldSplit = await createPriorSplit(region, 2026, true);
        const currentSplit = await createPriorSplit(region, 2027, true);
        const fixture = currentSplit.stages[0].fixtures[0];
        fixture.seriesId = 50;
        fixture.series = {
          id: 50,
          bestOf: 3,
          games: [
            { winnerTeamId: fixture.teamBId },
            { winnerTeamId: fixture.teamBId },
          ],
        } as MatchSeries;
        useStoredSplits([oldSplit, currentSplit]);

        const result = await service.createSplit(7, career.id, {
          region,
          splitNumber: 3,
        });

        expect(result.year).toBe(2027);
        expect(result.stages[0].participants[0].teamId).toBe(fixture.teamBId);
        expect(result.stages[0].fixtures.length).toBeGreaterThan(0);
        expect(
          result.stages[0].fixtures.every((game) =>
            game.scheduledDate.startsWith('2027-'),
          ),
        ).toBe(true);
      },
    );
  });

  it('derives standings only from completed fixtures in that stage', async () => {
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    const fixture = savedSplit!.stages[0].fixtures[0];

    fixture.series = {
      id: 50,
      bestOf: 3,
      games: [
        { winnerTeamId: fixture.teamAId } as Match,
        { winnerTeamId: fixture.teamBId } as Match,
        { winnerTeamId: fixture.teamAId } as Match,
      ],
    } as MatchSeries;
    fixture.seriesId = fixture.series.id;

    const result = await service.findOne(7, career.id, savedSplit!.id);

    expect(result.stages[0].fixtures[0].status).toBe(
      LeagueFixtureStatus.COMPLETED,
    );
    expect(result.stages[0].standings[0]).toEqual(
      expect.objectContaining({
        teamId: fixture.teamAId,
        played: 1,
        seriesWins: 1,
        gameWins: 2,
        gameLosses: 1,
      }),
    );
  });

  it('creates the fixture series with its BO3 or BO5 rule', async () => {
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    const fixture = savedSplit!.stages[0].fixtures[0];

    career.currentDate = fixture.scheduledDate;
    entityManager.findOne.mockResolvedValue(fixture);
    const result = await service.simulateNextFixtureGame(
      7,
      career.id,
      savedSplit!.id,
      fixture.id,
    );

    expect(result.fixtureId).toBe(fixture.id);
    expect(fixture.series?.bestOf).toBe(3);
    expect(matchSeriesService.simulateNextGame).toHaveBeenCalledWith(7, 50);
  });

  it('recovers a completed fixture without replaying games and makes retries idempotent', async () => {
    career.careerTeams = lckTeams.slice(0, 2);
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 2,
    });
    const stage = savedSplit!.stages[0];
    const fixture = stage.fixtures[0];
    career.currentDate = fixture.scheduledDate;
    fixture.seriesId = 50;
    fixture.series = {
      id: 50,
      bestOf: 3,
      games: [
        { winnerTeamId: fixture.teamAId },
        { winnerTeamId: fixture.teamAId },
      ],
    } as MatchSeries;
    matchSeriesService.findOne.mockResolvedValue({
      ...createSeriesResponse(),
      status: MatchSeriesStatus.COMPLETED,
      winnerTeamId: fixture.teamAId,
      nextGameNumber: null,
    });
    entityManager.findOne.mockImplementation((entity: unknown) =>
      Promise.resolve(entity === LeagueFixture ? fixture : savedSplit),
    );

    const recovered = await service.simulateNextFixtureGame(
      7,
      career.id,
      savedSplit!.id,
      fixture.id,
    );
    const retried = await service.simulateNextFixtureGame(
      7,
      career.id,
      savedSplit!.id,
      fixture.id,
    );

    expect(recovered.series.status).toBe(MatchSeriesStatus.COMPLETED);
    expect(retried.series).toEqual(recovered.series);
    expect(stage.currentRound).toBe(2);
    expect(stage.fixtures).toHaveLength(2);
    expect(matchSeriesService.simulateNextGame).not.toHaveBeenCalled();
  });

  it('reports a gauntlet champion above a runner-up with more wins', async () => {
    career.careerTeams = lckTeams.slice(0, 6);
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 2,
    });
    const stage = savedSplit!.stages[1];
    stage.status = LeagueStageStatus.COMPLETED;
    stage.format = LeagueStageFormat.GAUNTLET;
    stage.participants = career.careerTeams.map((team, index) => ({
      careerTeamId: team.id,
      initialSeed: index + 1,
      team,
    })) as LeagueStageParticipant[];
    const runner = career.careerTeams[5];
    stage.fixtures = [5, 4, 3, 2, 1].map((seed, index) => {
      const opponent = career.careerTeams[seed - 1];
      return {
        id: 300 + index,
        teamAId: opponent.id,
        teamA: opponent,
        teamBId: runner.id,
        teamB: runner,
        bestOf: 5,
        roundNumber: index + 1,
        stageFixtureNumber: index + 1,
        seriesId: 400 + index,
        series: {
          games: Array.from({ length: 3 }, () => ({
            winnerTeamId: seed === 1 ? opponent.id : runner.id,
          })),
        },
      } as LeagueFixture;
    });

    const response = await service.findOne(7, career.id, savedSplit!.id);
    const standings = response.stages[1].standings;

    expect(standings.map((standing) => standing.teamId)).toEqual([
      1, 6, 2, 3, 4, 5,
    ]);
    expect(standings.map((standing) => standing.rank)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(standings[0].seriesWins).toBe(1);
    expect(standings[1].seriesWins).toBe(4);
  });

  it('blocks the active fixture before its scheduled date', async () => {
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    const fixture = savedSplit!.stages[0].fixtures[0];

    expect(fixture.scheduledDate).toBe('2026-01-12');
    entityManager.findOne.mockResolvedValue(fixture);

    await expect(
      service.simulateNextFixtureGame(7, career.id, savedSplit!.id, fixture.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks direct set simulation while a user-action event is unresolved', async () => {
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    const fixture = savedSplit!.stages[0].fixtures[0];

    career.currentDate = fixture.scheduledDate;
    entityManager.findOne.mockResolvedValue(fixture);
    eventQueueService.findBlockingEvents.mockResolvedValue([{ id: 99 }]);

    await expect(
      service.simulateNextFixtureGame(7, career.id, savedSplit!.id, fixture.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(matchSeriesService.simulateNextGame).not.toHaveBeenCalled();
  });

  it('blocks a future round fixture and hides foreign fixtures', async () => {
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    const futureFixture = savedSplit!.stages[0].fixtures.find(
      (fixture) => fixture.roundNumber === 2,
    )!;

    entityManager.findOne.mockResolvedValue(futureFixture);
    await expect(
      service.simulateNextFixtureGame(
        7,
        career.id,
        savedSplit!.id,
        futureFixture.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    entityManager.findOne.mockResolvedValue(null);
    await expect(
      service.simulateNextFixtureGame(8, career.id, savedSplit!.id, 999),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate regional splits and regions without two teams', async () => {
    await service.createSplit(7, career.id, {
      region: Region.LCK,
      splitNumber: 1,
    });
    leagueSplitsRepository.findOneBy.mockResolvedValue(savedSplit);

    await expect(
      service.createSplit(7, career.id, {
        region: Region.LCK,
        splitNumber: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    leagueSplitsRepository.findOneBy.mockResolvedValue(null);
    career.careerTeams = [createTeams(1, Region.LEC, 301)[0]];
    await expect(
      service.createSplit(7, career.id, {
        region: Region.LEC,
        splitNumber: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function createTeams(
  count: number,
  region: Region,
  firstId: number,
): CareerTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    id: firstId + index,
    careerId: 1,
    code: `${region}_${index + 1}`,
    name: `${region} Team ${index + 1}`,
    region,
  })) as CareerTeam[];
}

function createSeriesResponse(): MatchSeriesResponseDto {
  return {
    seriesId: 50,
    careerId: 1,
    bestOf: 3,
    winsRequired: 2,
    status: MatchSeriesStatus.IN_PROGRESS,
    winnerTeamId: null,
    nextGameNumber: 2,
    seed: 1,
    teams: [
      { teamId: 1, teamCode: 'LCK_1', wins: 1 },
      { teamId: 2, teamCode: 'LCK_2', wins: 0 },
    ],
    games: [],
  };
}
