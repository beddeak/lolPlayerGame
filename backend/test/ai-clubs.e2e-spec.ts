import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import {
  AiClubBudgetService,
  estimateAiAnnualSalary,
} from '../src/ai-clubs/ai-club-budget.service';
import { AiClubsService } from '../src/ai-clubs/ai-clubs.service';
import { AI_CLUB_CONFIG } from '../src/ai-clubs/config/ai-club.config';
import { AiClubState } from '../src/ai-clubs/entities/ai-club-state.entity';
import { Account } from '../src/auth/entities/account.entity';
import { addCalendarDays } from '../src/calendars/calendar-date';
import { Career } from '../src/careers/entities/career.entity';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { CareerTeam } from '../src/careers/entities/career-team.entity';
import { Roster } from '../src/careers/entities/roster.entity';
import { Region } from '../src/careers/enums/region.enum';
import { RosterRole } from '../src/careers/enums/roster-role.enum';
import { ContractsService } from '../src/contracts/contracts.service';
import {
  ContractExpectedRole,
  ContractOfferStatus,
  ContractOfferType,
  ContractPromiseType,
  PlayerContractStatus,
  type ContractTerms,
} from '../src/contracts/contract.types';
import { ContractOffer } from '../src/contracts/entities/contract-offer.entity';
import { PlayerContract } from '../src/contracts/entities/player-contract.entity';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../src/event-queue/enums/calendar-event-type.enum';
import { EventQueueService } from '../src/event-queue/event-queue.service';
import { LegendEvent } from '../src/legends/entities/legend-event.entity';
import { LegendEventPlayer } from '../src/legends/entities/legend-event-player.entity';
import { LegendSeason } from '../src/legends/entities/legend-season.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { Position } from '../src/players/enums/position.enum';
import { TransferAgreement } from '../src/transfers/entities/transfer-agreement.entity';
import { TransferRecord } from '../src/transfers/entities/transfer-record.entity';
import {
  TransferAgreementStatus,
  TransferRecordType,
} from '../src/transfers/transfer.types';

interface AuthResult {
  accessToken: string;
  account: { id: number };
}
interface CareerResult {
  id: number;
  teams: Array<{ id: number; code: string; isUserControlled: boolean }>;
}
interface AiResult {
  careerId: number;
  clubs: Array<{
    team: { id: number };
    difficulty: string;
    lastDecisionDate: string | null;
    strategy: string;
    budget: {
      year: number;
      salaryCommitted: number;
      annualSalaryBudget: number;
      transferSpent: number;
    };
  }>;
}
interface CalendarResult {
  currentDate: string;
  blockingEvents: Array<{ id: number }>;
}
const json = <T>(response: { body: unknown }): T => response.body as T;

