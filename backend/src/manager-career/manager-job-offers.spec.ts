import { DataSource, EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Region } from '../careers/enums/region.enum';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import { ManagerJobOffer } from './entities/manager-job-offer.entity';
import { ManagerCareerService } from './manager-career.service';
import {
  describeManagerJobOffers,
  isCurrentJobOffer,
  prepareManagerJobOffers,
} from './manager-job-offers';

type StoredRow = { id?: number; [key: string]: unknown };
type Query = {
  where?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
};

/** Detached reads detect accidental GET mutation, not just unexpected saves. */
function memoryManager() {
  const tables = new Map<object, StoredRow[]>();
  const rows = <T extends object>(entity: new () => T): T[] =>
    structuredClone(tables.get(entity) ?? []) as T[];
  const put = <T extends object>(entity: new () => T, ...values: T[]) => {
    tables.set(entity, structuredClone(values) as StoredRow[]);
  };
  const read = (entity: object, query: Query = {}): StoredRow[] => {
    const found = (tables.get(entity) ?? []).filter((row) =>
      Object.entries(query.where ?? {}).every(
        ([key, value]) => row[key] === value,
      ),
    );
    found.sort((left, right) => {
      for (const [key, order] of Object.entries(query.order ?? {})) {
        const a = left[key] as string | number;
        const b = right[key] as string | number;
        const comparison = a < b ? -1 : a > b ? 1 : 0;
        if (comparison) return order === 'ASC' ? comparison : -comparison;
      }
      return 0;
    });
    return structuredClone(found);
  };
  const mock = {
    find: jest.fn((entity: object, query: Query) =>
      Promise.resolve(read(entity, query)),
    ),
    findOneBy: jest.fn((entity: object, where: Query['where']) =>
      Promise.resolve(read(entity, { where })[0] ?? null),
    ),
    create: jest.fn((_entity: object, value: StoredRow) =>
      structuredClone(value),
    ),
    save: jest.fn((entity: object, value: StoredRow) => {
      const entries = tables.get(entity) ?? [];
      const saved = structuredClone(value);
      saved.id ??= Math.max(0, ...entries.map((row) => row.id ?? 0)) + 1;
      const index = entries.findIndex((row) => row.id === saved.id);
      if (index < 0) entries.push(saved);
      else entries[index] = saved;
      tables.set(entity, entries);
      return Promise.resolve(structuredClone(saved));
    }),
  };
  return { manager: mock as unknown as EntityManager, mock, rows, put };
}

function club(id: number, region = Region.LCK, isUserControlled = false) {
  return Object.assign(new CareerTeam(), {
    id,
    careerId: 1,
    code: `TEAM${id}`,
    name: `Club ${id}`,
    region,
    isUserControlled,
  });
}

function invitation(changes: Partial<ManagerJobOffer> = {}) {
  return Object.assign(new ManagerJobOffer(), {
    id: 1,
    careerId: 1,
    seasonYear: 2026,
    fromCareerTeamId: 100,
    toCareerTeamId: 20,
    status: 'PENDING',
    offeredDate: '2026-11-19',
    expiresDate: '2026-12-31',
    resolvedDate: null,
    reason: '공식 감독 경력을 참고한 부임 제안입니다.',
    ...changes,
  });
}

function fixture(date = '2026-11-19') {
  const store = memoryManager();
  const career = Object.assign(new Career(), {
    id: 1,
    accountId: 7,
    currentYear: Number(date.slice(0, 4)),
    currentDate: date,
  });
  const state = Object.assign(new ManagerCareerState(), {
    id: 1,
    careerId: 1,
    careerTeamId: 100,
    status: 'ACTIVE',
    played: 12,
    wins: 8,
    fanApproval: 70,
    boardConfidence: 65,
    expectedWins: 7,
    winningStreak: 2,
    losingStreak: 0,
    reviewYear: 2026,
    trackingStartedDate: '2026-01-01',
    warnedDate: null,
    warningAtPlayed: null,
    dismissedDate: null,
  });
  store.put(Career, career);
  store.put(ManagerCareerState, state);
  store.put(CareerTeam, club(100, Region.LCK, true), club(20), club(30));
  return { ...store, career, state };
}

