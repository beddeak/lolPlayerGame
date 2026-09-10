import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { configureApplication } from '../src/application.setup';
import { AppModule } from '../src/app.module';
import { Account } from '../src/auth/entities/account.entity';
import { addCalendarDays } from '../src/calendars/calendar-date';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
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
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../src/event-queue/enums/calendar-event-type.enum';
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
    return result.body as CareerResponse;
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
    return result!;
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

    const themeResponse = await api()
      .post('/themes')
      .send({ code: fixtureKey.toUpperCase(), name: 'Transfer E2E Theme' })
      .expect(201);
    themeId = (themeResponse.body as { id: number }).id;

    for (let index = 0; index < 16; index += 1) {
      const playerResponse = await api()
        .post('/players')
        .send({ nickname: `${fixtureKey}_${index}`, nationality: 'KR' })
        .expect(201);
      const playerId = (playerResponse.body as { id: number }).id;
      playerIds.push(playerId);

      const naturalPosition =
        index === 15 ? Position.TOP : positions[index % positions.length];
      const cardResponse = await api()
        .post('/player-cards')
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
