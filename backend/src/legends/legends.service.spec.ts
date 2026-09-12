import { NotFoundException } from '@nestjs/common';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { PlayerCard } from '../players/entities/player-card.entity';
import { LegendEvent } from './entities/legend-event.entity';
import { LegendSeason } from './entities/legend-season.entity';
import * as policy from './legend-policy';
import { LegendsService } from './legends.service';

describe('Legend event lifecycle', () => {
  const career = { id: 1, accountId: 7, currentDate: '2026-11-19' } as Career;
  const manager = {
    existsBy: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    findBy: jest.fn(),
    create: jest.fn((_entity: unknown, value: object) => value),
    save: jest.fn((_entity: unknown, value: object) =>
      Promise.resolve({ id: 10, ...value }),
    ),
  };
  const ai = { prepareInterests: jest.fn(), processCompetition: jest.fn() };
  const transfers = { findMarket: jest.fn() };
  const service = new LegendsService(
    { manager } as never,
    transfers as never,
    ai as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    manager.existsBy.mockResolvedValue(false);
    manager.findOne.mockResolvedValue(null);
    manager.findOneBy.mockResolvedValue(career);
    manager.findOneOrFail.mockResolvedValue({ id: 5, seed: 'private-seed' });
    manager.find.mockResolvedValue([]);
    manager.findBy.mockResolvedValue([]);
    transfers.findMarket.mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not plan outside the offseason', async () => {
    await service.prepareSeason(manager as never, career, '2026-07-29');
    expect(manager.existsBy).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('never rerolls a season already persisted', async () => {
    manager.existsBy.mockResolvedValue(true);
    await service.prepareSeason(manager as never, career, career.currentDate);
    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it.each([
    [2025, 2],
    [2024, 0],
  ])(
    'uses only the consecutive previous season (%s) and excludes existing cards',
    async (previousYear, expectedStreak) => {
      manager.findOne.mockResolvedValue({
        year: previousYear,
        zeroEventStreak: 2,
      });
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === PlayerCard
            ? [
                { id: 11, themeId: 9 },
                { id: 12, themeId: 9 },
              ]
            : [{ playerCardId: 11 }],
        ),
      );
      const planner = jest
        .spyOn(policy, 'planLegendSeason')
        .mockReturnValue({ events: [], zeroEventStreak: 3 });
      await service.prepareSeason(manager as never, career, career.currentDate);
      expect(planner).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9]{64}$/),
        2026,
        expectedStreak,
        [{ themeId: 9, playerCardIds: [12] }],
      );
      expect(manager.save).toHaveBeenCalledWith(
        LegendSeason,
        expect.objectContaining({ careerId: 1, year: 2026, eventCount: 0 }),
      );
    },
  );

  it('persists the private plan and schedules only its internal identifier', async () => {
    jest.spyOn(policy, 'planLegendSeason').mockReturnValue({
      events: [{ themeId: 9, playerCardIds: [12], revealDate: '2026-12-01' }],
      zeroEventStreak: 0,
    });
    await service.prepareSeason(manager as never, career, career.currentDate);
    expect(manager.save).toHaveBeenCalledWith(
      CalendarEvent,
      expect.objectContaining({
        scheduledDate: '2026-12-01',
        payload: { legendEventId: 10 },
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      LegendEvent,
      expect.objectContaining({ calendarEventId: 10, revealedDate: null }),
    );
  });

  function revealFixture() {
    const queued = Object.assign(new CalendarEvent(), {
      id: 8,
      careerId: 1,
      requiresUserAction: true,
      payload: { legendEventId: 9 },
    });
    const event = {
      id: 9,
      careerId: 1,
      seasonId: 5,
      themeId: 2,
      theme: { name: 'Demo' },
      playerCardIds: [12],
      revealDate: '2026-11-20',
      revealedDate: null,
    };
    manager.findOne.mockResolvedValue(event);
    return { queued, event };
  }

  it.each(['2026-11-19', '2027-01-01', '2027-11-20'])(
    'does not reveal on an early or different offseason date %s',
    async (date) => {
      const { queued } = revealFixture();
      await service.revealEvent(manager as never, career, queued, date);
      expect(manager.save).not.toHaveBeenCalled();
      expect(ai.prepareInterests).not.toHaveBeenCalled();
    },
  );

  it('rechecks duplicate cards at reveal time and never creates a second player', async () => {
    const { queued, event } = revealFixture();
    manager.find.mockImplementation((entity: unknown) =>
      Promise.resolve(
        entity === PlayerCard
          ? [{ id: 12, themeId: 2 }]
          : [{ playerCardId: 12 }],
      ),
    );
    await service.revealEvent(manager as never, career, queued, '2026-11-20');
    expect(manager.save).not.toHaveBeenCalledWith(
      CareerPlayer,
      expect.anything(),
    );
    expect(ai.prepareInterests).not.toHaveBeenCalled();
    expect(event.revealedDate).toBe('2026-11-20');
    expect(queued.requiresUserAction).toBe(false);
    expect(queued.payload?.playerCount).toBe(0);
  });

  it('rejects another account before looking at the market', async () => {
    manager.findOneBy.mockResolvedValue(null);
    await expect(service.findAll(8, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transfers.findMarket).not.toHaveBeenCalled();
  });

  it('read-only responses whitelist revealed data instead of serializing hidden plans or potential', async () => {
    manager.find.mockResolvedValue([
      {
        id: 4,
        season: { year: 2026, seed: 'secret', eventCount: 2 },
        revealDate: 'secret-date',
        revealedDate: '2026-11-20',
        playerCardIds: [9],
        theme: { id: 3, code: 'DEMO', name: 'Demo' },
        players: [
          {
            id: 1,
            interestedTeamIds: [],
            aiDecisionDate: 'secret-date',
            careerPlayer: {
              id: 6,
              playerCardId: 9,
              currentPosition: 'MID',
              currentAge: 20,
              currentTeamId: null,
              currentMechanics: 80,
              currentGameSense: 80,
              currentLaning: 80,
              currentTeamFight: 80,
              currentMacro: 80,
              currentTeamPlay: 80,
              currentMental: 80,
              currentChampionPool: 80,
              playerCard: {
                player: { nickname: 'Demo' },
                cardYear: 2021,
                imageUrl: null,
                potential: 99,
              },
            },
          },
        ],
      },
    ]);
    const result = await service.findAll(7, 1);
    const json = JSON.stringify(result);
    for (const secret of [
      'seed',
      'eventCount',
      'revealDate',
      'aiDecisionDate',
      'potential',
      'secret',
    ])
      expect(json).not.toContain(secret);
    expect(result.events[0].players[0].overall).toBe(80);
    expect(manager.save).not.toHaveBeenCalled();
    expect(ai.prepareInterests).not.toHaveBeenCalled();
  });
});