describe('manager recruitment stove-league policy', () => {
  it.each([
    ['2026-11-18', false],
    ['2026-11-19', true],
    ['2026-12-31', true],
    ['2027-01-01', false],
  ] as const)('checks the exact recruitment boundary %s', (date, expected) => {
    const { career } = fixture(date);
    const offer = Object.freeze(invitation());
    expect(isCurrentJobOffer(offer, career)).toBe(expected);
    expect(offer.status).toBe('PENDING');
  });

  it.each([
    { seasonYear: 2025 },
    { offeredDate: '2026-11-18' },
    { offeredDate: '2026-11-21' },
    { expiresDate: '2026-11-19' },
    { status: 'ACCEPTED' as const },
    { status: 'DECLINED' as const },
    { status: 'EXPIRED' as const },
  ])('rejects old, future, expired, or resolved offers %j', (changes) => {
    expect(
      isCurrentJobOffer(invitation(changes), fixture('2026-11-20').career),
    ).toBe(false);
  });

  it('does not generate or write offers before November 19', async () => {
    const { manager, mock, career, state } = fixture('2026-11-18');
    expect(await prepareManagerJobOffers(manager, career, state)).toEqual([]);
    expect(mock.find).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('prioritizes the same region, excludes controlled clubs and caps invitations at three', async () => {
    const f = fixture();
    f.put(
      CareerTeam,
      club(2, Region.LPL),
      club(40),
      club(100, Region.LCK, true),
      club(10, Region.LCK, true),
      club(30),
      club(1, Region.LEC),
      club(20),
    );
    const news = await prepareManagerJobOffers(f.manager, f.career, f.state);
    const offers = f.rows(ManagerJobOffer);
    expect(offers.map((offer) => offer.toCareerTeamId)).toEqual([20, 30, 40]);
    expect(offers.every((offer) => offer.fromCareerTeamId === 100)).toBe(true);
    expect(
      offers.every(
        (offer) =>
          offer.offeredDate === '2026-11-19' &&
          offer.expiresDate === '2026-12-31',
      ),
    ).toBe(true);
    expect(offers.every((offer) => offer.reason.includes('8승 4패'))).toBe(
      true,
    );
    expect(news).toHaveLength(3);
    expect(news.map((event) => event.payload?.managerJobOfferId)).toEqual(
      offers.map((offer) => offer.id),
    );
    expect(
      news.every(
        (event) =>
          event.status === CalendarEventStatus.COMPLETED &&
          event.type === CalendarEventType.AI_CLUB_UPDATE &&
          !event.requiresUserAction,
      ),
    ).toBe(true);
  });

  it('fills remaining invitations from other regions in stable team order', async () => {
    const f = fixture();
    f.put(
      CareerTeam,
      club(9, Region.LPL),
      club(30),
      club(100, Region.LCK, true),
      club(1, Region.LEC),
      club(20),
    );
    await prepareManagerJobOffers(f.manager, f.career, f.state);
    expect(
      f.rows(ManagerJobOffer).map((offer) => offer.toCareerTeamId),
    ).toEqual([20, 30, 1]);
  });

  it('does not fabricate invitations without an actual controlled source club', async () => {
    const f = fixture();
    f.put(CareerTeam, club(100), club(20));
    expect(await prepareManagerJobOffers(f.manager, f.career, f.state)).toEqual(
      [],
    );
    expect(f.mock.save).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const)(
    'does not reroll an existing annual batch after status %s',
    async (status) => {
      const f = fixture('2026-12-31');
      f.put(ManagerJobOffer, invitation({ status }));
      expect(
        await prepareManagerJobOffers(f.manager, f.career, f.state),
      ).toEqual([]);
      expect(f.rows(ManagerJobOffer)).toHaveLength(1);
      expect(f.rows(CalendarEvent)).toHaveLength(0);
      expect(f.mock.save).not.toHaveBeenCalled();
      expect(
        (await describeManagerJobOffers(f.manager, f.career)).canCheckOffers,
      ).toBe(false);
    },
  );

  it('expires pending offers on January 1 without changing accepted records or creating a new batch', async () => {
    const f = fixture('2027-01-01');
    f.put(
      ManagerJobOffer,
      invitation(),
      invitation({
        id: 2,
        toCareerTeamId: 30,
        status: 'ACCEPTED',
        resolvedDate: '2026-12-30',
      }),
    );
    expect(await prepareManagerJobOffers(f.manager, f.career, f.state)).toEqual(
      [],
    );
    expect(f.rows(ManagerJobOffer)).toEqual([
      expect.objectContaining({
        id: 1,
        status: 'EXPIRED',
        resolvedDate: '2027-01-01',
      }),
      expect.objectContaining({
        id: 2,
        status: 'ACCEPTED',
        resolvedDate: '2026-12-30',
      }),
    ]);
    expect(f.mock.save).toHaveBeenCalledTimes(1);
    expect(f.rows(CalendarEvent)).toHaveLength(0);
  });

  it('creates the next annual batch without reviving pending offers from the previous winter', async () => {
    const f = fixture('2027-11-19');
    f.put(ManagerJobOffer, invitation());
    await prepareManagerJobOffers(f.manager, f.career, f.state);
    const offers = f.rows(ManagerJobOffer);
    expect(offers.find((offer) => offer.id === 1)?.status).toBe('EXPIRED');
    expect(offers.filter((offer) => offer.seasonYear === 2027)).toHaveLength(2);
    expect(
      offers.filter((offer) => isCurrentJobOffer(offer, f.career)),
    ).toHaveLength(2);
  });
});

describe('read-only manager offer descriptions and badge counts', () => {
  it('returns actual source and destination teams without generating offers on GET', async () => {
    const f = fixture();
    const empty = await describeManagerJobOffers(f.manager, f.career);
    expect(empty).toMatchObject({
      careerId: 1,
      canCheckOffers: true,
      offers: [],
    });
    f.put(ManagerJobOffer, invitation());
    const before = f.rows(ManagerJobOffer);
    const result = await describeManagerJobOffers(f.manager, f.career);
    expect(result.offers).toEqual([
      expect.objectContaining({
        id: 1,
        canRespond: true,
        fromTeam: {
          id: 100,
          code: 'TEAM100',
          name: 'Club 100',
          region: Region.LCK,
        },
        toTeam: { id: 20, code: 'TEAM20', name: 'Club 20', region: Region.LCK },
      }),
    ]);
    expect(f.rows(ManagerJobOffer)).toEqual(before);
    expect(f.mock.save).not.toHaveBeenCalled();
    expect(f.mock.create).not.toHaveBeenCalled();
  });

  it('hides offers with a missing source or destination team and excludes other careers', async () => {
    const f = fixture();
    f.put(
      ManagerJobOffer,
      invitation(),
      invitation({ id: 2, fromCareerTeamId: 999 }),
      invitation({ id: 3, toCareerTeamId: 999 }),
      invitation({ id: 4, careerId: 2 }),
    );
    const result = await describeManagerJobOffers(f.manager, f.career);
    expect(result.offers.map((offer) => offer.id)).toEqual([1]);
    expect(f.mock.save).not.toHaveBeenCalled();
  });

  it('blocks responding after ownership changes even if the invitation dates are current', async () => {
    const f = fixture();
    f.put(CareerTeam, club(100), club(20, Region.LCK, true));
    f.put(ManagerJobOffer, invitation());
    expect(
      (await describeManagerJobOffers(f.manager, f.career)).offers[0]
        .canRespond,
    ).toBe(false);
    expect(f.mock.save).not.toHaveBeenCalled();
  });

  it('derives expiry after skipped dates without mutating storage, and the badge excludes it', async () => {
    const f = fixture('2027-01-05');
    f.put(ManagerJobOffer, invitation());
    const before = f.rows(ManagerJobOffer);
    expect(await prepareManagerJobOffers(f.manager, f.career, f.state)).toEqual(
      [],
    );
    const result = await describeManagerJobOffers(f.manager, f.career);
    expect(result).toMatchObject({
      canCheckOffers: false,
      window: { isOpen: false },
    });
    expect(result.offers[0]).toMatchObject({
      status: 'EXPIRED',
      canRespond: false,
    });
    const service = new ManagerCareerService({
      manager: f.manager,
    } as DataSource);
    expect(
      (await service.describe(f.manager, f.career)).pendingJobOfferCount,
    ).toBe(0);
    expect(f.rows(ManagerJobOffer)).toEqual(before);
    expect(f.mock.save).not.toHaveBeenCalled();
  });

  it('counts only current pending invitations for the managed club, without GET side effects', async () => {
    const f = fixture('2026-11-25');
    f.put(
      ManagerJobOffer,
      invitation(),
      invitation({ id: 2, toCareerTeamId: 30, status: 'DECLINED' }),
      invitation({
        id: 3,
        seasonYear: 2025,
        offeredDate: '2025-11-19',
        expiresDate: '2025-12-31',
      }),
      invitation({ id: 4, offeredDate: '2026-11-26' }),
      invitation({ id: 5, fromCareerTeamId: 20 }),
    );
    const before = f.rows(ManagerJobOffer);
    const service = new ManagerCareerService({
      manager: f.manager,
    } as DataSource);
    expect(
      (await service.describe(f.manager, f.career)).pendingJobOfferCount,
    ).toBe(1);
    expect(f.rows(ManagerJobOffer)).toEqual(before);
    expect(f.mock.save).not.toHaveBeenCalled();
  });
});
