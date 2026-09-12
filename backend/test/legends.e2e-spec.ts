import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import { addCalendarDays } from '../src/calendars/calendar-date';
import { Career } from '../src/careers/entities/career.entity';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { CareerPlayerPositionProficiency } from '../src/careers/entities/career-player-position-proficiency.entity';
import { CareerPlayerRoleProficiency } from '../src/careers/entities/career-player-role-proficiency.entity';
import { Roster } from '../src/careers/entities/roster.entity';
import { PLAYER_INSTRUCTIONS_BY_POSITION } from '../src/careers/config/player-instruction.config';
import { Region } from '../src/careers/enums/region.enum';
import { RosterRole } from '../src/careers/enums/roster-role.enum';
import {
  ContractExpectedRole,
  ContractOfferStatus,
  ContractOfferType,
  PlayerContractStatus,
} from '../src/contracts/contract.types';
import { ContractOffer } from '../src/contracts/entities/contract-offer.entity';
import { PlayerContract } from '../src/contracts/entities/player-contract.entity';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../src/event-queue/enums/calendar-event-type.enum';
import { LegendEvent } from '../src/legends/entities/legend-event.entity';
import { LegendEventPlayer } from '../src/legends/entities/legend-event-player.entity';
import { LegendSeason } from '../src/legends/entities/legend-season.entity';
import { Player } from '../src/players/entities/player.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { Position } from '../src/players/enums/position.enum';
import { FastSimResponseDto } from '../src/simulations/dto/simulation-response.dto';
import { TransferRecord } from '../src/transfers/entities/transfer-record.entity';
import { TransferRecordType } from '../src/transfers/transfer.types';

interface AuthResult {
  accessToken: string;
  account: { id: number };
}
interface CareerResult {
  id: number;
  currentDate: string;
  teams: Array<{ id: number; isUserControlled: boolean }>;
}
interface CalendarResult {
  currentDate: string;
  advancedDays: number;
  stopReason: string;
  blockingEvents: Array<{ id: number; type: CalendarEventType }>;
  processedEvents: Array<{
    id: number;
    type: CalendarEventType;
    requiresUserAction: boolean;
    status: CalendarEventStatus;
  }>;
}
interface LegendResult {
  careerId: number;
  currentDate: string;
  events: Array<{
    id: number;
    revealedDate: string;
    players: Array<{
      careerPlayerId: number;
      playerCardId: number;
      canNegotiate: boolean;
      currentTeam: { id: number } | null;
    }>;
  }>;
}
const json = <T>(response: { body: unknown }): T => response.body as T;

