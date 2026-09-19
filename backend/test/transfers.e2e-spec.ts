import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { configureApplication } from '../src/application.setup';
import { AppModule } from '../src/app.module';
import { Account } from '../src/auth/entities/account.entity';
import { addCalendarDays } from '../src/calendars/calendar-date';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { Career } from '../src/careers/entities/career.entity';
import { Roster } from '../src/careers/entities/roster.entity';
import { Region } from '../src/careers/enums/region.enum';
import { RosterRole } from '../src/careers/enums/roster-role.enum';
import {
  ContractExpectedRole,
  ContractOfferStatus,
  type ContractTerms,
} from '../src/contracts/contract.types';
import { ContractOffer } from '../src/contracts/entities/contract-offer.entity';
import { PlayerContract } from '../src/contracts/entities/player-contract.entity';
import { TransferAgreement } from '../src/transfers/entities/transfer-agreement.entity';
import { AiClubState } from '../src/ai-clubs/entities/ai-club-state.entity';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../src/event-queue/enums/calendar-event-type.enum';
import { LeagueFixture } from '../src/leagues/entities/league-fixture.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { Position } from '../src/players/enums/position.enum';
import {
  TransferAgreementStatus,
  TransferMarketAvailability,
  TransferRecordType,
} from '../src/transfers/transfer.types';

interface AuthResponse {
  accessToken: string;
  account: { id: number };
}

interface CareerPlayerResponse {
  id: number;
  currentTeamId: number | null;
  currentPosition: Position;
}

interface RosterResponse {
  id: number;
  role: RosterRole;
  starterPosition: Position | null;
  careerPlayer: CareerPlayerResponse;
}

interface CareerTeamResponse {
  id: number;
  code: string;
  isUserControlled: boolean;
  starters: RosterResponse[];
  benches: RosterResponse[];
}

interface CareerResponse {
  id: number;
  currentDate: string;
  teams: CareerTeamResponse[];
}

interface TransferMarketEntryResponse {
  careerPlayerId: number;
  currentTeamId: number | null;
  availability: TransferMarketAvailability;
  requiredFee: number;
  canNegotiate: boolean;
  blockedReason: string | null;
}

interface TransferAgreementResponse {
  id: number;
  careerId: number;
  careerPlayerId: number;
  buyerTeamId: number;
  sellerTeamId: number;
  offeredFee: number;
  requiredFee: number;
  status: TransferAgreementStatus;
}

interface TransferRecordResponse {
  id: number;
  careerId: number;
  careerPlayerId: number;
  type: TransferRecordType;
  fromTeamId: number | null;
  toTeamId: number | null;
  transferFee: number;
}

interface ContractOfferResponse {
  id: number;
  careerId: number;
  careerPlayerId: number;
  transferAgreementId: number | null;
  status: ContractOfferStatus;
  revision: number;
  responseDate: string;
  responseEventId: number;
}

interface CalendarAdvanceResponse {
  currentDate: string;
  canCloseTransferWindow: boolean;
  advancedDays: number;
  stopReason: string;
  processedEvents: Array<{
    id: number;
    type: CalendarEventType;
    status: CalendarEventStatus;
    requiresUserAction: boolean;
    payload: Record<string, unknown> | null;
  }>;
  blockingEvents: Array<{
    id: number;
    type: CalendarEventType;
    status: CalendarEventStatus;
    payload: Record<string, unknown> | null;
  }>;
}