describe('EASY AI clubs, shared market and spending caps (e2e)', () => {
  jest.setTimeout(120_000);
  const key = `ai_clubs_${Date.now()}_${process.pid}`;
  const positions = Object.values(Position);
  const accountIds: number[] = [];
  const playerIds: number[] = [];
  const cardIds: number[] = [];
  const terms: ContractTerms = {
    annualSalary: 200_000,
    years: 2,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.CORE,
    promises: [{ type: ContractPromiseType.STRENGTHEN_TEAM }],
  };
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let themeId: number;
  const api = () => request(app.getHttpServer());
  const auth = (token = ownerToken) => ({ Authorization: `Bearer ${token}` });
  const teamId = (career: CareerResult, code: string) =>
    career.teams.find((team) => team.code === code)!.id;

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
            password: 'ai-clubs-e2e-password',
            displayName: `AI ${suffix}`,
          })
          .expect(201),
      );
      accountIds.push(account.account.id);
      tokens.push(account.accessToken);
    }
    [ownerToken, otherToken] = tokens;
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accountIds[0]]);
    themeId = json<{ id: number }>(
      await api()
        .post('/themes')
        .set(auth())
        .send({
          code: key.toUpperCase(),
          name: 'AI club E2E catalog',
        })
        .expect(201),
    ).id;
    for (let index = 0; index < 19; index += 1) {
      const player = json<{ id: number }>(
        await api()
          .post('/players')
          .set(auth())
          .send({
            nickname: `${key}_${index}`,
            nationality: 'KR',
          })
          .expect(201),
      );
      playerIds.push(player.id);
      const stat =
        index < 5
          ? 80
          : index < 10
            ? 65
            : index < 15
              ? 75
              : index === 15
                ? 80
                : index === 16
                  ? 84
                  : 83;
      const card = json<{ id: number }>(
        await api()
          .post('/player-cards')
          .set(auth())
          .send({
            playerId: player.id,
            themeId,
            cardYear: 2026,
            startingAge: 24,
            mainPosition: index < 15 ? positions[index % 5] : Position.TOP,
            mechanics: stat,
            gameSense: stat,
            laning: stat,
            teamFight: stat,
            macro: stat,
            teamPlay: stat,
            mental: stat,
            championPool: stat,
            personality: PlayerPersonality.PROFESSIONAL,
            potential: 97,
          })
          .expect(201),
      );
      cardIds.push(card.id);
    }
  });

  async function createCareer(date = '2026-11-19', buyerBench = false) {
    const career = json<CareerResult>(
      await api()
        .post('/careers')
        .set(auth())
        .send({
          startYear: 2026,
          managedTeamCode: 'AI_HOME',
          teams: [
            {
              code: 'AI_HOME',
              name: 'User Club',
              region: Region.LCK,
              starters: positions.map((position, index) => ({
                position,
                playerCardId: cardIds[index],
              })),
              benches: [
                { playerCardId: cardIds[17] },
                { playerCardId: cardIds[18] },
              ],
            },
            {
              code: 'AI_BUYER',
              name: 'AI Buyer',
              region: Region.LCK,
              starters: positions.map((position, index) => ({
                position,
                playerCardId: cardIds[5 + index],
              })),
              benches: buyerBench ? [{ playerCardId: cardIds[15] }] : [],
            },
            {
              code: 'AI_SELLER',
              name: 'AI Seller',
              region: Region.LCK,
              starters: positions.map((position, index) => ({
                position,
                playerCardId: cardIds[10 + index],
              })),
              benches: [{ playerCardId: cardIds[16] }],
            },
          ],
        })
        .expect(201),
    );
    await dataSource.getRepository(Career).update(career.id, {
      currentDate: date,
      currentYear: Number(date.slice(0, 4)),
    });
    // Control unrelated random event planning; protected-legend behavior is tested explicitly below.
    await dataSource.getRepository(LegendSeason).save({
      careerId: career.id,
      year: Number(date.slice(0, 4)),
      seed: 'a'.repeat(64),
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

  async function freezeReviews(career: CareerResult) {
    await locked(career.id, async (manager, saved) => {
      for (const team of career.teams.filter(
        (item) => !item.isUserControlled,
      )) {
        const state = await app
          .get(AiClubBudgetService)
          .getOrCreate(manager, saved, team.id);
        state.lastDecisionDate = saved.currentDate;
        await manager.save(AiClubState, state);
      }
    });
  }

  async function playerFor(careerId: number, cardIndex: number) {
    return dataSource
      .getRepository(CareerPlayer)
      .findOneByOrFail({ careerId, playerCardId: cardIds[cardIndex] });
  }

  async function freeAgent(careerId: number, cardIndex = 17) {
    const player = await playerFor(careerId, cardIndex);
    await dataSource
      .getRepository(Roster)
      .delete({ careerPlayerId: player.id });
    await dataSource
      .getRepository(CareerPlayer)
      .update(player.id, { currentTeamId: null });
    return dataSource
      .getRepository(CareerPlayer)
      .findOneByOrFail({ id: player.id });
  }

  async function aiOffer(
    career: CareerResult,
    playerId: number,
    offeredTerms = terms,
  ) {
    return locked(career.id, (manager, saved) =>
      app
        .get(ContractsService)
        .createAiOffer(
          manager,
          saved,
          teamId(career, 'AI_BUYER'),
          playerId,
          structuredClone(offeredTerms),
        ),
    );
  }

  async function dueTomorrow(offer: ContractOffer) {
    const responseDate = addCalendarDays(offer.offeredDate, 1);
    await dataSource
      .getRepository(ContractOffer)
      .update(offer.id, { responseDate });
    await dataSource
      .getRepository(CalendarEvent)
      .update(offer.responseEventId!, { scheduledDate: responseDate });
  }

  async function advance(careerId: number) {
    return json<CalendarResult>(
      await api()
        .post(`/careers/${careerId}/calendar/advance`)
        .set(auth())
        .send({ mode: 'ONE_DAY' })
        .expect(201),
    );
  }

  async function replayCurrentDay(careerId: number) {
    await locked(careerId, (manager, saved) =>
      app
        .get(EventQueueService)
        .processThroughDate(manager, saved.id, saved.currentDate),
    );
  }

  it('keeps AI inspection read-only, owner-scoped, private-stat-free and charges estimated initial salaries', async () => {
    const career = await createCareer();
    const beforeRoster = await dataSource.getRepository(Roster).find({
      where: { careerTeam: { careerId: career.id } },
      order: { id: 'ASC' },
    });
    const beforeEvents = await dataSource
      .getRepository(CalendarEvent)
      .countBy({ careerId: career.id });
    const response = await api()
      .get(`/careers/${career.id}/ai-clubs`)
      .set(auth())
      .expect(200);
    const result = json<AiResult>(response);
    expect(result.clubs).toHaveLength(2);
    expect(
      result.clubs.every(
        (club) => club.difficulty === 'EASY' && club.lastDecisionDate === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/potential/i);
    const players = await dataSource
      .getRepository(CareerPlayer)
      .findBy({ currentTeamId: teamId(career, 'AI_BUYER') });
    expect(
      result.clubs.find((club) => club.team.id === teamId(career, 'AI_BUYER'))!
        .budget.salaryCommitted,
    ).toBe(
      players.reduce(
        (total, player) => total + estimateAiAnnualSalary(player),
        0,
      ),
    );
    expect(result.clubs.every((club) => club.budget.salaryCommitted > 0)).toBe(
      true,
    );
    await api().get(`/careers/${career.id}/ai-clubs`).set(auth()).expect(200);
    await api().get(`/careers/${career.id}/ai-clubs`).expect(401);
    await api()
      .get(`/careers/${career.id}/ai-clubs`)
      .set(auth(otherToken))
      .expect(404);
    expect(
      await dataSource
        .getRepository(AiClubState)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(CalendarEvent)
        .countBy({ careerId: career.id }),
    ).toBe(beforeEvents);
    expect(
      await dataSource.getRepository(Roster).find({
        where: { careerTeam: { careerId: career.id } },
        order: { id: 'ASC' },
      }),
    ).toEqual(beforeRoster);
  });

  it('promotes stronger AI benches without editing user rosters/stats/catalog, and reviews weekly only once', async () => {
    const career = await createCareer('2026-01-01', true);
    const userRoster = await dataSource.getRepository(Roster).find({
      where: { careerTeamId: teamId(career, 'AI_HOME') },
      order: { id: 'ASC' },
    });
    const beforePlayers = await dataSource
      .getRepository(CareerPlayer)
      .find({ where: { careerId: career.id }, order: { id: 'ASC' } });
    const beforeCards = await dataSource
      .getRepository(PlayerCard)
      .find({ where: { id: In(cardIds) }, order: { id: 'ASC' } });
    const promoted = await playerFor(career.id, 15);
    await advance(career.id);
    expect(
      await dataSource
        .getRepository(Roster)
        .findOneBy({ careerPlayerId: promoted.id }),
    ).toMatchObject({
      role: RosterRole.STARTER,
      starterPosition: Position.TOP,
    });
    expect(
      await dataSource.getRepository(Roster).find({
        where: { careerTeamId: teamId(career, 'AI_HOME') },
        order: { id: 'ASC' },
      }),
    ).toEqual(userRoster);
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .find({ where: { careerId: career.id }, order: { id: 'ASC' } }),
    ).toEqual(beforePlayers);
    expect(
      await dataSource
        .getRepository(PlayerCard)
        .find({ where: { id: In(cardIds) }, order: { id: 'ASC' } }),
    ).toEqual(beforeCards);
    const states = await dataSource
      .getRepository(AiClubState)
      .findBy({ careerId: career.id });
    expect(states).toHaveLength(2);
    expect(
      states.every((state) => state.lastDecisionDate === '2026-01-01'),
    ).toBe(true);
    const news = await dataSource
      .getRepository(CalendarEvent)
      .findBy({ careerId: career.id, type: CalendarEventType.AI_CLUB_UPDATE });
    expect(news.some((event) => event.payload?.action === 'ROSTER')).toBe(true);
    expect(
      news.every(
        (event) =>
          event.status === CalendarEventStatus.COMPLETED &&
          !event.requiresUserAction,
      ),
    ).toBe(true);
    const strategies = await dataSource
      .getRepository(CareerTeam)
      .find({ where: { careerId: career.id }, order: { id: 'ASC' } });
    await locked(career.id, (manager, saved) =>
      app.get(AiClubsService).processDay(manager, saved, saved.currentDate),
    );
    await locked(career.id, (manager, saved) =>
      app.get(AiClubsService).processDay(manager, saved, saved.currentDate),
    );
    await api().get(`/careers/${career.id}/calendar`).set(auth()).expect(200);
    expect(
      await dataSource.getRepository(CalendarEvent).countBy({
        careerId: career.id,
        type: CalendarEventType.AI_CLUB_UPDATE,
      }),
    ).toBe(news.length);
    expect(
      await dataSource
        .getRepository(CareerTeam)
        .find({ where: { careerId: career.id }, order: { id: 'ASC' } }),
    ).toEqual(strategies);
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-01-08' });
    // GET stays read-only: only a calendar mutation runs the next weekly review.
    await advance(career.id);
    expect(
      (
        await dataSource
          .getRepository(AiClubState)
          .findBy({ careerId: career.id })
      ).every((state) => state.lastDecisionDate === '2026-01-08'),
    ).toBe(true);
  });

  it('allows competing user/AI FA offers and completes AI signing without blocking, then promotes the new player', async () => {
    const career = await createCareer();
    const target = await freeAgent(career.id);
    await freezeReviews(career);
    const userOffer = json<{ id: number; responseEventId: number }>(
      await api()
        .post(`/careers/${career.id}/contracts/offers`)
        .set(auth())
        .send({ careerPlayerId: target.id, terms })
        .expect(201),
    );
    const offered = await aiOffer(career, target.id);
    expect(offered).not.toBeNull();
    expect(userOffer.responseEventId).toBeLessThan(offered!.responseEventId!);
    expect(
      await dataSource
        .getRepository(ContractOffer)
        .countBy({ careerId: career.id, careerPlayerId: target.id }),
    ).toBe(2);
    expect(
      await dataSource
        .getRepository(CalendarEvent)
        .findOneBy({ id: offered!.responseEventId! }),
    ).toMatchObject({
      requiresUserAction: false,
      status: CalendarEventStatus.SCHEDULED,
    });
    await dueTomorrow(offered!);
    await dataSource
      .getRepository(ContractOffer)
      .update(userOffer.id, { responseDate: '2026-11-20' });
    await dataSource
      .getRepository(CalendarEvent)
      .update(userOffer.responseEventId, { scheduledDate: '2026-11-20' });
    const result = await advance(career.id);
    expect(result.blockingEvents).toEqual([]);
    expect(
      await dataSource
        .getRepository(ContractOffer)
        .findOneBy({ id: offered!.id }),
    ).toMatchObject({ status: ContractOfferStatus.SIGNED });
    expect(
      await dataSource
        .getRepository(ContractOffer)
        .findOneBy({ id: userOffer.id }),
    ).toMatchObject({ status: ContractOfferStatus.WITHDRAWN });
    expect(
      await dataSource
        .getRepository(CalendarEvent)
        .findOneBy({ id: userOffer.responseEventId }),
    ).toMatchObject({
      status: CalendarEventStatus.COMPLETED,
      requiresUserAction: false,
    });
    expect(
      await dataSource
        .getRepository(PlayerContract)
        .findOneBy({ careerId: career.id, careerPlayerId: target.id }),
    ).toMatchObject({
      careerTeamId: teamId(career, 'AI_BUYER'),
      status: PlayerContractStatus.ACTIVE,
    });
    expect(
      await dataSource
        .getRepository(Roster)
        .findOneBy({ careerPlayerId: target.id }),
    ).toMatchObject({
      careerTeamId: teamId(career, 'AI_BUYER'),
      role: RosterRole.STARTER,
      starterPosition: Position.TOP,
    });
    expect(
      await dataSource
        .getRepository(TransferRecord)
        .findBy({ careerId: career.id, careerPlayerId: target.id }),
    ).toEqual([
      expect.objectContaining({
        type: TransferRecordType.FREE_AGENT_SIGNING,
        transferFee: 0,
      }),
    ]);
    await replayCurrentDay(career.id);
    await api().get(`/careers/${career.id}/calendar`).set(auth()).expect(200);
    expect(
      await dataSource
        .getRepository(TransferRecord)
        .countBy({ careerId: career.id, careerPlayerId: target.id }),
    ).toBe(1);
  });

  it('completes AI-to-AI transfer with exactly-once fee spending and refuses players from the user club', async () => {
    const career = await createCareer();
    await freezeReviews(career);
    const protectedPlayer = await playerFor(career.id, 17);
    expect(await aiOffer(career, protectedPlayer.id)).toBeNull();
    const target = await playerFor(career.id, 16);
    const offered = await aiOffer(career, target.id);
    expect(offered).toMatchObject({ offerType: ContractOfferType.TRANSFER });
    const agreement = await dataSource
      .getRepository(TransferAgreement)
      .findOneByOrFail({ id: offered!.transferAgreementId! });
    expect(agreement.offeredFee).toBeGreaterThan(0);
    expect(agreement.status).toBe(TransferAgreementStatus.ACCEPTED);
    await dueTomorrow(offered!);
    await advance(career.id);
    expect(
      await dataSource
        .getRepository(ContractOffer)
        .findOneBy({ id: offered!.id }),
    ).toMatchObject({ status: ContractOfferStatus.SIGNED });
    const state = await dataSource
      .getRepository(AiClubState)
      .findOneByOrFail({ careerTeamId: teamId(career, 'AI_BUYER') });
    expect(state.transferSpent).toBe(agreement.offeredFee);
    expect(
      await dataSource.getRepository(CareerPlayer).findOneBy({ id: target.id }),
    ).toMatchObject({ currentTeamId: teamId(career, 'AI_BUYER') });
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .findOneBy({ id: protectedPlayer.id }),
    ).toMatchObject({ currentTeamId: teamId(career, 'AI_HOME') });
    await replayCurrentDay(career.id);
    await api().get(`/careers/${career.id}/calendar`).set(auth()).expect(200);
    expect(
      (
        await dataSource
          .getRepository(AiClubState)
          .findOneByOrFail({ id: state.id })
      ).transferSpent,
    ).toBe(agreement.offeredFee);
    expect(
      await dataSource
        .getRepository(TransferRecord)
        .findBy({ careerId: career.id, careerPlayerId: target.id }),
    ).toEqual([
      expect.objectContaining({
        type: TransferRecordType.TRANSFER,
        transferFee: agreement.offeredFee,
      }),
    ]);
  });

  it('reserves initial salaries, refuses over-cap salary/fees, and rechecks the cap before signature', async () => {
    const career = await createCareer();
    const target = await freeAgent(career.id);
    await freezeReviews(career);
    const state = await dataSource
      .getRepository(AiClubState)
      .findOneByOrFail({ careerTeamId: teamId(career, 'AI_BUYER') });
    await dataSource
      .getRepository(AiClubState)
      .update(state.id, { annualSalaryBudget: terms.annualSalary });
    expect(await aiOffer(career, target.id)).toBeNull();
    await dataSource.getRepository(AiClubState).update(state.id, {
      annualSalaryBudget: AI_CLUB_CONFIG.initialSalaryBudget,
      transferBudget: 0,
    });
    expect(
      await aiOffer(career, (await playerFor(career.id, 16)).id),
    ).toBeNull();
    expect(
      await dataSource
        .getRepository(TransferAgreement)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    const offered = await aiOffer(career, target.id);
    expect(offered).not.toBeNull();
    await dataSource
      .getRepository(AiClubState)
      .update(state.id, { annualSalaryBudget: 1 });
    await dueTomorrow(offered!);
    await advance(career.id);
    expect(
      await dataSource
        .getRepository(ContractOffer)
        .findOneBy({ id: offered!.id }),
    ).toMatchObject({ status: ContractOfferStatus.WITHDRAWN });
    expect(
      await dataSource.getRepository(CareerPlayer).findOneBy({ id: target.id }),
    ).toMatchObject({ currentTeamId: null });
    expect(
      await dataSource
        .getRepository(TransferRecord)
        .countBy({ careerId: career.id, careerPlayerId: target.id }),
    ).toBe(0);
  });

  it('keeps protected legend entrants out of ordinary AI offers until the day after legend processing', async () => {
    const career = await createCareer();
    const target = await freeAgent(career.id);
    const season = await dataSource
      .getRepository(LegendSeason)
      .findOneByOrFail({ careerId: career.id, year: 2026 });
    const event = await dataSource.getRepository(LegendEvent).save({
      careerId: career.id,
      seasonId: season.id,
      ordinal: 1,
      themeId,
      playerCardIds: [target.playerCardId],
      revealDate: '2026-11-19',
      revealedDate: '2026-11-19',
      calendarEventId: null,
    });
    const entrant = await dataSource.getRepository(LegendEventPlayer).save({
      careerId: career.id,
      legendEventId: event.id,
      careerPlayerId: target.id,
      interestedTeamIds: [teamId(career, 'AI_BUYER')],
      aiDecisionDate: '2026-11-27',
      aiProcessedDate: null,
    });
    expect(await aiOffer(career, target.id)).toBeNull();
    await dataSource
      .getRepository(LegendEventPlayer)
      .update(entrant.id, { aiProcessedDate: '2026-11-19' });
    expect(await aiOffer(career, target.id)).toBeNull();
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-11-20' });
    expect(await aiOffer(career, target.id)).toMatchObject({
      offerType: ContractOfferType.FREE_AGENT,
      status: ContractOfferStatus.WAITING_PLAYER_RESPONSE,
    });
  });

  it('lazily initializes old-save AI state and resets annual transfer spending once at the year boundary', async () => {
    const career = await createCareer('2026-12-31');
    expect(
      await dataSource
        .getRepository(AiClubState)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    await freezeReviews(career);
    const state = await dataSource
      .getRepository(AiClubState)
      .findOneByOrFail({ careerTeamId: teamId(career, 'AI_BUYER') });
    await dataSource
      .getRepository(AiClubState)
      .update(state.id, { transferSpent: 12_345 });
    const result = await advance(career.id);
    expect(result.currentDate).toBe('2027-01-01');
    expect(
      await dataSource.getRepository(AiClubState).findOneBy({ id: state.id }),
    ).toMatchObject({
      budgetYear: 2027,
      transferSpent: 0,
      annualSalaryBudget: AI_CLUB_CONFIG.initialSalaryBudget,
    });
    const first = json<AiResult>(
      await api().get(`/careers/${career.id}/ai-clubs`).set(auth()).expect(200),
    );
    expect(first.clubs.every((club) => club.budget.year === 2027)).toBe(true);
    await locked(career.id, (manager, saved) =>
      app.get(AiClubsService).processDay(manager, saved, saved.currentDate),
    );
    expect(
      await dataSource
        .getRepository(AiClubState)
        .countBy({ careerId: career.id }),
    ).toBe(2);
    expect(
      (
        await dataSource
          .getRepository(AiClubState)
          .findOneByOrFail({ id: state.id })
      ).transferSpent,
    ).toBe(0);
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
