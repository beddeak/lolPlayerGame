import { EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Region } from '../careers/enums/region.enum';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueStage } from '../leagues/entities/league-stage.entity';
import { LeagueStageStatus } from '../leagues/enums/league-stage-status.enum';
import { LeaguesService } from '../leagues/leagues.service';
import { SeasonScheduleService } from './season-schedule.service';
import { InternationalsService } from '../internationals/internationals.service';

describe('SeasonScheduleService', () => {
  let teams: CareerTeam[];
  let splits: LeagueSplit[];
  let career: Career;
  const manager = { find: jest.fn() };
  const leagues = { ensureCalendarSplit: jest.fn() };
  const service = new SeasonScheduleService(
    leagues as unknown as LeaguesService,
    { prepare: jest.fn() } as unknown as InternationalsService,
  );
  const em = manager as unknown as EntityManager;

  beforeEach(() => {
    jest.clearAllMocks();
    career = {
      id: 1,
      accountId: 7,
      currentYear: 2026,
      currentDate: '2026-01-01',
      autoSchedule: true,
    } as Career;
    teams = Object.values(Region).flatMap((region, index) =>
      [1, 2].map(
        (number) =>
          ({
            id: index * 10 + number,
            careerId: career.id,
            region,
          }) as CareerTeam,
      ),
    );
    splits = [];
    manager.find.mockImplementation((entity) =>
      Promise.resolve(entity === CareerTeam ? teams : splits),
    );
    leagues.ensureCalendarSplit.mockImplementation(
      (
        _manager: EntityManager,
        currentCareer: Career,
        region: Region,
        splitNumber: number,
      ) => {
        splits.push(makeSplit(region, currentCareer.currentYear, splitNumber));
        return Promise.resolve();
      },
    );
  });

  it('keeps manual careers untouched', async () => {
    career.autoSchedule = false;
    await service.prepare(em, career);
    expect(manager.find).not.toHaveBeenCalled();
    expect(leagues.ensureCalendarSplit).not.toHaveBeenCalled();
  });

  it('provisions all supported regions with two teams idempotently', async () => {
    await service.prepare(em, career);
    await service.prepare(em, career);
    expect(leagues.ensureCalendarSplit).toHaveBeenCalledTimes(4);
    expect(splits.map((split) => split.splitNumber)).toEqual([1, 1, 1, 1]);
    expect(leagues.ensureCalendarSplit).toHaveBeenCalledWith(
      em,
      expect.objectContaining({
        currentDate: '2026-01-01',
        careerTeams: teams,
      }),
      Region.LCK,
      1,
    );
  });

  it('never creates absent or one-team regions', async () => {
    teams = teams.filter(
      (team) => team.region === Region.LCK || team.id === 11,
    );
    await service.prepare(em, career);
    expect(leagues.ensureCalendarSplit).toHaveBeenCalledTimes(1);
    const readiness = await service.describe(em, career);
    expect(readiness.find((row) => row.region === Region.LPL)).toMatchObject({
      teamCount: 1,
      status: 'INSUFFICIENT_TEAMS',
    });
    expect(readiness.find((row) => row.region === Region.LEC)).toMatchObject({
      teamCount: 0,
      status: 'INSUFFICIENT_TEAMS',
    });
  });

  it('describes readiness without provisioning or mutating legacy saves', async () => {
    career.autoSchedule = false;
    const before = JSON.stringify({ career, teams, splits });
    const result = await service.describe(em, career);
    expect(result).toHaveLength(6);
    expect(result.filter((row) => row.status === 'READY')).toHaveLength(4);
    expect(
      result.filter((row) => row.status === 'INSUFFICIENT_TEAMS'),
    ).toHaveLength(2);
    expect(leagues.ensureCalendarSplit).not.toHaveBeenCalled();
    expect(JSON.stringify({ career, teams, splits })).toBe(before);
  });

  it.each(['2026-03-09', '2026-03-30', '2026-06-21'])(
    'does not backfill ended Split 1 on %s',
    async (date) => {
      career.currentDate = date;
      await service.prepare(em, career);
      expect(splits).toHaveLength(4);
      expect(splits.every((split) => split.splitNumber === 2)).toBe(true);
    },
  );

  it('waits for unfinished earlier splits, including previous years', async () => {
    career.currentDate = '2026-03-30';
    splits = [makeSplit(Region.LCK, 2025, 3), makeSplit(Region.LPL, 2026, 1)];
    await service.prepare(em, career);
    expect(leagues.ensureCalendarSplit).toHaveBeenCalledTimes(2);
    const readiness = await service.describe(em, career);
    expect(
      readiness
        .filter((row) => row.status === 'WAITING_FOR_PREVIOUS_SPLIT')
        .map((row) => row.region),
    ).toEqual([Region.LCK, Region.LPL]);
  });

  it('does not mistake a split with no stages for a completed season', async () => {
    career.currentDate = '2026-03-30';
    const old = makeSplit(Region.LCK, 2025, 3);
    old.stages = [];
    splits = [old];
    expect((await service.describe(em, career))[0].status).toBe(
      'WAITING_FOR_PREVIOUS_SPLIT',
    );
  });

  it('requires actual same-year completed Split 2 for LCK/LPL Split 3', async () => {
    career.currentDate = '2026-07-29';
    splits = [makeSplit(Region.LCK, 2025, 2, true)];
    await service.prepare(em, career);
    expect(leagues.ensureCalendarSplit).toHaveBeenCalledTimes(2);
    expect(
      splits.some(
        (split) => split.region === Region.LCK && split.year === 2026,
      ),
    ).toBe(false);
    splits.push(makeSplit(Region.LCK, 2026, 2, true));
    await service.prepare(em, career);
    expect(leagues.ensureCalendarSplit).toHaveBeenCalledTimes(3);
    expect(
      splits.some(
        (split) => split.region === Region.LCK && split.splitNumber === 3,
      ),
    ).toBe(true);
  });

  it('preserves an existing Split 3 even when its prerequisite history is absent', async () => {
    career.currentDate = '2026-07-29';
    splits = [makeSplit(Region.LCK, 2026, 3)];
    expect((await service.describe(em, career))[0].status).toBe('READY');
    await service.prepare(em, career);
    expect(leagues.ensureCalendarSplit).not.toHaveBeenCalledWith(
      em,
      expect.anything(),
      Region.LCK,
      3,
    );
  });

  it.each(['2026-10-08', '2026-11-19', '2026-12-31'])(
    'does not manufacture missed domestic splits on %s',
    async (date) => {
      career.currentDate = date;
      await service.prepare(em, career);
      expect(leagues.ensureCalendarSplit).not.toHaveBeenCalled();
      expect(
        (await service.describe(em, career)).every(
          (row) =>
            row.status === 'NO_REMAINING_SPLIT' && row.splitNumber === null,
        ),
      ).toBe(true);
    },
  );

  it('starts the next year without replacing old split records', async () => {
    splits = Object.values(Region).map((region) =>
      makeSplit(region, 2026, 3, true),
    );
    const oldRecords = [...splits];
    career.currentYear = 2027;
    career.currentDate = '2027-01-01';
    await service.prepare(em, career);
    expect(splits).toHaveLength(oldRecords.length + 4);
    expect(splits.slice(0, oldRecords.length)).toEqual(oldRecords);
    expect(
      splits
        .slice(oldRecords.length)
        .every((split) => split.year === 2027 && split.splitNumber === 1),
    ).toBe(true);
  });
});

function makeSplit(
  region: Region,
  year: number,
  splitNumber: number,
  completed = false,
): LeagueSplit {
  return {
    id: year * 10 + splitNumber,
    careerId: 1,
    year,
    region,
    splitNumber,
    stages: [
      {
        status: completed
          ? LeagueStageStatus.COMPLETED
          : LeagueStageStatus.ACTIVE,
      } as LeagueStage,
    ],
  } as LeagueSplit;
}