describe('Transfer, free agency and contract expiration (e2e)', () => {
  jest.setTimeout(120_000);

  const fixtureKey = `transfers_${Date.now()}_${process.pid}`;
  const positions = Object.values(Position);
  const accountIds: number[] = [];
  const playerIds: number[] = [];
  const playerCardIds: number[] = [];
  const generousTerms: ContractTerms = {
    annualSalary: 10_000_000,
    years: 2,
    starterGuarantee: false,
    expectedRole: ContractExpectedRole.ROTATION,
    promises: [],
  };
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let themeId: number | undefined;

  const api = () => request(app.getHttpServer());
  const auth = (token = ownerToken) => ({ Authorization: `Bearer ${token}` });
  const transferBase = (careerId: number) => `/careers/${careerId}/transfers`;
  const contractsBase = (careerId: number) => `/careers/${careerId}/contracts`;

  function team(career: CareerResponse, code: string): CareerTeamResponse {
    const result = career.teams.find((candidate) => candidate.code === code);
    expect(result).toBeDefined();
    return result!;
  }

  function starter(
    careerTeam: CareerTeamResponse,
    position: Position,
  ): RosterResponse {
    const result = careerTeam.starters.find(
      (slot) => slot.starterPosition === position,
    );
    expect(result).toBeDefined();
    return result!;
  }

  async function getCareer(careerId: number): Promise<CareerResponse> {
    const result = await api()
      .get(`/careers/${careerId}`)
      .set(auth())
      .expect(200);
    return result.body as CareerResponse;
  }

  async function createCareer(homeBenchCount = 4): Promise<CareerResponse> {
    const result = await api()
      .post('/careers')
      .set(auth())
      .send({
        startYear: 2026,
        managedTeamCode: 'TRANSFER_HOME',
        teams: [
          {
            code: 'TRANSFER_HOME',
            name: 'Transfer Home',
            region: Region.LCK,
            starters: positions.map((position, index) => ({
              position,
              playerCardId: playerCardIds[index],
            })),
            benches: Array.from({ length: homeBenchCount }, (_, index) => ({
              playerCardId: playerCardIds[positions.length + index],
            })),
          },
          {
            code: 'TRANSFER_SELLER',
            name: 'Transfer Seller',
            region: Region.LCK,
            starters: positions.map((position, index) => ({
              position,
              playerCardId: playerCardIds[10 + index],
            })),
            // This natural TOP is promoted when the seller's TOP starter leaves.
            benches: [{ playerCardId: playerCardIds[15] }],
          },
        ],
      })
      .expect(201);
    const career = result.body as CareerResponse;
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-11-19' });
    return getCareer(career.id);
  }

  async function seedActiveContract(
    career: CareerResponse,
    careerTeamId: number,
    careerPlayerId: number,
    endDate = addCalendarDays(career.currentDate, 730),
  ): Promise<PlayerContract> {
    return dataSource.transaction(async (manager) => {
      const sourceOffer = manager.create(ContractOffer, {
        careerId: career.id,
        careerTeamId,
        careerPlayerId,
        status: ContractOfferStatus.SIGNED,
        revision: 1,
        offeredDate: career.currentDate,
        responseDate: career.currentDate,
        responseEventId: null,
        terms: structuredClone(generousTerms),
        counterTerms: null,
        response: {
          kind: 'ACCEPTED',
          reason: 'Initial E2E fixture contract',
          evaluatedDate: career.currentDate,
        },
        extensionsUsed: 0,
        history: [],
      });
      await manager.save(ContractOffer, sourceOffer);

      return manager.save(
        PlayerContract,
        manager.create(PlayerContract, {
          careerId: career.id,
          careerTeamId,
          careerPlayerId,
          sourceOfferId: sourceOffer.id,
          signedDate: career.currentDate,
          startDate: career.currentDate,
          endDate,
          terms: structuredClone(generousTerms),
          promises: [],
        }),
      );
    });
  }

  async function listMarket(
    careerId: number,
  ): Promise<TransferMarketEntryResponse[]> {
    const response = await api()
      .get(`${transferBase(careerId)}/market`)
      .set(auth())
      .expect(200);
    return response.body as TransferMarketEntryResponse[];
  }

  async function listAgreements(
    careerId: number,
  ): Promise<TransferAgreementResponse[]> {
    const response = await api()
      .get(`${transferBase(careerId)}/agreements`)
      .set(auth())
      .expect(200);
    return response.body as TransferAgreementResponse[];
  }

  async function listHistory(
    careerId: number,
  ): Promise<TransferRecordResponse[]> {
    const response = await api()
      .get(`${transferBase(careerId)}/history`)
      .set(auth())
      .expect(200);
    return response.body as TransferRecordResponse[];
  }

  async function createAcceptedAgreement(
    careerId: number,
    careerPlayerId: number,
  ): Promise<{
    rejected: TransferAgreementResponse;
    accepted: TransferAgreementResponse;
  }> {
    const rejectedResponse = await api()
      .post(`${transferBase(careerId)}/agreements`)
      .set(auth())
      .send({ careerPlayerId, offeredFee: 0 })
      .expect(201);
    const rejected = rejectedResponse.body as TransferAgreementResponse;
    expect(rejected).toEqual(
      expect.objectContaining({
        careerPlayerId,
        offeredFee: 0,
        status: TransferAgreementStatus.REJECTED,
      }),
    );
    expect(rejected.requiredFee).toBeGreaterThan(0);

    const acceptedResponse = await api()
      .post(`${transferBase(careerId)}/agreements`)
      .set(auth())
      .send({ careerPlayerId, offeredFee: rejected.requiredFee })
      .expect(201);
    const accepted = acceptedResponse.body as TransferAgreementResponse;
    expect(accepted).toEqual(
      expect.objectContaining({
        careerPlayerId,
        offeredFee: rejected.requiredFee,
        requiredFee: rejected.requiredFee,
        status: TransferAgreementStatus.ACCEPTED,
      }),
    );
    return { rejected, accepted };
  }

  async function createContractOffer(
    careerId: number,
    careerPlayerId: number,
    transferAgreementId?: number,
  ): Promise<ContractOfferResponse> {
    const response = await api()
      .post(`${contractsBase(careerId)}/offers`)
      .set(auth())
      .send({
        careerPlayerId,
        terms: generousTerms,
        ...(transferAgreementId === undefined ? {} : { transferAgreementId }),
      })
      .expect(201);
    const offer = response.body as ContractOfferResponse;
    expect(offer.status).toBe(ContractOfferStatus.WAITING_PLAYER_RESPONSE);
    expect(offer.transferAgreementId).toBe(transferAgreementId ?? null);
    return offer;
  }

  async function advanceToContractResponse(
    careerId: number,
    offer: ContractOfferResponse,
  ): Promise<void> {
    const before = (await getCareer(careerId)).currentDate;
    const result = await api()
      .post(`/careers/${careerId}/calendar/advance`)
      .set(auth())
      .send({ mode: 'NEXT_EVENT' })
      .expect(201);
    const calendar = result.body as CalendarAdvanceResponse;
    expect(calendar.currentDate).toBe(offer.responseDate);
    expect(calendar.stopReason).toBe('BLOCKING_EVENT');
    expect(calendar.advancedDays).toBeGreaterThanOrEqual(1);
    expect(calendar.advancedDays).toBeLessThanOrEqual(3);
    expect(Date.parse(calendar.currentDate)).toBeGreaterThan(
      Date.parse(before),
    );
    expect(calendar.blockingEvents).toContainEqual(
      expect.objectContaining({
        id: offer.responseEventId,
        type: CalendarEventType.CONTRACT_RESPONSE,
        status: CalendarEventStatus.READY,
        payload: expect.objectContaining({
          contractOfferId: offer.id,
          revision: offer.revision,
        }) as unknown,
      }),
    );
  }

  async function findContractOffer(
    careerId: number,
    offerId: number,
  ): Promise<ContractOfferResponse> {
    const response = await api()
      .get(`${contractsBase(careerId)}/offers`)
      .set(auth())
      .expect(200);
    const result = (response.body as ContractOfferResponse[]).find(
      (offer) => offer.id === offerId,
    );
    expect(result).toBeDefined();
    expect(result).toEqual(
      expect.objectContaining({
        player: expect.objectContaining({
          nickname: expect.any(String) as unknown,
          currentPosition: expect.any(String) as unknown,
          currentAge: expect.any(Number) as unknown,
        }) as unknown,
      }),
    );
    expect(result).not.toHaveProperty('careerPlayer');
    expect(JSON.stringify(result)).not.toContain('potential');
    return result!;
  }

  async function scheduleYearEndResponse(
    offer: ContractOfferResponse,
  ): Promise<void> {
    // Pin the randomized 1-3 day response delay to the boundary under test.
    await dataSource
      .getRepository(ContractOffer)
      .update(offer.id, { responseDate: '2026-12-31' });
    await dataSource
      .getRepository(CalendarEvent)
      .update(offer.responseEventId, { scheduledDate: '2026-12-31' });
  }

  async function createYearEndAcquisition(): Promise<{
    career: CareerResponse;
    offer: ContractOfferResponse;
  }> {
    const career = await createCareer();
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-12-30' });
    const freeAgent = team(career, 'TRANSFER_HOME').benches[0].careerPlayer;
    await api()
      .post(`${transferBase(career.id)}/players/${freeAgent.id}/release`)
      .set(auth())
      .expect(201);
    const offer = await createContractOffer(career.id, freeAgent.id);
    await scheduleYearEndResponse(offer);
    return { career, offer };
  }

  async function acceptContract(
    careerId: number,
    offerId: number,
    expectedStatus = 201,
  ) {
    return api()
      .post(`${contractsBase(careerId)}/offers/${offerId}/respond`)
      .set(auth())
      .send({ action: 'ACCEPT' })
      .expect(expectedStatus);
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
          password: 'transfers-e2e-password',
          displayName: `Transfer ${suffix}`,
        })
        .expect(201);
      const authResponse = result.body as AuthResponse;
      accountIds.push(authResponse.account.id);
      tokens.push(authResponse.accessToken);
    }
    [ownerToken, otherToken] = tokens;
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accountIds[0]]);

    const themeResponse = await api()
      .post('/themes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ code: fixtureKey.toUpperCase(), name: 'Transfer E2E Theme' })
      .expect(201);
    themeId = (themeResponse.body as { id: number }).id;

    for (let index = 0; index < 16; index += 1) {
      const playerResponse = await api()
        .post('/players')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ nickname: `${fixtureKey}_${index}`, nationality: 'KR' })
        .expect(201);
      const playerId = (playerResponse.body as { id: number }).id;
      playerIds.push(playerId);

      const naturalPosition =
        index === 15 ? Position.TOP : positions[index % positions.length];
      const cardResponse = await api()
        .post('/player-cards')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          playerId,
          themeId,
          cardYear: 2026,
          startingAge: 24,
          mainPosition: naturalPosition,
          mechanics: 80,
          gameSense: 80,
          laning: 80,
          teamFight: 80,
          macro: 80,
          teamPlay: 80,
          mental: 80,
          championPool: 80,
          personality: PlayerPersonality.PROFESSIONAL,
          potential: 85,
        })
        .expect(201);
      playerCardIds.push((cardResponse.body as { id: number }).id);
    }
  });

  it('sells an owned starter only after the buyer and player agree, promotes a replacement and records the fee once', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const buyer = team(career, 'TRANSFER_SELLER');
    const playerId = starter(home, Position.TOP).careerPlayer.id;
    const quote = await api()
      .get(`${transferBase(career.id)}/sale-candidates`)
      .set(auth())
      .expect(200);
    const candidates = quote.body as TransferMarketEntryResponse[];
    expect(candidates.every((item) => item.currentTeamId === home.id)).toBe(
      true,
    );
    const candidate = candidates.find(
      (item) => item.careerPlayerId === playerId,
    )!;
    expect(candidate.canNegotiate).toBe(true);
    const body = {
      careerPlayerId: playerId,
      buyerCareerTeamId: buyer.id,
      askingFee: candidate.requiredFee,
    };
    const responses = await Promise.all(
      [0, 1].map(() =>
        api()
          .post(`${contractsBase(career.id)}/sales`)
          .set(auth())
          .send(body),
      ),
    );
    expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
    const offer = responses.find((item) => item.status === 201)!
      .body as ContractOfferResponse;
    expect(
      starter(team(await getCareer(career.id), 'TRANSFER_HOME'), Position.TOP)
        .careerPlayer.id,
    ).toBe(playerId);
    await api()
      .post(`${contractsBase(career.id)}/offers`)
      .set(auth())
      .send({ careerPlayerId: playerId, terms: generousTerms })
      .expect(409);
    for (let day = 0; day < 3; day++) {
      if ((await getCareer(career.id)).currentDate >= offer.responseDate) break;
      await api()
        .post(`/careers/${career.id}/calendar/advance`)
        .set(auth())
        .send({ mode: 'ONE_DAY' })
        .expect(201);
    }
    const saved = await dataSource
      .getRepository(ContractOffer)
      .findOneByOrFail({ id: offer.id });
    expect(saved.status).toBe(ContractOfferStatus.SIGNED);
    const after = await getCareer(career.id);
    expect(
      starter(team(after, 'TRANSFER_HOME'), Position.TOP).careerPlayer.id,
    ).not.toBe(playerId);
    expect(team(after, 'TRANSFER_HOME').starters).toHaveLength(5);
    expect(
      team(after, 'TRANSFER_SELLER').benches.some(
        (item) => item.careerPlayer.id === playerId,
      ),
    ).toBe(true);
    const records = (await listHistory(career.id)).filter(
      (record) => record.careerPlayerId === playerId,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      fromTeamId: home.id,
      toTeamId: buyer.id,
      type: TransferRecordType.TRANSFER,
      transferFee: body.askingFee,
    });
    const state = await dataSource
      .getRepository(AiClubState)
      .findOneByOrFail({ careerTeamId: buyer.id });
    expect(state.transferSpent).toBe(body.askingFee);
    const sales = await api()
      .get(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .expect(200);
    expect(sales.body).toEqual([
      expect.objectContaining({
        id: offer.id,
        status: 'SIGNED',
        transferFee: body.askingFee,
      }),
    ]);
    await api()
      .post(`${contractsBase(career.id)}/sales/${offer.id}/cancel`)
      .set(auth())
      .expect(409);
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send(body)
      .expect(409);
  });

  it('cancels a sale without releasing the player or charging the AI club', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const buyer = team(career, 'TRANSFER_SELLER');
    const playerId = home.benches[0].careerPlayer.id;
    const result = await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send({
        careerPlayerId: playerId,
        buyerCareerTeamId: buyer.id,
        askingFee: 5000,
      })
      .expect(201);
    const offer = result.body as ContractOfferResponse;
    await api()
      .post(`${contractsBase(career.id)}/sales/${offer.id}/cancel`)
      .set(auth())
      .expect(201);
    const agreement = await dataSource
      .getRepository(TransferAgreement)
      .findOneByOrFail({ id: offer.transferAgreementId! });
    expect(agreement.status).toBe(TransferAgreementStatus.CANCELLED);
    expect(
      (
        await dataSource
          .getRepository(CalendarEvent)
          .findOneByOrFail({ id: offer.responseEventId })
      ).status,
    ).toBe(CalendarEventStatus.COMPLETED);
    await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    expect(
      (
        await dataSource
          .getRepository(CareerPlayer)
          .findOneByOrFail({ id: playerId })
      ).currentTeamId,
    ).toBe(home.id);
    expect(
      (await listHistory(career.id)).some(
        (record) => record.careerPlayerId === playerId,
      ),
    ).toBe(false);
    expect(
      (
        await dataSource
          .getRepository(AiClubState)
          .findOneByOrFail({ careerTeamId: buyer.id })
      ).transferSpent,
    ).toBe(0);
    await api()
      .post(`${contractsBase(career.id)}/offers`)
      .set(auth())
      .send({ careerPlayerId: playerId, terms: generousTerms })
      .expect(201);
  });

  it('protects sale ownership, validation, closed windows and starters without replacements', async () => {
    const career = await createCareer(0);
    const home = team(career, 'TRANSFER_HOME');
    const buyer = team(career, 'TRANSFER_SELLER');
    const playerId = home.starters[0].careerPlayer.id;
    const body = {
      careerPlayerId: playerId,
      buyerCareerTeamId: buyer.id,
      askingFee: 5000,
    };
    await api()
      .get(`${transferBase(career.id)}/sale-candidates`)
      .set(auth(otherToken))
      .expect(404);
    await api()
      .get(`${contractsBase(career.id)}/sales`)
      .set(auth(otherToken))
      .expect(404);
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth(otherToken))
      .send(body)
      .expect(404);
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send(body)
      .expect(409);
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send({ ...body, careerPlayerId: buyer.benches[0].careerPlayer.id })
      .expect(409);
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send({ ...body, buyerCareerTeamId: home.id })
      .expect(404);
    for (const askingFee of [0, 4999, 5000.5, 500001]) {
      await api()
        .post(`${contractsBase(career.id)}/sales`)
        .set(auth())
        .send({ ...body, askingFee })
        .expect(400);
    }
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send({ ...body, history: [{ action: 'USER_APPROVED_SALE' }] })
      .expect(400);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-11-18' });
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send(body)
      .expect(409);
    expect(
      await dataSource
        .getRepository(TransferAgreement)
        .countBy({ careerId: career.id }),
    ).toBe(0);
  });

  it('rolls a sale agreement back when the buyer has no salary budget and prevents excessive asking prices', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const buyer = team(career, 'TRANSFER_SELLER');
    const playerId = home.benches[0].careerPlayer.id;
    const body = {
      careerPlayerId: playerId,
      buyerCareerTeamId: buyer.id,
      askingFee: 500000,
    };
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send(body)
      .expect(409);
    await seedActiveContract(
      career,
      buyer.id,
      buyer.starters[0].careerPlayer.id,
    );
    await api()
      .post(`${contractsBase(career.id)}/sales`)
      .set(auth())
      .send({ ...body, askingFee: 5000 })
      .expect(409);
    expect(
      await dataSource
        .getRepository(TransferAgreement)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(ContractOffer)
        .countBy({ careerId: career.id, careerPlayerId: playerId }),
    ).toBe(0);
    expect(
      (
        await dataSource
          .getRepository(CareerPlayer)
          .findOneByOrFail({ id: playerId })
      ).currentTeamId,
    ).toBe(home.id);
  });

  it('separates contracted players and free agents and protects every transfer list by career ownership', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const seller = team(career, 'TRANSFER_SELLER');
    const target = starter(seller, Position.TOP).careerPlayer;
    const futureFreeAgent = home.benches[0].careerPlayer;
    await seedActiveContract(career, seller.id, target.id);

    for (const suffix of ['market', 'agreements', 'history']) {
      const url = `${transferBase(career.id)}/${suffix}`;
      await api().get(url).expect(401);
      await api().get(url).set(auth(otherToken)).expect(404);
    }
    await api()
      .post(`${transferBase(career.id)}/agreements`)
      .send({ careerPlayerId: target.id, offeredFee: 0 })
      .expect(401);
    await api()
      .post(`${transferBase(career.id)}/players/${futureFreeAgent.id}/release`)
      .set(auth(otherToken))
      .expect(404);

    const contracted = (await listMarket(career.id)).find(
      (entry) => entry.careerPlayerId === target.id,
    );
    expect(contracted).toEqual(
      expect.objectContaining({
        careerPlayerId: target.id,
        currentTeamId: seller.id,
        availability: TransferMarketAvailability.CONTRACTED,
      }),
    );
    expect(contracted!.requiredFee).toBeGreaterThan(0);

    await api()
      .post(`${transferBase(career.id)}/players/${futureFreeAgent.id}/release`)
      .set(auth())
      .expect(201);
    const freeAgent = (await listMarket(career.id)).find(
      (entry) => entry.careerPlayerId === futureFreeAgent.id,
    );
    expect(freeAgent).toEqual(
      expect.objectContaining({
        careerPlayerId: futureFreeAgent.id,
        currentTeamId: null,
        availability: TransferMarketAvailability.FREE_AGENT,
        requiredFee: 0,
      }),
    );
    expect(JSON.stringify(await listMarket(career.id))).not.toContain(
      'potential',
    );
    expect(JSON.stringify(await listHistory(career.id))).not.toContain(
      'potential',
    );
  });

  it('validates market requests and refuses roster-breaking starter moves', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const seller = team(career, 'TRANSFER_SELLER');

    await api()
      .get(`${transferBase(career.id)}/market?availability=UNKNOWN`)
      .set(auth())
      .expect(400);
    await api()
      .get(`${transferBase(career.id)}/market?position=COACH`)
      .set(auth())
      .expect(400);

    const sellerTop = starter(seller, Position.TOP).careerPlayer;
    for (const offeredFee of [-1, 1.5, 500_001, '10000']) {
      await api()
        .post(`${transferBase(career.id)}/agreements`)
        .set(auth())
        .send({ careerPlayerId: sellerTop.id, offeredFee })
        .expect(400);
    }

    await api()
      .post(`${transferBase(career.id)}/agreements`)
      .set(auth())
      .send({
        careerPlayerId: starter(home, Position.TOP).careerPlayer.id,
        offeredFee: 0,
      })
      .expect(400);
    await api()
      .post(`${transferBase(career.id)}/agreements`)
      .set(auth())
      .send({
        careerPlayerId: starter(seller, Position.JUNGLE).careerPlayer.id,
        offeredFee: 500_000,
      })
      .expect(409);

    const homeSupport = starter(home, Position.SUPPORT).careerPlayer;
    await api()
      .post(`${transferBase(career.id)}/players/${homeSupport.id}/release`)
      .set(auth())
      .expect(409);

    const homeTop = starter(home, Position.TOP).careerPlayer;
    const topReplacement = home.benches.find(
      (slot) => slot.careerPlayer.currentPosition === Position.TOP,
    )!.careerPlayer;
    await api()
      .post(`${transferBase(career.id)}/players/${homeTop.id}/release`)
      .set(auth())
      .expect(201);
    const afterRelease = team(await getCareer(career.id), 'TRANSFER_HOME');
    expect(starter(afterRelease, Position.TOP).careerPlayer.id).toBe(
      topReplacement.id,
    );
    expect(
      [...afterRelease.starters, ...afterRelease.benches].some(
        (slot) => slot.careerPlayer.id === homeTop.id,
      ),
    ).toBe(false);
  });

  it('rejects a low club fee and completes an accepted transfer through the delayed player contract response', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const seller = team(career, 'TRANSFER_SELLER');
    const target = starter(seller, Position.TOP).careerPlayer;
    const replacement = seller.benches[0].careerPlayer;
    await seedActiveContract(career, seller.id, target.id);

    const { rejected, accepted } = await createAcceptedAgreement(
      career.id,
      target.id,
    );
    expect(rejected.sellerTeamId).toBe(seller.id);
    expect(accepted.buyerTeamId).toBe(home.id);
    expect(await listAgreements(career.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: rejected.id,
          status: TransferAgreementStatus.REJECTED,
        }),
        expect.objectContaining({
          id: accepted.id,
          status: TransferAgreementStatus.ACCEPTED,
        }),
      ]),
    );

    const offer = await createContractOffer(career.id, target.id, accepted.id);
    await advanceToContractResponse(career.id, offer);
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.PLAYER_ACCEPTED,
    );
    await acceptContract(career.id, offer.id);

    const moved = await getCareer(career.id);
    const movedHome = team(moved, 'TRANSFER_HOME');
    const movedSeller = team(moved, 'TRANSFER_SELLER');
    expect(movedHome.benches).toHaveLength(5);
    expect(movedHome.benches).toContainEqual(
      expect.objectContaining({
        role: RosterRole.BENCH,
        starterPosition: null,
        careerPlayer: expect.objectContaining({
          id: target.id,
          currentTeamId: home.id,
        }) as unknown,
      }),
    );
    expect(
      [...movedSeller.starters, ...movedSeller.benches].some(
        (slot) => slot.careerPlayer.id === target.id,
      ),
    ).toBe(false);
    expect(starter(movedSeller, Position.TOP).careerPlayer.id).toBe(
      replacement.id,
    );

    const storedContract = await dataSource
      .getRepository(PlayerContract)
      .findOneByOrFail({ careerId: career.id, careerPlayerId: target.id });
    expect(storedContract.careerTeamId).toBe(home.id);
    expect(storedContract.sourceOfferId).toBe(offer.id);
    expect(await listAgreements(career.id)).toContainEqual(
      expect.objectContaining({
        id: accepted.id,
        status: TransferAgreementStatus.COMPLETED,
      }),
    );
    expect(await listHistory(career.id)).toContainEqual(
      expect.objectContaining({
        careerPlayerId: target.id,
        type: TransferRecordType.TRANSFER,
        fromTeamId: seller.id,
        toTeamId: home.id,
        transferFee: accepted.offeredFee,
      }),
    );
  });

  it('releases a user bench player to free agency and signs the player back as a bench free agent', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const releasedPlayer = home.benches[0].careerPlayer;

    await api()
      .post(`${transferBase(career.id)}/players/${releasedPlayer.id}/release`)
      .set(auth())
      .expect(201);
    let released = await dataSource
      .getRepository(CareerPlayer)
      .findOneByOrFail({ id: releasedPlayer.id, careerId: career.id });
    expect(released.currentTeamId).toBeNull();
    expect(
      await dataSource
        .getRepository(Roster)
        .countBy({ careerPlayerId: releasedPlayer.id }),
    ).toBe(0);
    expect(await listHistory(career.id)).toContainEqual(
      expect.objectContaining({
        careerPlayerId: releasedPlayer.id,
        type: TransferRecordType.RELEASE,
        fromTeamId: home.id,
        toTeamId: null,
      }),
    );
    expect(await listMarket(career.id)).toContainEqual(
      expect.objectContaining({
        careerPlayerId: releasedPlayer.id,
        availability: TransferMarketAvailability.FREE_AGENT,
        requiredFee: 0,
      }),
    );

    const offer = await createContractOffer(career.id, releasedPlayer.id);
    await advanceToContractResponse(career.id, offer);
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.PLAYER_ACCEPTED,
    );
    await acceptContract(career.id, offer.id);

    released = await dataSource
      .getRepository(CareerPlayer)
      .findOneByOrFail({ id: releasedPlayer.id, careerId: career.id });
    expect(released.currentTeamId).toBe(home.id);
    const roster = await dataSource
      .getRepository(Roster)
      .findOneByOrFail({ careerPlayerId: releasedPlayer.id });
    expect(roster).toEqual(
      expect.objectContaining({
        careerTeamId: home.id,
        role: RosterRole.BENCH,
        starterPosition: null,
        playerInstruction: null,
        championArchetype: null,
      }),
    );
    expect(await listHistory(career.id)).toContainEqual(
      expect.objectContaining({
        careerPlayerId: releasedPlayer.id,
        type: TransferRecordType.FREE_AGENT_SIGNING,
        fromTeamId: null,
        toTeamId: home.id,
        transferFee: 0,
      }),
    );
  });

  it('rolls a signing back when the managed bench already has five players', async () => {
    const career = await createCareer(5);
    const seller = team(career, 'TRANSFER_SELLER');
    const target = starter(seller, Position.TOP).careerPlayer;
    const replacement = seller.benches[0].careerPlayer;
    const originalContract = await seedActiveContract(
      career,
      seller.id,
      target.id,
    );
    const { accepted } = await createAcceptedAgreement(career.id, target.id);
    const offer = await createContractOffer(career.id, target.id, accepted.id);
    await advanceToContractResponse(career.id, offer);

    await acceptContract(career.id, offer.id, 409);

    const unchanged = await getCareer(career.id);
    const unchangedHome = team(unchanged, 'TRANSFER_HOME');
    const unchangedSeller = team(unchanged, 'TRANSFER_SELLER');
    expect(unchangedHome.benches).toHaveLength(5);
    expect(starter(unchangedSeller, Position.TOP).careerPlayer.id).toBe(
      target.id,
    );
    expect(unchangedSeller.benches[0].careerPlayer.id).toBe(replacement.id);
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.PLAYER_ACCEPTED,
    );
    expect(
      await dataSource
        .getRepository(CalendarEvent)
        .findOneByOrFail({ id: offer.responseEventId }),
    ).toEqual(expect.objectContaining({ status: CalendarEventStatus.READY }));
    expect(
      await dataSource
        .getRepository(PlayerContract)
        .findOneByOrFail({ careerPlayerId: target.id }),
    ).toEqual(
      expect.objectContaining({
        id: originalContract.id,
        careerTeamId: seller.id,
        sourceOfferId: originalContract.sourceOfferId,
      }),
    );
    expect(await listAgreements(career.id)).toContainEqual(
      expect.objectContaining({
        id: accepted.id,
        status: TransferAgreementStatus.ACCEPTED,
      }),
    );
    expect(
      (await listHistory(career.id)).filter(
        (record) =>
          record.careerPlayerId === target.id &&
          record.type === TransferRecordType.TRANSFER,
      ),
    ).toEqual([]);
  });

  it('cancels an accepted transfer agreement when the source contract expires', async () => {
    const career = await createCareer();
    const seller = team(career, 'TRANSFER_SELLER');
    const target = starter(seller, Position.TOP).careerPlayer;
    const contract = await seedActiveContract(
      career,
      seller.id,
      target.id,
      career.currentDate,
    );
    const { accepted } = await createAcceptedAgreement(career.id, target.id);
    const expirationDate = addCalendarDays(career.currentDate, 1);
    await dataSource.getRepository(CalendarEvent).save(
      dataSource.getRepository(CalendarEvent).create({
        careerId: career.id,
        scheduledDate: expirationDate,
        type: CalendarEventType.CONTRACT_EXPIRATION,
        status: CalendarEventStatus.SCHEDULED,
        requiresUserAction: false,
        payload: {
          playerContractId: contract.id,
          careerPlayerId: target.id,
          sourceOfferId: contract.sourceOfferId,
        },
        completedAt: null,
      }),
    );

    const advanceResponse = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    expect((advanceResponse.body as CalendarAdvanceResponse).currentDate).toBe(
      expirationDate,
    );

    expect(await listAgreements(career.id)).toContainEqual(
      expect.objectContaining({
        id: accepted.id,
        status: TransferAgreementStatus.CANCELLED,
      }),
    );
    expect(await listHistory(career.id)).toContainEqual(
      expect.objectContaining({
        careerPlayerId: target.id,
        type: TransferRecordType.CONTRACT_EXPIRATION,
        fromTeamId: seller.id,
        toTeamId: null,
      }),
    );
  });

  it('keeps a contract through its inclusive end date and expires it as a non-blocking event the next day', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const expiringPlayer = home.benches[0].careerPlayer;

    const offer = await createContractOffer(career.id, expiringPlayer.id);
    await advanceToContractResponse(career.id, offer);
    await acceptContract(career.id, offer.id);

    const signedCareer = await getCareer(career.id);
    const contractRepository = dataSource.getRepository(PlayerContract);
    const eventRepository = dataSource.getRepository(CalendarEvent);
    const contract = await contractRepository.findOneByOrFail({
      careerId: career.id,
      careerPlayerId: expiringPlayer.id,
    });
    const expirationEvent = await eventRepository.findOne({
      where: {
        careerId: career.id,
        type: CalendarEventType.CONTRACT_EXPIRATION,
      },
      order: { id: 'DESC' },
    });
    expect(expirationEvent).not.toBeNull();
    expect(expirationEvent!.payload).toEqual(
      expect.objectContaining({
        playerContractId: contract.id,
        careerPlayerId: expiringPlayer.id,
        sourceOfferId: offer.id,
      }),
    );

    const expirationDate = addCalendarDays(signedCareer.currentDate, 1);
    contract.endDate = signedCareer.currentDate;
    expirationEvent!.scheduledDate = expirationDate;
    expirationEvent!.status = CalendarEventStatus.SCHEDULED;
    expirationEvent!.requiresUserAction = false;
    expirationEvent!.completedAt = null;
    await contractRepository.save(contract);
    await eventRepository.save(expirationEvent!);

    // endDate is inclusive: the player remains registered on that date.
    expect(
      (await contractRepository.findOneByOrFail({
        id: contract.id,
      })) as unknown,
    ).toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .findOneByOrFail({ id: expiringPlayer.id }),
    ).toEqual(expect.objectContaining({ currentTeamId: home.id }));

    const advanceResponse = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    const advance = advanceResponse.body as CalendarAdvanceResponse;
    expect(advance.currentDate).toBe(expirationDate);
    expect(advance.advancedDays).toBe(1);
    expect(advance.blockingEvents).toEqual([]);
    expect(advance.processedEvents).toContainEqual(
      expect.objectContaining({
        id: expirationEvent!.id,
        type: CalendarEventType.CONTRACT_EXPIRATION,
        status: CalendarEventStatus.COMPLETED,
        requiresUserAction: false,
      }),
    );

    expect(
      (await contractRepository.findOneByOrFail({
        id: contract.id,
      })) as unknown,
    ).toEqual(expect.objectContaining({ status: 'EXPIRED' }));
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .findOneByOrFail({ id: expiringPlayer.id }),
    ).toEqual(expect.objectContaining({ currentTeamId: null }));
    expect(
      await dataSource
        .getRepository(Roster)
        .countBy({ careerPlayerId: expiringPlayer.id }),
    ).toBe(0);
    expect(await listHistory(career.id)).toContainEqual(
      expect.objectContaining({
        careerPlayerId: expiringPlayer.id,
        type: TransferRecordType.CONTRACT_EXPIRATION,
        fromTeamId: home.id,
        toTeamId: null,
        transferFee: 0,
      }),
    );
  });

  it('withdraws a postponed renewal when its contract expires before the decision date', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const target = home.benches[0].careerPlayer;
    const contract = await seedActiveContract(
      career,
      home.id,
      target.id,
      '2027-11-18',
    );
    const offer = await createContractOffer(career.id, target.id);
    await advanceToContractResponse(career.id, offer);
    const responseDate = (await getCareer(career.id)).currentDate;
    contract.endDate = responseDate;
    await dataSource.getRepository(PlayerContract).save(contract);
    const events = dataSource.getRepository(CalendarEvent);
    await events.save(
      events.create({
        careerId: career.id,
        scheduledDate: addCalendarDays(responseDate, 1),
        type: CalendarEventType.CONTRACT_EXPIRATION,
        status: CalendarEventStatus.SCHEDULED,
        requiresUserAction: false,
        payload: {
          playerContractId: contract.id,
          careerPlayerId: target.id,
          sourceOfferId: contract.sourceOfferId,
        },
        completedAt: null,
      }),
    );
    await api()
      .post(`${contractsBase(career.id)}/offers/${offer.id}/respond`)
      .set(auth())
      .send({ action: 'REQUEST_TIME' })
      .expect(201);

    const advanceResponse = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'THREE_DAYS' })
      .expect(201);
    const advance = advanceResponse.body as CalendarAdvanceResponse;
    expect(advance.currentDate).toBe(addCalendarDays(responseDate, 3));
    expect(advance.blockingEvents).toEqual([]);
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.WITHDRAWN,
    );
    expect(await events.findOneByOrFail({ id: offer.responseEventId })).toEqual(
      expect.objectContaining({
        status: CalendarEventStatus.COMPLETED,
        requiresUserAction: false,
      }),
    );
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .findOneByOrFail({ id: target.id }),
    ).toEqual(expect.objectContaining({ currentTeamId: null }));
    await acceptContract(career.id, offer.id, 409);
  });

  it('fills a vacant starter slot after expiration and FA re-signing', async () => {
    const career = await createCareer(0);
    const home = team(career, 'TRANSFER_HOME');
    const target = starter(home, Position.TOP).careerPlayer;
    const contract = await seedActiveContract(
      career,
      home.id,
      target.id,
      career.currentDate,
    );
    const events = dataSource.getRepository(CalendarEvent);
    await events.save(
      events.create({
        careerId: career.id,
        scheduledDate: addCalendarDays(career.currentDate, 1),
        type: CalendarEventType.CONTRACT_EXPIRATION,
        status: CalendarEventStatus.SCHEDULED,
        requiresUserAction: false,
        payload: {
          playerContractId: contract.id,
          careerPlayerId: target.id,
          sourceOfferId: contract.sourceOfferId,
        },
        completedAt: null,
      }),
    );
    await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    expect(
      team(await getCareer(career.id), 'TRANSFER_HOME').starters,
    ).toHaveLength(4);

    const offer = await createContractOffer(career.id, target.id);
    await advanceToContractResponse(career.id, offer);
    await acceptContract(career.id, offer.id);
    const result = await api()
      .patch(`/careers/${career.id}/teams/${home.id}/starters/TOP/swap`)
      .set(auth())
      .send({ benchCareerPlayerId: target.id })
      .expect(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        demotedBench: null,
        promotedStarter: expect.objectContaining({
          careerPlayerId: target.id,
          role: 'STARTER',
          starterPosition: 'TOP',
        }) as unknown,
      }),
    );
    const restored = team(await getCareer(career.id), 'TRANSFER_HOME');
    expect(restored.starters).toHaveLength(5);
    expect(restored.benches).toHaveLength(0);
    expect(starter(restored, Position.TOP).careerPlayer.id).toBe(target.id);
  });

  it('opens on November 19, gates acquisitions, and keeps renewals available', async () => {
    const career = await createCareer();
    const home = team(career, 'TRANSFER_HOME');
    const seller = team(career, 'TRANSFER_SELLER');
    const target = starter(seller, Position.TOP).careerPlayer;
    const freeAgent = home.benches[0].careerPlayer;
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-11-18' });
    const windowUrl = `${transferBase(career.id)}/window`;
    await api().get(windowUrl).expect(401);
    await api().get(windowUrl).set(auth(otherToken)).expect(404);
    const before = await api().get(windowUrl).set(auth()).expect(200);
    expect(before.body).toEqual(
      expect.objectContaining({
        isOpen: false,
        nextBoundaryDate: '2026-11-19',
      }),
    );
    const closedCandidate = (await listMarket(career.id)).find(
      (entry) => entry.careerPlayerId === target.id,
    );
    expect(closedCandidate).toEqual(
      expect.objectContaining({
        canNegotiate: false,
        blockedReason: '이적시장 개장 기간이 아닙니다.',
      }),
    );
    await api()
      .post(`${transferBase(career.id)}/agreements`)
      .set(auth())
      .send({ careerPlayerId: target.id, offeredFee: 500000 })
      .expect(409);
    await api()
      .post(`${transferBase(career.id)}/players/${freeAgent.id}/release`)
      .set(auth())
      .expect(201);
    await api()
      .post(`${contractsBase(career.id)}/offers`)
      .set(auth())
      .send({ careerPlayerId: freeAgent.id, terms: generousTerms })
      .expect(409);
    const renewal = await createContractOffer(
      career.id,
      starter(home, Position.MID).careerPlayer.id,
    );
    await api()
      .post(`${contractsBase(career.id)}/offers/${renewal.id}/respond`)
      .set(auth())
      .send({ action: 'WITHDRAW' })
      .expect(201);
    const advance = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'NEXT_EVENT' })
      .expect(201);
    expect(advance.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-11-19',
        transferWindow: expect.objectContaining({ isOpen: true }) as unknown,
      }),
    );
    await createAcceptedAgreement(career.id, target.id);
    await createContractOffer(career.id, freeAgent.id);
  });

  it('stops Fast Sim when the offseason market opens', async () => {
    const career = await createCareer();
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-11-18' });

    const result = await api()
      .post(`/careers/${career.id}/simulations/fast`)
      .set(auth())
      .send({ days: 90 })
      .expect(201);

    expect(result.body).toEqual(
      expect.objectContaining({
        previousDate: '2026-11-18',
        currentDate: '2026-11-19',
        stopReason: 'TRANSFER_WINDOW_BOUNDARY',
        calendar: expect.objectContaining({
          transferWindow: expect.objectContaining({ isOpen: true }) as unknown,
        }) as unknown,
      }),
    );
  });

  it('closes unfinished acquisition offers and agreements on January 1 without blocking', async () => {
    const career = await createCareer();
    const seller = team(career, 'TRANSFER_SELLER');
    const target = starter(seller, Position.TOP).careerPlayer;
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-12-27' });
    const { accepted } = await createAcceptedAgreement(career.id, target.id);
    const offer = await createContractOffer(career.id, target.id, accepted.id);
    await advanceToContractResponse(career.id, offer);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-12-31' });
    const beforeClose = await api()
      .get(`/careers/${career.id}/calendar`)
      .set(auth())
      .expect(200);
    expect(beforeClose.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-12-31',
        canCloseTransferWindow: true,
        dueMatches: [],
      }),
    );
    const advance = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'NEXT_EVENT' })
      .expect(201);
    expect(advance.body).toEqual(
      expect.objectContaining({
        currentDate: '2027-01-01',
        canCloseTransferWindow: false,
        blockingEvents: [],
      }),
    );
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.WITHDRAWN,
    );
    expect(await listAgreements(career.id)).toContainEqual(
      expect.objectContaining({
        id: accepted.id,
        status: TransferAgreementStatus.CANCELLED,
      }),
    );
    await acceptContract(career.id, offer.id, 409);
    expect(await listHistory(career.id)).toEqual([]);
    const event = await dataSource
      .getRepository(CalendarEvent)
      .findOneByOrFail({ id: offer.responseEventId });
    expect(event.status).toBe(CalendarEventStatus.COMPLETED);
    expect(event.requiresUserAction).toBe(false);
    await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    expect(
      team(await getCareer(career.id), 'TRANSFER_SELLER').starters,
    ).toHaveLength(5);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2027-11-19', currentYear: 2027 });
    await createAcceptedAgreement(career.id, target.id);
  });

  it('keeps a one-day Fast Sim on December 31 until another day is requested', async () => {
    const { career, offer } = await createYearEndAcquisition();
    const before = await api()
      .get(`/careers/${career.id}/calendar`)
      .set(auth())
      .expect(200);
    expect(before.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-12-30',
        canCloseTransferWindow: false,
      }),
    );

    const lastDay = await api()
      .post(`/careers/${career.id}/simulations/fast`)
      .set(auth())
      .send({ days: 1 })
      .expect(201);
    expect(lastDay.body).toEqual(
      expect.objectContaining({
        previousDate: '2026-12-30',
        currentDate: '2026-12-31',
        targetDate: '2026-12-31',
        advancedDays: 1,
        stopReason: 'BLOCKING_EVENT',
        calendar: expect.objectContaining({
          canCloseTransferWindow: true,
          blockingEvents: expect.arrayContaining([
            expect.objectContaining({
              id: offer.responseEventId,
              status: CalendarEventStatus.READY,
            }),
          ]) as unknown,
        }) as unknown,
      }),
    );
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.PLAYER_ACCEPTED,
    );

    const newYear = await api()
      .post(`/careers/${career.id}/simulations/fast`)
      .set(auth())
      .send({ days: 1 })
      .expect(201);
    expect(newYear.body).toEqual(
      expect.objectContaining({
        previousDate: '2026-12-31',
        currentDate: '2027-01-01',
        targetDate: '2027-01-01',
        advancedDays: 1,
        stopReason: 'TRANSFER_WINDOW_BOUNDARY',
        blockingEvents: [],
        calendar: expect.objectContaining({
          canCloseTransferWindow: false,
        }) as unknown,
      }),
    );
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.WITHDRAWN,
    );
  });

  it('does not skip a December 31 fixture or expire an acquisition before it is played', async () => {
    const { career, offer } = await createYearEndAcquisition();
    const lastDay = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    expect(lastDay.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-12-31',
        canCloseTransferWindow: true,
      }),
    );

    const splitResponse = await api()
      .post(`/careers/${career.id}/league-splits`)
      .set(auth())
      .send({ region: Region.LCK, splitNumber: 2 })
      .expect(201);
    const split = splitResponse.body as { fixtures: Array<{ id: number }> };
    expect(split.fixtures.length).toBeGreaterThan(0);
    const fixtureId = split.fixtures[0].id;
    // Move an API-created fixture onto the transfer deadline to cover collisions.
    await dataSource
      .getRepository(LeagueFixture)
      .update(fixtureId, { scheduledDate: '2026-12-31' });

    const calendar = await api()
      .get(`/careers/${career.id}/calendar`)
      .set(auth())
      .expect(200);
    expect(calendar.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-12-31',
        canCloseTransferWindow: false,
        dueMatches: expect.arrayContaining([
          expect.objectContaining({ id: fixtureId }),
        ]) as unknown,
      }),
    );

    for (const mode of ['ONE_DAY', 'NEXT_EVENT']) {
      const advance = await api()
        .post(`/careers/${career.id}/calendar/advance`)
        .set(auth())
        .send({ mode })
        .expect(201);
      expect(advance.body).toEqual(
        expect.objectContaining({
          currentDate: '2026-12-31',
          advancedDays: 0,
          canCloseTransferWindow: false,
        }),
      );
    }
    const fast = await api()
      .post(`/careers/${career.id}/simulations/fast`)
      .set(auth())
      .send({ days: 1 })
      .expect(201);
    expect(fast.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-12-31',
        advancedDays: 0,
        simulatedFixtures: [],
      }),
    );
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.PLAYER_ACCEPTED,
    );
    expect(
      await dataSource
        .getRepository(LeagueFixture)
        .findOneByOrFail({ id: fixtureId }),
    ).toEqual(expect.objectContaining({ seriesId: null }));
    expect(
      await dataSource
        .getRepository(CalendarEvent)
        .findOneByOrFail({ id: offer.responseEventId }),
    ).toEqual(expect.objectContaining({ status: CalendarEventStatus.READY }));
  });

  it('cannot close the window while a renewal and acquisition both require a response', async () => {
    const { career, offer } = await createYearEndAcquisition();
    const renewal = await createContractOffer(
      career.id,
      starter(team(career, 'TRANSFER_HOME'), Position.MID).careerPlayer.id,
    );
    await scheduleYearEndResponse(renewal);
    const lastDay = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    expect(lastDay.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-12-31',
        canCloseTransferWindow: false,
        blockingEvents: expect.arrayContaining([
          expect.objectContaining({ id: offer.responseEventId }),
          expect.objectContaining({ id: renewal.responseEventId }),
        ]) as unknown,
      }),
    );
    const before = await api()
      .get(`/careers/${career.id}/calendar`)
      .set(auth())
      .expect(200);
    expect(
      (before.body as CalendarAdvanceResponse).canCloseTransferWindow,
    ).toBe(false);
    const blocked = await api()
      .post(`/careers/${career.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(201);
    expect(blocked.body).toEqual(
      expect.objectContaining({
        currentDate: '2026-12-31',
        advancedDays: 0,
        canCloseTransferWindow: false,
        stopReason: 'BLOCKING_EVENT',
      }),
    );
    expect((await findContractOffer(career.id, offer.id)).status).toBe(
      ContractOfferStatus.PLAYER_ACCEPTED,
    );
    expect((await findContractOffer(career.id, renewal.id)).status).toBe(
      ContractOfferStatus.PLAYER_ACCEPTED,
    );

    await api()
      .post(`${contractsBase(career.id)}/offers/${renewal.id}/respond`)
      .set(auth())
      .send({ action: 'WITHDRAW' })
      .expect(201);
    const after = await api()
      .get(`/careers/${career.id}/calendar`)
      .set(auth())
      .expect(200);
    expect((after.body as CalendarAdvanceResponse).canCloseTransferWindow).toBe(
      true,
    );
  });

  it('allows a ready signing on December 31', async () => {
    const career = await createCareer();
    const target = starter(
      team(career, 'TRANSFER_SELLER'),
      Position.TOP,
    ).careerPlayer;
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-12-28' });
    const { accepted } = await createAcceptedAgreement(career.id, target.id);
    const offer = await createContractOffer(career.id, target.id, accepted.id);
    await advanceToContractResponse(career.id, offer);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-12-31' });
    await acceptContract(career.id, offer.id);
    expect(await listHistory(career.id)).toContainEqual(
      expect.objectContaining({
        careerPlayerId: target.id,
        type: TransferRecordType.TRANSFER,
      }),
    );
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) {
        if (accountIds.length) {
          await dataSource
            .getRepository(Account)
            .delete({ id: In(accountIds) });
        }
        if (playerCardIds.length) {
          await dataSource
            .getRepository(PlayerCard)
            .delete({ id: In(playerCardIds) });
        }
        if (playerIds.length) {
          await dataSource.getRepository(Player).delete({ id: In(playerIds) });
        }
        if (themeId !== undefined) {
          await dataSource.getRepository(Theme).delete({ id: themeId });
        }
      }
    } finally {
      if (app) await app.close();
    }
  });
});
