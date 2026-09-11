import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { configureApplication } from '../src/application.setup';
import { AppModule } from '../src/app.module';
import { Account } from '../src/auth/entities/account.entity';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { Region } from '../src/careers/enums/region.enum';
import {
  ContractExpectedRole,
  ContractPromiseType,
  ContractTerms,
} from '../src/contracts/contract.types';
import { PlayerContract } from '../src/contracts/entities/player-contract.entity';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { Position } from '../src/players/enums/position.enum';

interface AuthResponse {
  accessToken: string;
  account: { id: number };
}

interface CareerResponse {
  id: number;
  currentDate: string;
  teams: Array<{
    id: number;
    code: string;
    starters: Array<{ careerPlayer: { id: number } }>;
  }>;
}

interface OfferResponse {
  id: number;
  careerId: number;
  careerPlayerId: number;
  status: string;
  revision: number;
  offeredDate: string;
  responseDate: string;
  responseEventId: number;
  extensionsUsed: number;
  terms: ContractTerms;
  counterTerms: ContractTerms | null;
  response: { kind: string; reason: string; evaluatedDate: string } | null;
}

interface CalendarResponse {
  currentDate: string;
  advancedDays: number;
  stopReason: string;
  blockingEvents: Array<{
    id: number;
    status: string;
    scheduledDate: string;
    payload: { contractOfferId: number; revision: number };
  }>;
}

