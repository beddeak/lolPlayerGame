import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import { Career } from '../src/careers/entities/career.entity';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { CareerTeam } from '../src/careers/entities/career-team.entity';
import { Roster } from '../src/careers/entities/roster.entity';
import { Region } from '../src/careers/enums/region.enum';
import { RosterRole } from '../src/careers/enums/roster-role.enum';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventType } from '../src/event-queue/enums/calendar-event-type.enum';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';
import {
  LeagueFixtureGameResponseDto,
  LeagueSplitResponseDto,
} from '../src/leagues/dto/league-split-response.dto';
import { LeagueFixtureStatus } from '../src/leagues/enums/league-fixture-status.enum';
import { LeagueFixture } from '../src/leagues/entities/league-fixture.entity';
import { LeagueStageStatus } from '../src/leagues/enums/league-stage-status.enum';
import { LegendSeason } from '../src/legends/entities/legend-season.entity';
import { ManagerCareerState } from '../src/manager-career/entities/manager-career-state.entity';
import { ManagerReview } from '../src/manager-career/entities/manager-review.entity';
import { ManagerCareerService } from '../src/manager-career/manager-career.service';
import { ManagerOverview } from '../src/manager-career/manager-overview';
import { ManagerJobOffer } from '../src/manager-career/entities/manager-job-offer.entity';
import { ManagerJobOffersResponse } from '../src/manager-career/manager-job-offers';
import { MatchSeriesResponseDto } from '../src/match-series/dto/match-series-response.dto';
import { MatchSeriesStatus } from '../src/match-series/enums/match-series-status.enum';
import { Match } from '../src/matches/entities/match.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { Position } from '../src/players/enums/position.enum';
import { TransferRecord } from '../src/transfers/entities/transfer-record.entity';
import { TransferAgreement } from '../src/transfers/entities/transfer-agreement.entity';
import { TransferAgreementStatus } from '../src/transfers/transfer.types';
import { ContractOffer } from '../src/contracts/entities/contract-offer.entity';
import {
  ContractExpectedRole,
  ContractOfferStatus,
  ContractOfferType,
} from '../src/contracts/contract.types';

interface AuthResult {
  accessToken: string;
  account: { id: number };
}
interface CareerResult {
  id: number;
  teams: Array<{ id: number; code: string; isUserControlled: boolean }>;
}
const json = <T>(response: { body: unknown }): T => response.body as T;