describe('Legend Event lifecycle and competition (e2e)', () => {
  jest.setTimeout(120_000);
  const key = `legend_${Date.now()}_${process.pid}`;
  const positions = Object.values(Position);
  const accountIds: number[] = [];
  const playerIds: number[] = [];
  const cardIds: number[] = [];
  const themeIds: number[] = [];
  const legendCards: number[] = [];
  const terms = {
    annualSalary: 200_000,
    years: 2,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.CORE,
    promises: [],
  };
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let legendThemeId: number;
  const api = () => request(app.getHttpServer());
  const auth = (token = ownerToken) => ({ Authorization: `Bearer ${token}` });
  const base = (id: number) => `/careers/${id}`;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    dataSource = app.get(DataSource);
    const tokens: string[] = [];
    for (const suffix of ['owner', 'other']) {
      const account = json<AuthResult>(
        await api()
          .post('/auth/register')
          .send({
            email: `${key}_${suffix}@example.com`,
            password: 'legend-e2e-password',
            displayName: `Legend ${suffix}`,
          })
          .expect(201),
      );
      accountIds.push(account.account.id);
      tokens.push(account.accessToken);
    }
    [ownerToken, otherToken] = tokens;
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accountIds[0]]);
    for (const enabled of [false, true]) {
      const theme = json<{ id: number }>(
        await api()
          .post('/themes')
          .set(auth())
          .send({
            code: `${key}_${enabled}`.toUpperCase(),
            name: `Legend E2E ${enabled}`,
            legendEnabled: enabled,
          })
          .expect(201),
      );
      themeIds.push(theme.id);
      if (enabled) legendThemeId = theme.id;
    }
    for (let index = 0; index < 15; index += 1) {
      const player = json<{ id: number }>(
        await api()
          .post('/players')
          .set(auth())
          .send({ nickname: `${key}_${index}`, nationality: 'KR' })
          .expect(201),
      );
      playerIds.push(player.id);
      const legend = index >= 10;
      const stat = legend ? 86 : 80;
      const card = json<{ id: number }>(
        await api()
          .post('/player-cards')
          .set(auth())
          .send({
            playerId: player.id,
            themeId: legend ? legendThemeId : themeIds[0],
            cardYear: legend ? 2021 : 2026,
            startingAge: legend ? 22 : 24,
            mainPosition: positions[index % positions.length],
            mechanics: stat,
            gameSense: stat,
            laning: stat,
            teamFight: stat,
            macro: stat,
            teamPlay: stat,
            mental: stat,
            championPool: stat,
            personality: PlayerPersonality.PROFESSIONAL,
            potential: 95,
          })
          .expect(201),
      );
      cardIds.push(card.id);
      if (legend) legendCards.push(card.id);
    }
  });

  async function createCareer(
    date = '2026-11-19',
    preexistingLegend = false,
  ): Promise<CareerResult> {
    const career = json<CareerResult>(
      await api()
        .post('/careers')
        .set(auth())
        .send({
          startYear: 2026,
          managedTeamCode: 'LEGEND_HOME',
          teams: [
            {
              code: 'LEGEND_HOME',
              name: 'Legend Home',
              region: Region.LCK,
              starters: positions.map((position, index) => ({
                position,
                playerCardId: cardIds[index],
              })),
              benches: preexistingLegend
                ? [{ playerCardId: legendCards[0] }]
                : [],
            },
            {
              code: 'LEGEND_AI',
              name: 'Legend AI',
              region: Region.LPL,
              starters: positions.map((position, index) => ({
                position,
                playerCardId: cardIds[5 + index],
              })),
            },
          ],
        })
        .expect(201),
    );
    await dataSource.getRepository(Career).update(career.id, {
      currentDate: date,
      currentYear: Number(date.slice(0, 4)),
    });
    return { ...career, currentDate: date };
  }

  async function planFixture(
    career: CareerResult,
    revealDate = '2026-11-20',
    ordinal = 1,
  ) {
    const seasons = dataSource.getRepository(LegendSeason);
    let season = await seasons.findOneBy({
      careerId: career.id,
      year: Number(revealDate.slice(0, 4)),
    });
    if (!season)
      season = await seasons.save(
        seasons.create({
          careerId: career.id,
          year: Number(revealDate.slice(0, 4)),
          seed: 'a'.repeat(64),
          eventCount: 1,
          zeroEventStreak: 0,
        }),
      );
    const events = dataSource.getRepository(LegendEvent);
    const event = await events.save(
      events.create({
        careerId: career.id,
        seasonId: season.id,
        themeId: legendThemeId,
        ordinal,
        playerCardIds: [...legendCards],
        revealDate,
        revealedDate: null,
        calendarEventId: null,
      }),
    );
    const queue = dataSource.getRepository(CalendarEvent);
    const queued = await queue.save(
      queue.create({
        careerId: career.id,
        type: CalendarEventType.LEGEND_REVEAL,
        scheduledDate: revealDate,
        status: CalendarEventStatus.SCHEDULED,
        requiresUserAction: true,
        payload: { legendEventId: event.id },
        completedAt: null,
      }),
    );
    event.calendarEventId = queued.id;
    await events.save(event);
    return { event, queued, season };
  }

  async function advance(careerId: number, mode = 'NEXT_EVENT') {
    return json<CalendarResult>(
      await api()
        .post(`${base(careerId)}/calendar/advance`)
        .set(auth())
        .send({ mode })
        .expect(201),
    );
  }
  async function legends(careerId: number) {
    return json<LegendResult>(
      await api()
        .get(`${base(careerId)}/legend-events`)
        .set(auth())
        .expect(200),
    );
  }
  async function reveal(career: CareerResult) {
    const fixture = await planFixture(career);
    const result = await advance(career.id);
    expect(result.currentDate).toBe(fixture.event.revealDate);
    expect(result.blockingEvents.map((event) => event.id)).toContain(
      fixture.queued.id,
    );
    await api()
      .post(`${base(career.id)}/events/${fixture.queued.id}/resolve`)
      .set(auth())
      .expect(201);
    const entrants = await dataSource.getRepository(LegendEventPlayer).find({
      where: { legendEventId: fixture.event.id },
      order: { id: 'ASC' },
    });
    return { ...fixture, entrants };
  }
  async function offer(
    careerId: number,
    careerPlayerId: number,
    transferAgreementId?: number,
  ) {
    return json<ContractOffer>(
      await api()
        .post(`${base(careerId)}/contracts/offers`)
        .set(auth())
        .send({
          careerPlayerId,
          terms,
          ...(transferAgreementId === undefined ? {} : { transferAgreementId }),
        })
        .expect(201),
    );
  }

  it('keeps public reads inert and protects every career legend response by ownership', async () => {
    const career = await createCareer();
    await api()
      .get(`${base(career.id)}/legend-events`)
      .expect(401);
    await api()
      .get(`${base(career.id)}/legend-events`)
      .set(auth(otherToken))
      .expect(404);
    expect((await legends(career.id)).events).toEqual([]);
    expect((await legends(career.id)).events).toEqual([]);
    expect(
      await dataSource
        .getRepository(LegendSeason)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .countBy({ careerId: career.id }),
    ).toBe(10);
  });

  it('plans once at opening, applies two-zero-season pity, and conceals future event dates', async () => {
    const career = await createCareer('2028-11-18');
    const seasons = dataSource.getRepository(LegendSeason);
    await seasons.save(
      [2026, 2027].map((year, index) =>
        seasons.create({
          careerId: career.id,
          year,
          seed: String(index).repeat(64),
          eventCount: 0,
          zeroEventStreak: index + 1,
        }),
      ),
    );
    const advanced = await advance(career.id, 'ONE_DAY');
    expect(advanced.currentDate).toBe('2028-11-19');
    const saved = await seasons.findOneOrFail({
      where: { careerId: career.id, year: 2028 },
      select: { id: true, seed: true, eventCount: true, zeroEventStreak: true },
    });
    expect(saved.eventCount).toBe(1); // This isolated fixture has one eligible theme.
    expect(saved.zeroEventStreak).toBe(0);
    const planned = await dataSource
      .getRepository(LegendEvent)
      .findBy({ seasonId: saved.id });
    expect(planned).toHaveLength(1);
    const scheduled = json<CalendarEvent[]>(
      await api()
        .get(`${base(career.id)}/events?status=SCHEDULED`)
        .set(auth())
        .expect(200),
    );
    expect(
      scheduled.some((event) => event.type === CalendarEventType.LEGEND_REVEAL),
    ).toBe(false);
    expect((await legends(career.id)).events).toEqual([]);
    await api()
      .post(`${base(career.id)}/events/${planned[0].calendarEventId}/resolve`)
      .set(auth())
      .expect(404);
    for (const suffix of ['legend-events', 'events', 'calendar']) {
      const response = await api()
        .get(`${base(career.id)}/${suffix}`)
        .set(auth())
        .expect(200);
      expect(JSON.stringify(response.body)).not.toContain(
        planned[0].revealDate,
      );
      expect(JSON.stringify(response.body)).not.toContain(saved.seed);
      expect(JSON.stringify(response.body)).not.toContain('playerCardIds');
    }
    await advance(career.id, 'ONE_DAY');
    expect(await seasons.countBy({ careerId: career.id, year: 2028 })).toBe(1);
    const same = await seasons.findOneOrFail({
      where: { id: saved.id },
      select: { seed: true },
    });
    expect(same.seed).toBe(saved.seed);
    expect(
      await dataSource
        .getRepository(LegendEvent)
        .countBy({ seasonId: saved.id }),
    ).toBe(1);
  });

  it('reveals a complete FA group with all proficiencies without duplicating existing cards or leaking potential', async () => {
    const career = await createCareer('2026-11-19', true);
    const first = await planFixture(career, '2026-11-20');
    const second = await planFixture(career, '2026-11-21', 2);
    const before = await dataSource
      .getRepository(PlayerCard)
      .find({ where: { id: In(legendCards) }, order: { id: 'ASC' } });
    const advanced = await advance(career.id);
    expect(advanced.currentDate).toBe('2026-11-20');
    const view = await legends(career.id);
    expect(view.events).toHaveLength(1);
    expect(view.events[0].players).toHaveLength(4);
    for (const entrant of view.events[0].players) {
      expect(entrant.currentTeam).toBeNull();
      expect(entrant.canNegotiate).toBe(true);
      const current = await dataSource
        .getRepository(CareerPlayer)
        .findOneByOrFail({ id: entrant.careerPlayerId });
      expect(current.currentAge).toBe(22);
      expect(current.currentMechanics).toBe(86);
      expect(
        await dataSource
          .getRepository(Roster)
          .countBy({ careerPlayerId: current.id }),
      ).toBe(0);
      expect(
        await dataSource
          .getRepository(CareerPlayerPositionProficiency)
          .countBy({ careerPlayerId: current.id }),
      ).toBe(5);
      expect(
        await dataSource
          .getRepository(CareerPlayerRoleProficiency)
          .countBy({ careerPlayerId: current.id }),
      ).toBe(PLAYER_INSTRUCTIONS_BY_POSITION[current.currentPosition].length);
    }
    for (const suffix of [
      'legend-events',
      'events',
      'calendar',
      'transfers/market',
    ]) {
      const response = await api()
        .get(`${base(career.id)}/${suffix}`)
        .set(auth())
        .expect(200);
      const serialized = JSON.stringify(response.body);
      for (const field of [
        '"potential"',
        '"aiDecisionDate"',
        '"seed"',
        '"playerCardIds"',
        '"zeroEventStreak"',
      ])
        expect(serialized).not.toContain(field);
      expect(serialized).not.toContain('2026-11-21');
    }
    await api()
      .post(`${base(career.id)}/events/${first.queued.id}/resolve`)
      .set(auth(otherToken))
      .expect(404);
    await api()
      .post(`${base(career.id)}/events/${first.queued.id}/resolve`)
      .set(auth())
      .expect(201);
    const duplicateReveal = await advance(career.id, 'ONE_DAY');
    expect(duplicateReveal.blockingEvents).toEqual([]);
    const duplicateQueued = await dataSource
      .getRepository(CalendarEvent)
      .findOneByOrFail({ id: second.queued.id });
    expect(duplicateQueued.status).toBe(CalendarEventStatus.COMPLETED);
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .countBy({ careerId: career.id, playerCardId: In(legendCards) }),
    ).toBe(5);
    expect(
      await dataSource
        .getRepository(LegendEventPlayer)
        .countBy({ careerId: career.id }),
    ).toBe(4);
    expect(
      await dataSource
        .getRepository(PlayerCard)
        .find({ where: { id: In(legendCards) }, order: { id: 'ASC' } }),
    ).toEqual(before);
  });

  it('preserves the AI reaction delay for a late December reveal and skips recruitment after the window closes', async () => {
    const career = await createCareer('2026-12-31');
    const fixture = await planFixture(career, '2026-11-20');
    const result = await advance(career.id, 'ONE_DAY');
    expect(result.currentDate).toBe('2026-12-31');
    expect(result.advancedDays).toBe(0);
    expect(result.stopReason).toBe('BLOCKING_EVENT');
    expect(result.blockingEvents.map((event) => event.id)).toEqual([
      fixture.queued.id,
    ]);
    const revealed = await dataSource
      .getRepository(LegendEvent)
      .findOneByOrFail({ id: fixture.event.id });
    expect(revealed.revealedDate).toBe('2026-12-31');
    const entrants = await dataSource
      .getRepository(LegendEventPlayer)
      .findBy({ legendEventId: fixture.event.id });
    expect(entrants).toHaveLength(5);
    for (const entrant of entrants) {
      expect(entrant.aiDecisionDate > '2026-12-31').toBe(true);
      expect(entrant.aiDecisionDate >= '2027-01-07').toBe(true);
      expect(entrant.aiDecisionDate <= '2027-01-14').toBe(true);
      expect(entrant.aiProcessedDate).toBeNull();
      expect(entrant.interestedTeamIds).toContain(
        career.teams.find((team) => !team.isUserControlled)!.id,
      );
    }
    const assertNoSigning = async () => {
      const players = await dataSource.getRepository(CareerPlayer).findBy({
        id: In(entrants.map((entrant) => entrant.careerPlayerId)),
      });
      expect(players).toHaveLength(5);
      expect(players.every((player) => player.currentTeamId === null)).toBe(
        true,
      );
      expect(
        await dataSource
          .getRepository(PlayerContract)
          .countBy({ careerId: career.id }),
      ).toBe(0);
      expect(
        await dataSource
          .getRepository(TransferRecord)
          .countBy({ careerId: career.id }),
      ).toBe(0);
      expect(
        await dataSource.getRepository(CalendarEvent).countBy({
          careerId: career.id,
          type: CalendarEventType.LEGEND_SIGNING,
        }),
      ).toBe(0);
    };
    await assertNoSigning();
    await api()
      .post(`${base(career.id)}/events/${fixture.queued.id}/resolve`)
      .set(auth())
      .expect(201);
    let january = result;
    for (let step = 0; step < 6; step += 1) {
      january = await advance(career.id, 'THREE_DAYS');
      expect(january.blockingEvents).toEqual([]);
    }
    expect(january.currentDate).toBe('2027-01-16');
    const processed = await dataSource
      .getRepository(LegendEventPlayer)
      .findBy({ legendEventId: fixture.event.id });
    for (const entrant of processed)
      expect(entrant.aiProcessedDate).toBe(entrant.aiDecisionDate);
    await assertNoSigning();
    expect(
      (await legends(career.id)).events[0].players.every(
        (player) => player.currentTeam === null && !player.canNegotiate,
      ),
    ).toBe(true);
  });

  it('stops Fast Sim at the first legend reveal and preserves that day until the user resolves it', async () => {
    const career = await createCareer();
    const fixture = await planFixture(career, '2026-11-21');
    const fast = async () =>
      json<FastSimResponseDto>(
        await api()
          .post(`${base(career.id)}/simulations/fast`)
          .set(auth())
          .send({ days: 10 })
          .expect(201),
      );
    const first = await fast();
    expect(first.targetDate).toBe('2026-11-29');
    expect(first.currentDate).toBe('2026-11-21');
    expect(first.advancedDays).toBe(2);
    expect(first.stopReason).toBe('BLOCKING_EVENT');
    expect(first.blockingEvents.map((event) => event.id)).toEqual([
      fixture.queued.id,
    ]);
    const repeated = await fast();
    expect(repeated.currentDate).toBe(first.currentDate);
    expect(repeated.calendar.currentDate).toBe(first.currentDate);
    expect(repeated.advancedDays).toBe(0);
    expect(repeated.stopReason).toBe('BLOCKING_EVENT');
    expect(repeated.blockingEvents.map((event) => event.id)).toEqual([
      fixture.queued.id,
    ]);
    expect(
      (
        await dataSource
          .getRepository(CalendarEvent)
          .findOneByOrFail({ id: fixture.queued.id })
      ).status,
    ).toBe(CalendarEventStatus.READY);
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .countBy({ careerId: career.id }),
    ).toBe(15);
    expect(
      await dataSource
        .getRepository(LegendEventPlayer)
        .countBy({ careerId: career.id }),
    ).toBe(5);
  });

  it('lets the user sign first and prevents later AI processing from stealing that player', async () => {
    const career = await createCareer();
    const { entrants } = await reveal(career);
    const target = entrants[0];
    const created = await offer(career.id, target.careerPlayerId);
    const response = await advance(career.id);
    expect(response.currentDate).toBe(created.responseDate);
    await api()
      .post(`${base(career.id)}/contracts/offers/${created.id}/respond`)
      .set(auth())
      .send({ action: 'ACCEPT' })
      .expect(201);
    await api()
      .post(`${base(career.id)}/contracts/offers/${created.id}/respond`)
      .set(auth())
      .send({ action: 'ACCEPT' })
      .expect(409);
    const home = career.teams.find((team) => team.isUserControlled)!;
    const player = await dataSource
      .getRepository(CareerPlayer)
      .findOneByOrFail({ id: target.careerPlayerId });
    expect(player.currentTeamId).toBe(home.id);
    const roster = await dataSource
      .getRepository(Roster)
      .findOneByOrFail({ careerPlayerId: player.id });
    expect(roster.role).toBe(RosterRole.BENCH);
    const contract = await dataSource
      .getRepository(PlayerContract)
      .findOneByOrFail({ careerPlayerId: player.id });
    expect(contract.sourceOfferId).toBe(created.id);
    expect(contract.status).toBe(PlayerContractStatus.ACTIVE);
    await dataSource.getRepository(LegendEventPlayer).update(target.id, {
      aiDecisionDate: addCalendarDays(response.currentDate, 1),
    });
    await advance(career.id, 'ONE_DAY');
    expect(
      (
        await dataSource
          .getRepository(CareerPlayer)
          .findOneByOrFail({ id: player.id })
      ).currentTeamId,
    ).toBe(home.id);
    expect(
      (
        await dataSource
          .getRepository(LegendEventPlayer)
          .findOneByOrFail({ id: target.id })
      ).aiProcessedDate,
    ).not.toBeNull();
    expect(
      await dataSource
        .getRepository(TransferRecord)
        .countBy({ careerId: career.id, careerPlayerId: player.id }),
    ).toBe(1);
    const publicPlayer = (await legends(career.id)).events
      .flatMap((event) => event.players)
      .find((candidate) => candidate.careerPlayerId === player.id)!;
    expect(publicPlayer.canNegotiate).toBe(false);
    expect(publicPlayer.currentTeam?.id).toBe(home.id);
  });

  it('lets AI sign on a pending response day, clears the obsolete user offer, and supports a later regular transfer', async () => {
    const career = await createCareer();
    const { entrants } = await reveal(career);
    const target = entrants[0];
    const ai = career.teams.find((team) => !team.isUserControlled)!;
    const created = await offer(career.id, target.careerPlayerId);
    await dataSource.getRepository(LegendEventPlayer).update(target.id, {
      aiDecisionDate: created.responseDate,
      interestedTeamIds: [ai.id],
    });
    const result = await advance(career.id);
    expect(result.currentDate).toBe(created.responseDate);
    expect(result.blockingEvents).toEqual([]);
    const news = result.processedEvents.find(
      (event) => event.type === CalendarEventType.LEGEND_SIGNING,
    )!;
    expect(news).toBeDefined();
    expect(news.requiresUserAction).toBe(false);
    expect(news.status).toBe(CalendarEventStatus.COMPLETED);
    const obsolete = await dataSource
      .getRepository(ContractOffer)
      .findOneByOrFail({ id: created.id });
    expect(obsolete.status).toBe(ContractOfferStatus.WITHDRAWN);
    const responseEvent = await dataSource
      .getRepository(CalendarEvent)
      .findOneByOrFail({ id: created.responseEventId! });
    expect(responseEvent.status).toBe(CalendarEventStatus.COMPLETED);
    expect(responseEvent.requiresUserAction).toBe(false);
    const contract = await dataSource
      .getRepository(PlayerContract)
      .findOneByOrFail({ careerPlayerId: target.careerPlayerId });
    expect(contract.careerTeamId).toBe(ai.id);
    expect(contract.status).toBe(PlayerContractStatus.ACTIVE);
    const roster = await dataSource
      .getRepository(Roster)
      .findOneByOrFail({ careerPlayerId: target.careerPlayerId });
    expect(roster.careerTeamId).toBe(ai.id);
    expect(roster.role).toBe(RosterRole.BENCH);
    const offers = json<ContractOffer[]>(
      await api()
        .get(`${base(career.id)}/contracts/offers`)
        .set(auth())
        .expect(200),
    );
    expect(offers.map((candidate) => candidate.id)).toEqual([created.id]);
    expect(
      await dataSource.getRepository(CalendarEvent).countBy({
        careerId: career.id,
        type: CalendarEventType.CONTRACT_EXPIRATION,
      }),
    ).toBe(1);
    const history = await dataSource
      .getRepository(TransferRecord)
      .findBy({ careerId: career.id, careerPlayerId: target.careerPlayerId });
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe(TransferRecordType.FREE_AGENT_SIGNING);
    await api()
      .post(`${base(career.id)}/contracts/offers/${created.id}/respond`)
      .set(auth())
      .send({ action: 'ACCEPT' })
      .expect(409);
    const agreement = json<{ id: number }>(
      await api()
        .post(`${base(career.id)}/transfers/agreements`)
        .set(auth())
        .send({ careerPlayerId: target.careerPlayerId, offeredFee: 500_000 })
        .expect(201),
    );
    const transfer = await offer(
      career.id,
      target.careerPlayerId,
      agreement.id,
    );
    expect(transfer.offerType).toBe(ContractOfferType.TRANSFER);
    await advance(career.id);
    await api()
      .post(`${base(career.id)}/contracts/offers/${transfer.id}/respond`)
      .set(auth())
      .send({ action: 'ACCEPT' })
      .expect(201);
    expect(
      (
        await dataSource
          .getRepository(CareerPlayer)
          .findOneByOrFail({ id: target.careerPlayerId })
      ).currentTeamId,
    ).toBe(career.teams.find((team) => team.isUserControlled)!.id);
    expect(
      await dataSource.getRepository(CalendarEvent).countBy({
        careerId: career.id,
        type: CalendarEventType.LEGEND_SIGNING,
      }),
    ).toBe(1);
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) {
        if (accountIds.length)
          await dataSource
            .getRepository(Account)
            .delete({ id: In(accountIds) });
        if (cardIds.length)
          await dataSource
            .getRepository(PlayerCard)
            .delete({ id: In(cardIds) });
        if (playerIds.length)
          await dataSource.getRepository(Player).delete({ id: In(playerIds) });
        if (themeIds.length)
          await dataSource.getRepository(Theme).delete({ id: In(themeIds) });
      }
    } finally {
      if (app) await app.close();
    }
  });
});