describe('Contract negotiations through the career calendar (e2e)', () => {
  jest.setTimeout(120_000);

  const fixtureKey = `contracts_${Date.now()}_${process.pid}`;
  const accountIds: number[] = [];
  const playerIds: number[] = [];
  const cardIds: number[] = [];
  const positions = Object.values(Position);
  const generousTerms: ContractTerms = {
    annualSalary: 10_000_000,
    years: 2,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.CORE,
    promises: [
      { type: ContractPromiseType.STARTER_GUARANTEE },
      { type: ContractPromiseType.CARRY_ROLE },
      { type: ContractPromiseType.STRENGTHEN_TEAM },
      { type: ContractPromiseType.SIGN_POSITION, position: Position.JUNGLE },
    ],
  };
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let themeId: number | undefined;
  let token: string;
  let otherToken: string;
  let career: CareerResponse;
  let playerId: number;

  const api = () => request(app.getHttpServer());
  const contractsUrl = () => `/careers/${career.id}/contracts`;
  const offersUrl = () => `${contractsUrl()}/offers`;
  const responseUrl = (offerId: number) => `${offersUrl()}/${offerId}/respond`;

  async function makeCareer(): Promise<CareerResponse> {
    const result = await api()
      .post('/careers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startYear: 2026,
        managedTeamCode: 'CONTRACT_HOME',
        teams: ['HOME', 'AWAY'].map((suffix, teamIndex) => ({
          code: `CONTRACT_${suffix}`,
          name: `Contract ${suffix}`,
          region: Region.LEC,
          starters: positions.map((position, positionIndex) => ({
            position,
            playerCardId: cardIds[teamIndex * positions.length + positionIndex],
          })),
        })),
      })
      .expect(201);
    return result.body as CareerResponse;
  }

  async function createOffer(
    terms: ContractTerms = generousTerms,
  ): Promise<OfferResponse> {
    const result = await api()
      .post(offersUrl())
      .set('Authorization', `Bearer ${token}`)
      .send({ careerPlayerId: playerId, terms })
      .expect(201);
    return result.body as OfferResponse;
  }

  async function findOffer(offerId: number): Promise<OfferResponse> {
    const result = await api()
      .get(offersUrl())
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const offer = (result.body as OfferResponse[]).find(
      (value) => value.id === offerId,
    );
    expect(offer).toBeDefined();
    return offer!;
  }

  async function decide(
    offerId: number,
    action: string,
    terms?: ContractTerms,
  ): Promise<OfferResponse> {
    const result = await api()
      .post(responseUrl(offerId))
      .set('Authorization', `Bearer ${token}`)
      .send({ action, ...(terms === undefined ? {} : { terms }) })
      .expect(201);
    return result.body as OfferResponse;
  }

  async function advanceToResponse(
    offer: OfferResponse,
    expectedDays?: number,
  ): Promise<CalendarResponse> {
    const result = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'NEXT_EVENT' })
      .expect(201);
    const calendar = result.body as CalendarResponse;
    expect(calendar.currentDate).toBe(offer.responseDate);
    expect(calendar.stopReason).toBe('BLOCKING_EVENT');
    expect(calendar.blockingEvents).toEqual([
      expect.objectContaining({
        id: offer.responseEventId,
        status: 'READY',
        payload: expect.objectContaining({
          contractOfferId: offer.id,
          revision: offer.revision,
        }) as unknown,
      }),
    ]);
    if (expectedDays === undefined) {
      expect(calendar.advancedDays).toBeGreaterThanOrEqual(1);
      expect(calendar.advancedDays).toBeLessThanOrEqual(3);
    } else {
      expect(calendar.advancedDays).toBe(expectedDays);
    }
    return calendar;
  }

  async function expectNoBlocker(): Promise<void> {
    const result = await api()
      .get(`/careers/${career.id}/calendar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((result.body as CalendarResponse).blockingEvents).toEqual([]);
  }

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
      const result = await api()
        .post('/auth/register')
        .send({
          email: `${fixtureKey}_${suffix}@example.com`,
          password: 'contracts-e2e-password',
          displayName: `Contract ${suffix}`,
        })
        .expect(201);
      const auth = result.body as AuthResponse;
      accountIds.push(auth.account.id);
      tokens.push(auth.accessToken);
    }
    [token, otherToken] = tokens;
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accountIds[0]]);

    const themeResponse = await api()
      .post('/themes')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: fixtureKey.toUpperCase(), name: 'Contract E2E Theme' })
      .expect(201);
    themeId = (themeResponse.body as { id: number }).id;

    for (let index = 0; index < positions.length * 2; index += 1) {
      const playerResponse = await api()
        .post('/players')
        .set('Authorization', `Bearer ${token}`)
        .send({ nickname: `${fixtureKey}_${index}`, nationality: 'KR' })
        .expect(201);
      const id = (playerResponse.body as { id: number }).id;
      playerIds.push(id);
      const cardResponse = await api()
        .post('/player-cards')
        .set('Authorization', `Bearer ${token}`)
        .send({
          playerId: id,
          themeId,
          cardYear: 2026,
          startingAge: 20,
          mainPosition: positions[index % positions.length],
          mechanics: 70,
          gameSense: 70,
          laning: 70,
          teamFight: 70,
          macro: 70,
          teamPlay: 70,
          mental: 70,
          championPool: 70,
          personality: PlayerPersonality.PROFESSIONAL,
          potential: 80,
        })
        .expect(201);
      cardIds.push((cardResponse.body as { id: number }).id);
    }
  });

  beforeEach(async () => {
    career = await makeCareer();
    const managedTeam = career.teams.find(
      (team) => team.code === 'CONTRACT_HOME',
    )!;
    playerId = managedTeam.starters[0].careerPlayer.id;
    // Fixture relationship setup; negotiations themselves use only HTTP APIs.
    await dataSource
      .getRepository(CareerPlayer)
      .update(
        { careerId: career.id, currentTeamId: managedTeam.id },
        { coachTrust: 100 },
      );
  });

  it('validates nested terms and enforces authentication, career and team ownership', async () => {
    const opponent = career.teams.find((team) => team.code === 'CONTRACT_AWAY')!
      .starters[0].careerPlayer.id;
    for (const url of [contractsUrl(), offersUrl()]) {
      await api().get(url).expect(401);
      await api()
        .get(url)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    }
    await api()
      .post(offersUrl())
      .send({ careerPlayerId: playerId, terms: generousTerms })
      .expect(401);
    await api()
      .post(offersUrl())
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ careerPlayerId: playerId, terms: generousTerms })
      .expect(404);
    await api()
      .post(offersUrl())
      .set('Authorization', `Bearer ${token}`)
      .send({ careerPlayerId: opponent, terms: generousTerms })
      .expect(409);
    const anotherCareer = await makeCareer();
    await api()
      .post(offersUrl())
      .set('Authorization', `Bearer ${token}`)
      .send({
        careerPlayerId: anotherCareer.teams[0].starters[0].careerPlayer.id,
        terms: generousTerms,
      })
      .expect(404);

    const invalidTerms: unknown[] = [
      null,
      [],
      { ...generousTerms, annualSalary: 0 },
      { ...generousTerms, annualSalary: 10_000_001 },
      { ...generousTerms, annualSalary: 1.5 },
      { ...generousTerms, annualSalary: '100000' },
      { ...generousTerms, years: 0 },
      { ...generousTerms, years: 6 },
      { ...generousTerms, starterGuarantee: 'true' },
      { ...generousTerms, expectedRole: 'CAPTAIN' },
      { ...generousTerms, expectedRole: ContractExpectedRole.PROSPECT },
      { ...generousTerms, starterGuarantee: false },
      { ...generousTerms, expectedRole: ContractExpectedRole.STARTER },
      { ...generousTerms, promises: [{ type: 'UNKNOWN' }] },
      {
        ...generousTerms,
        promises: [{ type: ContractPromiseType.SIGN_POSITION }],
      },
      {
        ...generousTerms,
        promises: [
          { type: ContractPromiseType.STRENGTHEN_TEAM, position: Position.MID },
        ],
      },
      {
        ...generousTerms,
        promises: [
          { type: ContractPromiseType.STRENGTHEN_TEAM },
          { type: ContractPromiseType.STRENGTHEN_TEAM },
        ],
      },
    ];
    for (const terms of invalidTerms) {
      await api()
        .post(offersUrl())
        .set('Authorization', `Bearer ${token}`)
        .send({ careerPlayerId: playerId, terms })
        .expect(400);
    }
    await api()
      .get(offersUrl())
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect([]);
    const offer = await createOffer();
    await api()
      .post(responseUrl(offer.id))
      .send({ action: 'ACCEPT' })
      .expect(401);
    await api()
      .post(responseUrl(offer.id))
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ action: 'WITHDRAW' })
      .expect(404);
    await api()
      .post(`/careers/${anotherCareer.id}/contracts/offers/${offer.id}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'WITHDRAW' })
      .expect(404);
    for (const body of [
      { action: 'UNKNOWN' },
      { action: 'COUNTER' },
      { action: 'COUNTER', terms: null },
      { action: 'COUNTER', terms: { ...generousTerms, years: 6 } },
      { action: 'KEEP', terms: generousTerms },
    ]) {
      await api()
        .post(responseUrl(offer.id))
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);
    }
  });

  it('allows only one concurrent offer and can withdraw a pending response', async () => {
    const results = await Promise.all(
      [0, 1].map(() =>
        api()
          .post(offersUrl())
          .set('Authorization', `Bearer ${token}`)
          .send({ careerPlayerId: playerId, terms: generousTerms }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const offer = results.find((result) => result.status === 201)!
      .body as OfferResponse;
    expect(offer.status).toBe('WAITING_PLAYER_RESPONSE');
    expect(offer.response).toBeNull();
    expect(offer.revision).toBe(1);
    expect((await findOffer(offer.id)).responseDate).toBe(offer.responseDate);
    const delayDays =
      (Date.parse(offer.responseDate) - Date.parse(career.currentDate)) /
      86_400_000;
    expect(delayDays).toBeGreaterThanOrEqual(1);
    expect(delayDays).toBeLessThanOrEqual(3);

    for (const action of ['ACCEPT', 'KEEP', 'COUNTER', 'REQUEST_TIME']) {
      await api()
        .post(responseUrl(offer.id))
        .set('Authorization', `Bearer ${token}`)
        .send({
          action,
          ...(action === 'COUNTER' ? { terms: generousTerms } : {}),
        })
        .expect(409);
    }
    expect((await findOffer(offer.id)).status).toBe('WAITING_PLAYER_RESPONSE');
    expect((await decide(offer.id, 'WITHDRAW')).status).toBe('WITHDRAWN');
    const event = await dataSource
      .getRepository(CalendarEvent)
      .findOneByOrFail({ id: offer.responseEventId });
    expect(event.status).toBe('COMPLETED');
    await expectNoBlocker();
    const advance = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'THREE_DAYS' })
      .expect(201);
    expect((advance.body as CalendarResponse).advancedDays).toBe(3);
    expect((advance.body as CalendarResponse).blockingEvents).toEqual([]);
    expect((await createOffer()).id).not.toBe(offer.id);
  });

  it('signs accepted terms once, persists dates and promises, and preserves signed history on renewal', async () => {
    const offer = await createOffer();
    await api()
      .get(contractsUrl())
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect([]);
    const calendar = await advanceToResponse(offer);
    const ready = await findOffer(offer.id);
    expect(ready.status).toBe('PLAYER_ACCEPTED');
    expect(ready.response).toEqual({
      kind: 'ACCEPTED',
      reason: expect.any(String) as unknown,
      evaluatedDate: calendar.currentDate,
    });
    await api()
      .post(`/careers/${career.id}/events/${offer.responseEventId}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    const stillBlocked = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'THREE_DAYS' })
      .expect(201);
    expect((stillBlocked.body as CalendarResponse).advancedDays).toBe(0);

    const signatures = await Promise.all(
      [0, 1].map(() =>
        api()
          .post(responseUrl(offer.id))
          .set('Authorization', `Bearer ${token}`)
          .send({ action: 'ACCEPT' }),
      ),
    );
    expect(signatures.map((result) => result.status).sort()).toEqual([
      201, 409,
    ]);
    const signedOffer = await findOffer(offer.id);
    expect(signedOffer.status).toBe('SIGNED');
    const stored = await dataSource
      .getRepository(PlayerContract)
      .findOneByOrFail({ careerId: career.id, careerPlayerId: playerId });
    expect(stored.terms).toEqual(generousTerms);
    expect(stored.sourceOfferId).toBe(offer.id);
    expect(stored.startDate).toBe(calendar.currentDate);
    expect(stored.signedDate).toBe(calendar.currentDate);
    const finalDay = new Date(`${calendar.currentDate}T00:00:00Z`);
    finalDay.setUTCFullYear(2028);
    finalDay.setUTCDate(finalDay.getUTCDate() - 1);
    expect(stored.endDate).toBe(finalDay.toISOString().slice(0, 10));
    expect(stored.promises).toEqual(
      generousTerms.promises.map((promise) => ({
        ...promise,
        status: 'PENDING',
      })),
    );
    await expectNoBlocker();

    const renewalTerms = { ...generousTerms, years: 3 };
    const renewal = await createOffer(renewalTerms);
    await advanceToResponse(renewal);
    await decide(renewal.id, 'ACCEPT');
    const contractsResponse = await api()
      .get(contractsUrl())
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(contractsResponse.body).toEqual([
      expect.objectContaining({
        id: stored.id,
        careerPlayerId: playerId,
        sourceOfferId: renewal.id,
        terms: renewalTerms,
      }),
    ]);
    expect(
      await dataSource
        .getRepository(PlayerContract)
        .countBy({ careerPlayerId: playerId }),
    ).toBe(1);
    expect(await findOffer(offer.id)).toEqual(signedOffer);
    await api()
      .post(responseUrl(offer.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'COUNTER', terms: renewalTerms })
      .expect(409);
  });

  it('accepts a player counteroffer at its returned salary instead of the original low salary', async () => {
    const offer = await createOffer({ ...generousTerms, annualSalary: 1 });
    await advanceToResponse(offer);
    const response = await findOffer(offer.id);
    expect(response.status).toBe('COUNTER_OFFERED');
    expect(response.counterTerms).not.toBeNull();
    expect(response.counterTerms!.annualSalary).toBeGreaterThan(1);
    await decide(offer.id, 'ACCEPT');
    const contract = await dataSource
      .getRepository(PlayerContract)
      .findOneByOrFail({ careerPlayerId: playerId });
    expect(contract.terms).toEqual(response.counterTerms);
    await expectNoBlocker();
  });

  it('reschedules counter and keep decisions, postpones once, and prevents early or stale actions', async () => {
    const initial = await createOffer({ ...generousTerms, annualSalary: 1 });
    await advanceToResponse(initial);
    expect((await findOffer(initial.id)).status).toBe('COUNTER_OFFERED');
    const counter = await decide(initial.id, 'COUNTER', generousTerms);
    expect(counter.status).toBe('WAITING_PLAYER_RESPONSE');
    expect(counter.revision).toBe(initial.revision + 1);
    expect(counter.responseEventId).not.toBe(initial.responseEventId);
    expect(counter.terms).toEqual(generousTerms);
    expect(counter.counterTerms).toBeNull();
    expect(counter.response).toBeNull();
    const oldEvent = await dataSource
      .getRepository(CalendarEvent)
      .findOneByOrFail({ id: initial.responseEventId });
    expect(oldEvent.status).toBe('COMPLETED');
    await expectNoBlocker();
    await advanceToResponse(counter);
    const accepted = await findOffer(initial.id);
    expect(accepted.status).toBe('PLAYER_ACCEPTED');
    const postponed = await decide(initial.id, 'REQUEST_TIME');
    expect(postponed.status).toBe('PLAYER_ACCEPTED');
    expect(postponed.response).toEqual(accepted.response);
    expect(postponed.extensionsUsed).toBe(1);
    expect(postponed.revision).toBe(counter.revision);
    expect(postponed.responseEventId).toBe(counter.responseEventId);
    await expectNoBlocker();
    for (const action of ['ACCEPT', 'KEEP', 'REQUEST_TIME']) {
      await api()
        .post(responseUrl(initial.id))
        .set('Authorization', `Bearer ${token}`)
        .send({ action })
        .expect(409);
    }
    await advanceToResponse(postponed, 2);
    expect((await findOffer(initial.id)).response).toEqual(accepted.response);
    await api()
      .post(responseUrl(initial.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'REQUEST_TIME' })
      .expect(409);
    const kept = await decide(initial.id, 'KEEP');
    expect(kept.revision).toBe(counter.revision + 1);
    expect(kept.terms).toEqual(generousTerms);
    expect(kept.extensionsUsed).toBe(1);
    expect(kept.responseEventId).not.toBe(counter.responseEventId);
    await api()
      .post(responseUrl(initial.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'ACCEPT' })
      .expect(409);
    await advanceToResponse(kept);
    await api()
      .post(responseUrl(initial.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'REQUEST_TIME' })
      .expect(409);
    await decide(initial.id, 'WITHDRAW');
    await expectNoBlocker();
    expect(
      await dataSource
        .getRepository(PlayerContract)
        .countBy({ careerPlayerId: playerId }),
    ).toBe(0);
  });

  it('keeps a low-trust rejection blocking until the coach withdraws or revises', async () => {
    await dataSource
      .getRepository(CareerPlayer)
      .update(playerId, { coachTrust: 0 });
    const offer = await createOffer();
    await advanceToResponse(offer);
    expect((await findOffer(offer.id)).status).toBe('REJECTED');
    for (const action of ['ACCEPT', 'KEEP', 'REQUEST_TIME']) {
      await api()
        .post(responseUrl(offer.id))
        .set('Authorization', `Bearer ${token}`)
        .send({ action })
        .expect(409);
    }
    await api()
      .post(offersUrl())
      .set('Authorization', `Bearer ${token}`)
      .send({ careerPlayerId: playerId, terms: generousTerms })
      .expect(409);
    await decide(offer.id, 'WITHDRAW');
    await expectNoBlocker();
    await api()
      .post(responseUrl(offer.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'ACCEPT' })
      .expect(409);
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) {
        // Deleting only these accounts cascades their careers and negotiations.
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
        if (themeId !== undefined)
          await dataSource.getRepository(Theme).delete({ id: themeId });
      }
    } finally {
      if (app) await app.close();
    }
  });
});