describe('manager approval, job security and career continuity (e2e)', () => {
  jest.setTimeout(180_000);
  const key = `manager_${Date.now()}_${process.pid}`;
  const positions = Object.values(Position);
  const accountIds: number[] = [];
  const playerIds: number[] = [];
  const cardIds: number[] = [];
  let themeId: number;
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  const api = () => request(app.getHttpServer());
  const auth = (token = ownerToken) => ({ Authorization: `Bearer ${token}` });
  const managedId = (career: CareerResult) =>
    career.teams.find((team) => team.isUserControlled)!.id;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
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
            password: 'manager-e2e-password',
            displayName: `Manager ${suffix}`,
          })
          .expect(201),
      );
      tokens.push(account.accessToken);
      accountIds.push(account.account.id);
    }
    [ownerToken, otherToken] = tokens;
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accountIds[0]]);
    themeId = json<{ id: number }>(
      await api()
        .post('/themes')
        .set(auth())
        .send({ code: key.toUpperCase(), name: 'Manager E2E catalog' })
        .expect(201),
    ).id;
    for (let index = 0; index < 21; index += 1) {
      const player = json<{ id: number }>(
        await api()
          .post('/players')
          .set(auth())
          .send({ nickname: `${key}_${index}`, nationality: 'KR' })
          .expect(201),
      );
      playerIds.push(player.id);
      const stat = index === 20 ? 60 : 80;
      const card = json<{ id: number }>(
        await api()
          .post('/player-cards')
          .set(auth())
          .send({
            playerId: player.id,
            themeId,
            cardYear: 2026,
            startingAge: 24,
            mainPosition: positions[index % 5],
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
    }
  });

  async function createCareer(date = '2026-11-01'): Promise<CareerResult> {
    const career = json<CareerResult>(
      await api()
        .post('/careers')
        .set(auth())
        .send({
          startYear: 2026,
          managedTeamCode: 'MANAGER_0',
          teams: [0, 1, 2, 3].map((clubIndex) => ({
            code: `MANAGER_${clubIndex}`,
            name: `Manager club ${clubIndex}`,
            region: Region.LCK,
            starters: positions.map((position, index) => ({
              position,
              playerCardId: cardIds[clubIndex * 5 + index],
            })),
            benches: clubIndex === 0 ? [{ playerCardId: cardIds[20] }] : [],
          })),
        })
        .expect(201),
    );
    await dataSource.getRepository(Career).update(career.id, {
      currentDate: date,
      currentYear: Number(date.slice(0, 4)),
    });
    // Disable unrelated probabilistic legend planning only in this owned test career.
    await dataSource.getRepository(LegendSeason).save({
      careerId: career.id,
      year: 2026,
      seed: 'b'.repeat(64),
      eventCount: 0,
      zeroEventStreak: 0,
    });
    return career;
  }

  async function locked<T>(
    careerId: number,
    action: (manager: EntityManager, career: Career) => Promise<T>,
  ): Promise<T> {
    return dataSource.transaction(async (manager) => {
      const career = await manager.findOneOrFail(Career, {
        where: { id: careerId },
        lock: { mode: 'pessimistic_write' },
      });
      return action(manager, career);
    });
  }
  async function overview(careerId: number): Promise<ManagerOverview> {
    return json<ManagerOverview>(
      await api().get(`/careers/${careerId}/manager`).set(auth()).expect(200),
    );
  }
  async function createSplit(
    careerId: number,
  ): Promise<LeagueSplitResponseDto> {
    return json<LeagueSplitResponseDto>(
      await api()
        .post(`/careers/${careerId}/league-splits`)
        .set(auth())
        .send({ region: Region.LCK, splitNumber: 2 })
        .expect(201),
    );
  }
  async function getSplit(
    careerId: number,
    splitId: number,
  ): Promise<LeagueSplitResponseDto> {
    return json<LeagueSplitResponseDto>(
      await api()
        .get(`/careers/${careerId}/league-splits/${splitId}`)
        .set(auth())
        .expect(200),
    );
  }
  async function game(
    careerId: number,
    splitId: number,
    fixtureId: number,
  ): Promise<LeagueFixtureGameResponseDto> {
    const fixture = await dataSource
      .getRepository(LeagueFixture)
      .findOneByOrFail({ id: fixtureId, leagueSplitId: splitId });
    const career = await dataSource
      .getRepository(Career)
      .findOneByOrFail({ id: careerId });
    if (career.currentDate < fixture.scheduledDate) {
      await dataSource
        .getRepository(Career)
        .update(careerId, { currentDate: fixture.scheduledDate });
    }
    const response = await api()
      .post(
        `/careers/${careerId}/league-splits/${splitId}/fixtures/${fixtureId}/games/simulate`,
      )
      .set(auth());
    if (response.status !== 201)
      throw new Error(
        `Fixture ${fixtureId} simulation returned ${response.status}: ${JSON.stringify(response.body)}`,
      );
    return json<LeagueFixtureGameResponseDto>(response);
  }
  function nextFixture(split: LeagueSplitResponseDto, teamId?: number) {
    const stage = split.stages.find(
      (item) => item.status === LeagueStageStatus.ACTIVE,
    )!;
    return stage.fixtures.find(
      (fixture) =>
        fixture.roundNumber === stage.currentRound &&
        fixture.status !== LeagueFixtureStatus.COMPLETED &&
        (teamId === undefined ||
          fixture.teamA.id === teamId ||
          fixture.teamB.id === teamId),
    )!;
  }
  async function completeFixture(
    careerId: number,
    splitId: number,
    fixtureId: number,
  ): Promise<LeagueFixtureGameResponseDto> {
    let result = await game(careerId, splitId, fixtureId);
    for (
      let count = 1;
      result.series.status !== MatchSeriesStatus.COMPLETED && count < 5;
      count += 1
    )
      result = await game(careerId, splitId, fixtureId);
    expect(result.series.status).toBe('COMPLETED');
    return result;
  }

  async function checkJobs(
    careerId: number,
  ): Promise<ManagerJobOffersResponse> {
    return json<ManagerJobOffersResponse>(
      await api()
        .post(`/careers/${careerId}/manager/job-offers/check`)
        .set(auth())
        .expect(201),
    );
  }

  it('keeps job reads private and read-only, offers only within the stove league, and never repeats a declined batch', async () => {
    const career = await createCareer('2026-11-18');
    const path = `/careers/${career.id}/manager/job-offers`;
    await api().get(path).expect(401);
    await api().get(path).set(auth(otherToken)).expect(404);
    await api().post(`${path}/check`).set(auth(otherToken)).expect(404);
    expect(
      json<ManagerJobOffersResponse>(
        await api().get(path).set(auth()).expect(200),
      ),
    ).toMatchObject({
      canCheckOffers: false,
      offers: [],
      window: { isOpen: false, opensAt: '2026-11-19', endsAt: '2026-12-31' },
    });
    expect(
      await dataSource
        .getRepository(ManagerCareerState)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    await api().post(`${path}/check`).set(auth()).expect(409);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-11-19' });
    const first = await checkJobs(career.id);
    expect(first.offers).toHaveLength(3);
    expect(
      first.offers.every(
        (offer) =>
          offer.toTeam.id !== managedId(career) &&
          offer.canRespond &&
          offer.reason.length > 0,
      ),
    ).toBe(true);
    expect((await overview(career.id)).pendingJobOfferCount).toBe(3);
    await api()
      .post(`${path}/${first.offers[0].id}/decline`)
      .set(auth(otherToken))
      .expect(404);
    await api()
      .post(`${path}/${first.offers[0].id}/decline`)
      .set(auth())
      .expect(201);
    await api()
      .post(`${path}/${first.offers[0].id}/accept`)
      .set(auth())
      .expect(409);
    await Promise.all([checkJobs(career.id), checkJobs(career.id)]);
    expect(
      await dataSource
        .getRepository(ManagerJobOffer)
        .countBy({ careerId: career.id }),
    ).toBe(3);
    expect(
      await dataSource.getRepository(CalendarEvent).countBy({
        careerId: career.id,
        type: CalendarEventType.AI_CLUB_UPDATE,
      }),
    ).toBe(3);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2027-01-01', currentYear: 2027 });
    const expired = json<ManagerJobOffersResponse>(
      await api().get(path).set(auth()).expect(200),
    );
    expect(
      expired.offers.filter((offer) => offer.status === 'EXPIRED'),
    ).toHaveLength(2);
    await api()
      .post(`${path}/${first.offers[1].id}/accept`)
      .set(auth())
      .expect(409);
    expect((await overview(career.id)).pendingJobOfferCount).toBe(0);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2027-11-19' });
    expect(
      (await checkJobs(career.id)).offers.filter(
        (offer) => offer.seasonYear === 2027,
      ),
    ).toHaveLength(3);
  });

  it('atomically accepts one competing job request, preserves the world, closes both clubs negotiations and blocks stale club controls', async () => {
    const career = await createCareer('2026-11-19');
    const first = await checkJobs(career.id);
    const sourceId = managedId(career);
    const targetId = first.offers[0].toTeam.id;
    const thirdId = first.offers[1].toTeam.id;
    const targetPlayer = await dataSource
      .getRepository(CareerPlayer)
      .findOneByOrFail({ careerId: career.id, currentTeamId: targetId });
    const agreement = await dataSource.getRepository(TransferAgreement).save({
      careerId: career.id,
      buyerCareerTeamId: thirdId,
      sellerCareerTeamId: targetId,
      careerPlayerId: targetPlayer.id,
      offeredFee: 100,
      requiredFee: 100,
      status: TransferAgreementStatus.ACCEPTED,
      offeredDate: '2026-11-19',
      resolvedDate: '2026-11-19',
      reason: 'Existing negotiations',
    });
    const offers: ContractOffer[] = [];
    const events: CalendarEvent[] = [];
    for (const clubId of [sourceId, targetId, thirdId]) {
      const event = await dataSource.getRepository(CalendarEvent).save({
        careerId: career.id,
        scheduledDate: '2026-11-19',
        type: CalendarEventType.CONTRACT_RESPONSE,
        status: CalendarEventStatus.READY,
        requiresUserAction: true,
        payload: null,
        completedAt: null,
      });
      const offer = await dataSource.getRepository(ContractOffer).save({
        careerId: career.id,
        careerTeamId: clubId,
        careerPlayerId: targetPlayer.id,
        sourceCareerTeamId: clubId === thirdId ? targetId : null,
        transferAgreementId: clubId === thirdId ? agreement.id : null,
        offerType:
          clubId === thirdId
            ? ContractOfferType.TRANSFER
            : ContractOfferType.FREE_AGENT,
        status: ContractOfferStatus.WAITING_PLAYER_RESPONSE,
        revision: 1,
        offeredDate: '2026-11-19',
        responseDate: '2026-11-20',
        responseEventId: event.id,
        terms: {
          annualSalary: 10000,
          years: 2,
          expectedRole: ContractExpectedRole.STARTER,
          starterGuarantee: false,
          promises: [],
        },
        counterTerms: null,
        response: null,
        extensionsUsed: 0,
        history: [],
      });
      offers.push(offer);
      events.push(event);
    }
    // Rejected renewals still await a user decision and otherwise strand the old club's inbox.
    await dataSource.getRepository(ContractOffer).update(offers[0].id, {
      status: ContractOfferStatus.REJECTED,
      offerType: ContractOfferType.RENEWAL,
    });
    const globalReveal = await dataSource.getRepository(CalendarEvent).save({
      careerId: career.id,
      scheduledDate: '2026-11-19',
      type: CalendarEventType.LEGEND_REVEAL,
      status: CalendarEventStatus.READY,
      requiresUserAction: true,
      payload: {},
      completedAt: null,
    });
    const playersBefore = await dataSource
      .getRepository(CareerPlayer)
      .find({ where: { careerId: career.id }, order: { id: 'ASC' } });
    const rosterBefore = await dataSource.getRepository(Roster).find({
      where: { careerTeam: { careerId: career.id } },
      order: { id: 'ASC' },
    });
    await dataSource.getRepository(ManagerCareerState).update(
      { careerId: career.id },
      {
        played: 8,
        wins: 5,
        expectedWins: 4.2,
        fanApproval: 78,
        boardConfidence: 80,
      },
    );
    const responses = await Promise.all(
      first.offers
        .slice(0, 2)
        .map((offer) =>
          api()
            .post(`/careers/${career.id}/manager/job-offers/${offer.id}/accept`)
            .set(auth()),
        ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const accepted = json<ManagerJobOffersResponse>(
      responses.find((response) => response.status === 201)!,
    ).offers.find((offer) => offer.status === 'ACCEPTED')!;
    const activeId = accepted.toTeam.id;
    expect(
      await dataSource
        .getRepository(CareerTeam)
        .countBy({ careerId: career.id, isUserControlled: true }),
    ).toBe(1);
    expect(
      (
        await dataSource
          .getRepository(CareerTeam)
          .findOneByOrFail({ careerId: career.id, isUserControlled: true })
      ).id,
    ).toBe(activeId);
    expect(await overview(career.id)).toMatchObject({
      careerTeamId: activeId,
      status: 'ACTIVE',
      record: { played: 0 },
      fanApproval: 65,
      boardConfidence: 65,
      pendingJobOfferCount: 0,
    });
    expect((await checkJobs(career.id)).offers).toHaveLength(3);
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .find({ where: { careerId: career.id }, order: { id: 'ASC' } }),
    ).toEqual(playersBefore);
    expect(
      await dataSource.getRepository(Roster).find({
        where: { careerTeam: { careerId: career.id } },
        order: { id: 'ASC' },
      }),
    ).toEqual(rosterBefore);
    const appointment = await dataSource
      .getRepository(ManagerReview)
      .findOneByOrFail({
        careerId: career.id,
        sourceKey: `APPOINTMENT:${activeId}:2026-11-19`,
      });
    expect(appointment.payload).toMatchObject({
      previousManagerState: { careerTeamId: sourceId, played: 8, wins: 5 },
    });
    for (let index = 0; index < offers.length; index++) {
      const involvesSwitchedTeam =
        [sourceId, activeId].includes(offers[index].careerTeamId) ||
        [sourceId, activeId].includes(offers[index].sourceCareerTeamId ?? -1);
      if (!involvesSwitchedTeam) continue;
      expect(
        (
          await dataSource
            .getRepository(ContractOffer)
            .findOneByOrFail({ id: offers[index].id })
        ).status,
      ).toBe(ContractOfferStatus.WITHDRAWN);
      expect(
        await dataSource
          .getRepository(CalendarEvent)
          .findOneByOrFail({ id: events[index].id }),
      ).toMatchObject({
        status: CalendarEventStatus.COMPLETED,
        requiresUserAction: false,
      });
    }
    if ([targetId, thirdId].includes(activeId))
      expect(
        (
          await dataSource
            .getRepository(TransferAgreement)
            .findOneByOrFail({ id: agreement.id })
        ).status,
      ).toBe(TransferAgreementStatus.CANCELLED);
    expect(
      await dataSource
        .getRepository(CalendarEvent)
        .findOneByOrFail({ id: globalReveal.id }),
    ).toMatchObject({
      status: CalendarEventStatus.READY,
      requiresUserAction: true,
    });
    await api()
      .patch(`/careers/${career.id}/teams/${sourceId}/strategy`)
      .set(auth())
      .send({ strategy: 'BALANCED' })
      .expect(404);
    await api()
      .patch(`/careers/${career.id}/teams/${sourceId}/starters/TOP/instruction`)
      .set(auth())
      .send({ instruction: 'WEAK_SIDE' })
      .expect(404);
    await api()
      .patch(`/careers/${career.id}/teams/${sourceId}/starters/TOP/archetype`)
      .set(auth())
      .send({ archetype: 'TOP_TANK' })
      .expect(404);
    await api()
      .patch(`/careers/${career.id}/teams/${activeId}/strategy`)
      .set(auth())
      .send({ strategy: 'BALANCED' })
      .expect(200);
  });

  it('blocks appointments during a series and baselines completed target-club fixtures without retroactive assessment', async () => {
    const career = await createCareer('2026-11-19');
    const offers = await checkJobs(career.id);
    const targetId = offers.offers[0].toTeam.id;
    const split = await createSplit(career.id);
    const fixture = nextFixture(split, targetId);
    await game(career.id, split.id, fixture.id);
    const path = `/careers/${career.id}/manager/job-offers/${offers.offers[0].id}/accept`;
    await api().post(path).set(auth()).expect(409);
    const completed = await completeFixture(career.id, split.id, fixture.id);
    const matchesBefore = await dataSource
      .getRepository(Match)
      .find({ where: { careerId: career.id }, order: { id: 'ASC' } });
    await api().post(path).set(auth()).expect(201);
    const service = app.get(ManagerCareerService);
    await locked(career.id, (manager, row) =>
      service.reviewLeague(manager, row, completed.split),
    );
    expect((await overview(career.id)).record.played).toBe(0);
    expect(
      await dataSource
        .getRepository(Match)
        .find({ where: { careerId: career.id }, order: { id: 'ASC' } }),
    ).toEqual(matchesBefore);
    expect(
      await dataSource
        .getRepository(ManagerReview)
        .countBy({ careerId: career.id, sourceKey: `SERIES:${fixture.id}` }),
    ).toBe(1);
  });

  it('allows dismissed managers to accept during the stove league without enabling out-of-season calendar progression', async () => {
    const career = await createCareer('2026-11-19');
    await locked(career.id, (manager, row) =>
      app.get(ManagerCareerService).initialize(manager, row),
    );
    await dataSource
      .getRepository(ManagerCareerState)
      .update(
        { careerId: career.id },
        { status: 'DISMISSED', dismissedDate: '2026-11-19' },
      );
    const jobs = await checkJobs(career.id);
    await api()
      .post(
        `/careers/${career.id}/manager/job-offers/${jobs.offers[0].id}/accept`,
      )
      .set(auth())
      .expect(201);
    expect(await overview(career.id)).toMatchObject({
      status: 'ACTIVE',
      canManage: true,
      dismissedDate: null,
    });
    const frozen = await createCareer('2026-07-01');
    await locked(frozen.id, (manager, row) =>
      app.get(ManagerCareerService).initialize(manager, row),
    );
    await dataSource
      .getRepository(ManagerCareerState)
      .update(
        { careerId: frozen.id },
        { status: 'DISMISSED', dismissedDate: '2026-07-01' },
      );
    await api()
      .post(`/careers/${frozen.id}/manager/job-offers/check`)
      .set(auth())
      .expect(409);
    await api()
      .post(`/careers/${frozen.id}/calendar/advance`)
      .set(auth())
      .send({ mode: 'ONE_DAY' })
      .expect(409);
  });

  it('keeps GET read-only and private, and does not grade standalone games or series', async () => {
    const career = await createCareer();
    const before = await overview(career.id);
    expect(before).toMatchObject({
      status: 'ACTIVE',
      fanApproval: 65,
      boardConfidence: 65,
      canManage: true,
      trackingStartedDate: null,
      record: { played: 0 },
    });
    await api().get(`/careers/${career.id}/manager`).expect(401);
    await api()
      .get(`/careers/${career.id}/manager`)
      .set(auth(otherToken))
      .expect(404);
    await overview(career.id);
    expect(
      await dataSource
        .getRepository(ManagerCareerState)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(ManagerReview)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    expect(JSON.stringify(before)).not.toMatch(/potential|seed|strengths/);
    const body = {
      careerId: career.id,
      teamAId: career.teams[0].id,
      teamBId: career.teams[1].id,
      seed: 12345,
    };
    await api().post('/matches/simulate').set(auth()).send(body).expect(201);
    let standalone = json<MatchSeriesResponseDto>(
      await api()
        .post('/match-series')
        .set(auth())
        .send({ ...body, bestOf: 3 })
        .expect(201),
    );
    for (
      let index = 0;
      standalone.status !== MatchSeriesStatus.COMPLETED && index < 3;
      index += 1
    )
      standalone = json<MatchSeriesResponseDto>(
        await api()
          .post(`/match-series/${standalone.seriesId}/games/simulate`)
          .set(auth())
          .expect(201),
      );
    expect(standalone.status).toBe('COMPLETED');
    expect((await overview(career.id)).record.played).toBe(0);
    expect(
      await dataSource
        .getRepository(ManagerReview)
        .countBy({ careerId: career.id, type: 'SERIES' }),
    ).toBe(0);
  });

  it('grades a completed official series once, not each set, and freezes its split expectation', async () => {
    const career = await createCareer();
    const split = await createSplit(career.id);
    await locked(career.id, (manager, row) =>
      app.get(ManagerCareerService).prepareLeague(manager, row, split.id),
    );
    const original = await dataSource
      .getRepository(ManagerReview)
      .findOneByOrFail({
        careerId: career.id,
        sourceKey: `EXPECTATION:${split.id}`,
      });
    const fixture = nextFixture(split, managedId(career));
    const first = await game(career.id, split.id, fixture.id);
    expect(first.series.games).toHaveLength(1);
    expect((await overview(career.id)).record.played).toBe(0);
    const careerPlayers = await dataSource
      .getRepository(CareerPlayer)
      .findBy({ careerId: career.id, currentTeamId: managedId(career) });
    await dataSource
      .getRepository(CareerPlayer)
      .update(
        { id: In(careerPlayers.map((player) => player.id)) },
        { currentMechanics: 20, currentLaning: 20 },
      );
    const completed = await completeFixture(career.id, split.id, fixture.id);
    const graded = await overview(career.id);
    expect(graded.record.played).toBe(1);
    expect(graded.record.expectedWins).toBeCloseTo(0.5);
    const stable = await dataSource
      .getRepository(ManagerReview)
      .findOneByOrFail({ id: original.id });
    expect(stable.payload).toEqual(original.payload);
    const matchCount = await dataSource
      .getRepository(Match)
      .countBy({ careerId: career.id });
    await Promise.all([
      game(career.id, split.id, fixture.id),
      game(career.id, split.id, fixture.id),
    ]);
    const retried = await overview(career.id);
    expect(retried).toEqual(graded);
    expect(
      await dataSource
        .getRepository(ManagerReview)
        .countBy({ careerId: career.id, sourceKey: `SERIES:${fixture.id}` }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(Match).countBy({ careerId: career.id }),
    ).toBe(matchCount);
    expect(completed.series.winnerTeamId).not.toBeNull();
  });

  it('adopts existing saved results as a baseline without retroactive penalties', async () => {
    const career = await createCareer();
    const split = await createSplit(career.id);
    const fixture = nextFixture(split, managedId(career));
    await completeFixture(career.id, split.id, fixture.id);
    // Simulate a pre-PHASE25 save: only remove records owned by this test career.
    await dataSource
      .getRepository(ManagerReview)
      .delete({ careerId: career.id });
    await dataSource
      .getRepository(ManagerCareerState)
      .delete({ careerId: career.id });
    expect((await overview(career.id)).trackingStartedDate).toBeNull();
    expect(
      await dataSource
        .getRepository(ManagerCareerState)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    await locked(career.id, (manager, row) =>
      app.get(ManagerCareerService).initialize(manager, row),
    );
    const current = await getSplit(career.id, split.id);
    await locked(career.id, (manager, row) =>
      app.get(ManagerCareerService).reviewLeague(manager, row, current),
    );
    const state = await overview(career.id);
    expect(state).toMatchObject({
      status: 'ACTIVE',
      fanApproval: 65,
      boardConfidence: 65,
      record: { played: 0, wins: 0, expectedWins: 0 },
    });
    expect(
      await dataSource
        .getRepository(ManagerReview)
        .findOneBy({ careerId: career.id, sourceKey: `SERIES:${fixture.id}` }),
    ).toMatchObject({ type: 'BASELINE', fanDelta: 0, boardDelta: 0 });
  });

  it('warns at six actual accumulated losses, grants three series, then rejects every manager write while keeping reads', async () => {
    const career = await createCareer();
    let split = await createSplit(career.id);
    const homeId = managedId(career);
    await locked(career.id, (manager, row) =>
      app.get(ManagerCareerService).prepareLeague(manager, row, split.id),
    );
    const state = await dataSource
      .getRepository(ManagerCareerState)
      .findOneByOrFail({ careerId: career.id });
    // Five earlier official losses form the starting fixture. Four more are real API series.
    await dataSource.getRepository(ManagerCareerState).update(state.id, {
      played: 5,
      wins: 0,
      expectedWins: 2.5,
      losingStreak: 5,
      winningStreak: 0,
      fanApproval: 39,
      boardConfidence: 49.5,
    });
    for (const team of career.teams) {
      const stat = team.isUserControlled ? 1 : 100;
      await dataSource.getRepository(CareerPlayer).update(
        { careerId: career.id, currentTeamId: team.id },
        {
          currentMechanics: stat,
          currentGameSense: stat,
          currentLaning: stat,
          currentTeamFight: stat,
          currentMacro: stat,
          currentTeamPlay: stat,
          currentMental: stat,
          currentChampionPool: stat,
        },
      );
    }
    // A separate unfinished series proves the direct low-level endpoints are guarded too.
    const standalone = json<MatchSeriesResponseDto>(
      await api()
        .post('/match-series')
        .set(auth())
        .send({
          careerId: career.id,
          teamAId: homeId,
          teamBId: career.teams[1].id,
          seed: 98765,
          bestOf: 3,
        })
        .expect(201),
    );
    let lastFixtureId = 0;
    for (let count = 0; count < 20; count += 1) {
      const fixture = nextFixture(split);
      const result = await completeFixture(career.id, split.id, fixture.id);
      split = result.split;
      if (fixture.teamA.id !== homeId && fixture.teamB.id !== homeId) continue;
      lastFixtureId = fixture.id;
      expect(result.series.winnerTeamId).not.toBe(homeId);
      const current = await overview(career.id);
      if (current.record.played === 6)
        expect(current).toMatchObject({
          status: 'WARNING',
          warning: { issuedAtPlayed: 6, minimumAdditionalSeries: 3 },
        });
      if ([7, 8].includes(current.record.played))
        expect(current.status).toBe('WARNING');
      if (current.record.played === 9) {
        expect(current).toMatchObject({
          status: 'DISMISSED',
          canManage: false,
        });
        break;
      }
    }
    const dismissed = await overview(career.id);
    expect(dismissed.record.played).toBe(9);
    expect(dismissed.status).toBe('DISMISSED');
    expect(
      await dataSource.getRepository(CalendarEvent).countBy({
        careerId: career.id,
        type: CalendarEventType.JOB_SECURITY_WARNING,
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(CalendarEvent).countBy({
        careerId: career.id,
        type: CalendarEventType.MANAGER_DISMISSED,
      }),
    ).toBe(1);
    const roster = await dataSource
      .getRepository(Roster)
      .find({ where: { careerTeamId: homeId }, order: { id: 'ASC' } });
    const starter = roster.find((row) => row.role === RosterRole.STARTER)!;
    const bench = roster.find((row) => row.role === RosterRole.BENCH)!;
    const mutationTargets: Array<{
      method: 'post' | 'patch';
      path: string;
      body?: object;
    }> = [
      {
        method: 'post',
        path: `/careers/${career.id}/calendar/advance`,
        body: { mode: 'ONE_DAY' },
      },
      { method: 'post', path: `/careers/${career.id}/calendar/start-season` },
      {
        method: 'post',
        path: `/careers/${career.id}/league-splits`,
        body: { region: 'LCK', splitNumber: 1 },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/league-splits/${split.id}/fixtures/${lastFixtureId}/games/simulate`,
      },
      {
        method: 'post',
        path: `/careers/${career.id}/simulations/quick`,
        body: { leagueSplitId: split.id, fixtureId: lastFixtureId },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/simulations/fast`,
        body: { days: 1, maxFixtures: 1 },
      },
      {
        method: 'post',
        path: '/matches/simulate',
        body: {
          careerId: career.id,
          teamAId: homeId,
          teamBId: career.teams[1].id,
          seed: 777,
        },
      },
      {
        method: 'post',
        path: '/match-series',
        body: {
          careerId: career.id,
          teamAId: homeId,
          teamBId: career.teams[1].id,
          seed: 778,
        },
      },
      {
        method: 'post',
        path: `/match-series/${standalone.seriesId}/games/simulate`,
      },
      {
        method: 'post',
        path: `/match-series/${standalone.seriesId}/feedback`,
        body: { type: 'TEAM', option: 'PRAISE_TEAM' },
      },
      {
        method: 'patch',
        path: `/careers/${career.id}/meta`,
        body: { meta: 'BALANCED' },
      },
      {
        method: 'patch',
        path: `/careers/${career.id}/teams/${homeId}/strategy`,
        body: { strategy: 'BALANCED' },
      },
      {
        method: 'patch',
        path: `/careers/${career.id}/teams/${homeId}/starters/TOP/instruction`,
        body: { instruction: 'WEAK_SIDE' },
      },
      {
        method: 'patch',
        path: `/careers/${career.id}/teams/${homeId}/starters/TOP/archetype`,
        body: { archetype: 'TOP_TANK' },
      },
      {
        method: 'patch',
        path: `/careers/${career.id}/teams/${homeId}/starters/TOP/swap`,
        body: { benchCareerPlayerId: bench.careerPlayerId },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/training-periods/current/team`,
        body: { type: 'CHEMISTRY' },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/training-periods/current/individual`,
        body: { type: 'LANING', careerPlayerId: starter.careerPlayerId },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/contracts/offers`,
        body: {
          careerPlayerId: starter.careerPlayerId,
          terms: {
            annualSalary: 200_000,
            years: 2,
            starterGuarantee: true,
            expectedRole: 'CORE',
            promises: [],
          },
        },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/contracts/offers/999999/respond`,
        body: { action: 'WITHDRAW' },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/transfers/agreements`,
        body: { careerPlayerId: starter.careerPlayerId, offeredFee: 100_000 },
      },
      {
        method: 'post',
        path: `/careers/${career.id}/transfers/players/${starter.careerPlayerId}/release`,
      },
    ];
    const dismissalEvent = await dataSource
      .getRepository(CalendarEvent)
      .findOneByOrFail({
        careerId: career.id,
        type: CalendarEventType.MANAGER_DISMISSED,
      });
    mutationTargets.push({
      method: 'post',
      path: `/careers/${career.id}/events/${dismissalEvent.id}/resolve`,
    });
    const beforeMatches = await dataSource
      .getRepository(Match)
      .countBy({ careerId: career.id });
    for (const target of mutationTargets) {
      const response = await api()
        [target.method](target.path)
        .set(auth())
        .send(target.body ?? {});
      expect({ path: target.path, status: response.status }).toEqual({
        path: target.path,
        status: 409,
      });
      expect((response.body as { message?: string }).message).toContain(
        '경질된 감독',
      );
    }
    await api().get(`/careers/${career.id}`).set(auth()).expect(200);
    await api().get(`/careers/${career.id}/calendar`).set(auth()).expect(200);
    await api()
      .get(`/match-series/${standalone.seriesId}`)
      .set(auth())
      .expect(200);
    await api()
      .get(`/careers/${career.id}/manager`)
      .set(auth(otherToken))
      .expect(404);
    expect(await overview(career.id)).toEqual(dismissed);
    expect(
      await dataSource.getRepository(Match).countBy({ careerId: career.id }),
    ).toBe(beforeMatches);
    expect(
      await dataSource
        .getRepository(Roster)
        .find({ where: { careerTeamId: homeId }, order: { id: 'ASC' } }),
    ).toEqual(roster);
  });

  it('preserves ratings, current warning and cumulative records across the new year exactly once', async () => {
    const career = await createCareer('2026-12-31');
    await locked(career.id, (manager, row) =>
      app.get(ManagerCareerService).initialize(manager, row),
    );
    await dataSource.getRepository(ManagerCareerState).update(
      { careerId: career.id },
      {
        fanApproval: 30,
        boardConfidence: 40,
        played: 6,
        wins: 0,
        expectedWins: 3,
        losingStreak: 6,
        status: 'WARNING',
        warningAtPlayed: 6,
        warnedDate: '2026-12-31',
      },
    );
    const before = await overview(career.id);
    const service = app.get(ManagerCareerService);
    await locked(career.id, (manager, row) =>
      service.processDay(manager, row, '2027-01-01'),
    );
    await locked(career.id, (manager, row) =>
      service.processDay(manager, row, '2027-01-01'),
    );
    const after = await overview(career.id);
    expect(after).toMatchObject({
      status: before.status,
      fanApproval: before.fanApproval,
      boardConfidence: before.boardConfidence,
      record: before.record,
      warning: before.warning,
      reviewYear: 2027,
    });
    expect(
      await dataSource
        .getRepository(ManagerReview)
        .countBy({ careerId: career.id, sourceKey: 'SEASON:2027' }),
    ).toBe(1);
  });

  it('stores actual release lineup snapshots and reviews each transfer only once', async () => {
    const career = await createCareer('2026-11-19');
    const roster = await dataSource.getRepository(Roster).findOneByOrFail({
      careerTeamId: managedId(career),
      role: RosterRole.STARTER,
      starterPosition: Position.TOP,
    });
    await api()
      .post(
        `/careers/${career.id}/transfers/players/${roster.careerPlayerId}/release`,
      )
      .set(auth())
      .expect(201);
    const transfer = await dataSource
      .getRepository(TransferRecord)
      .findOneByOrFail({
        careerId: career.id,
        careerPlayerId: roster.careerPlayerId,
      });
    expect(transfer).toMatchObject({
      managerLineupBefore: 80,
      managerLineupAfter: 76,
    });
    const service = app.get(ManagerCareerService);
    await locked(career.id, (manager, row) =>
      service.processDay(manager, row, row.currentDate),
    );
    const first = await overview(career.id);
    expect(first.fanApproval).toBeCloseTo(64.2);
    expect(first.boardConfidence).toBeCloseTo(64.4);
    await locked(career.id, (manager, row) =>
      service.processDay(manager, row, row.currentDate),
    );
    expect(await overview(career.id)).toEqual(first);
    expect(
      await dataSource.getRepository(ManagerReview).countBy({
        careerId: career.id,
        sourceKey: `TRANSFER:${transfer.id}`,
      }),
    ).toBe(1);
  });

  it('deletes only the owned save and cascades its data without deleting catalog or other saves', async () => {
    const target = await createCareer('2026-11-23');
    const preserved = await createCareer('2026-11-23');
    await overview(target.id);
    await checkJobs(target.id);
    const split = await createSplit(target.id);
    await game(target.id, split.id, nextFixture(split, managedId(target)).id);
    expect(
      await dataSource.getRepository(Match).countBy({ careerId: target.id }),
    ).toBeGreaterThan(0);
    await api().delete(`/careers/${target.id}`).expect(401);
    await api()
      .delete(`/careers/${target.id}`)
      .set(auth(otherToken))
      .expect(404);
    expect(
      await dataSource.getRepository(Career).existsBy({ id: target.id }),
    ).toBe(true);
    const response = await api()
      .delete(`/careers/${target.id}`)
      .set(auth())
      .expect(200);
    expect(response.body).toEqual({ id: target.id, deleted: true });
    await api().get(`/careers/${target.id}`).set(auth()).expect(404);
    await api().delete(`/careers/${target.id}`).set(auth()).expect(404);
    for (const entity of [
      CareerPlayer,
      CareerTeam,
      CalendarEvent,
      LegendSeason,
      ManagerCareerState,
      ManagerReview,
      ManagerJobOffer,
      Match,
    ]) {
      expect(
        await dataSource
          .getRepository(dataSource.getMetadata(entity).tableName)
          .countBy({ careerId: target.id }),
      ).toBe(0);
    }
    expect(
      await dataSource
        .getRepository(Roster)
        .countBy({ careerTeamId: In(target.teams.map((team) => team.id)) }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(Career).existsBy({ id: preserved.id }),
    ).toBe(true);
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .countBy({ careerId: preserved.id }),
    ).toBeGreaterThan(0);
    expect(
      await dataSource.getRepository(PlayerCard).countBy({ id: In(cardIds) }),
    ).toBe(cardIds.length);
    expect(
      await dataSource.getRepository(Account).existsBy({ id: accountIds[0] }),
    ).toBe(true);
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
        if (themeId) await dataSource.getRepository(Theme).delete(themeId);
      }
    } finally {
      if (app) await app.close();
    }
  });
});
