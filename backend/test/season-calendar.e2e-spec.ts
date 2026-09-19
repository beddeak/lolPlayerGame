import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { AiClubState } from '../src/ai-clubs/entities/ai-club-state.entity';
import { Account } from '../src/auth/entities/account.entity';
import { calendarDaysBetween } from '../src/calendars/calendar-date';
import { getLeagueSplitWindow } from '../src/calendars/config/season-calendar.config';
import {
  CalendarAdvanceResponseDto,
  CalendarResponseDto,
} from '../src/calendars/dto/calendar-response.dto';
import { Career } from '../src/careers/entities/career.entity';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { Roster } from '../src/careers/entities/roster.entity';
import { Region } from '../src/careers/enums/region.enum';
import {
  ContractExpectedRole,
  ContractOfferStatus,
  ContractOfferType,
  PlayerContractStatus,
  type ContractTerms,
} from '../src/contracts/contract.types';
import { ContractOffer } from '../src/contracts/entities/contract-offer.entity';
import { PlayerContract } from '../src/contracts/entities/player-contract.entity';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../src/event-queue/enums/calendar-event-type.enum';
import { LeagueSplitResponseDto } from '../src/leagues/dto/league-split-response.dto';
import { LeagueFixture } from '../src/leagues/entities/league-fixture.entity';
import { LeagueSplit } from '../src/leagues/entities/league-split.entity';
import { LeagueSplitStatus } from '../src/leagues/enums/league-split-status.enum';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { Position } from '../src/players/enums/position.enum';
import { FastSimResponseDto } from '../src/simulations/dto/simulation-response.dto';

interface AuthResult {
  accessToken: string;
  account: { id: number };
}
interface CareerResult {
  id: number;
  teams: Array<{ id: number; code: string; isUserControlled: boolean }>;
}
const json = <T>(response: { body: unknown }): T => response.body as T;

describe('full season calendar and existing career continuity (e2e)', () => {
  jest.setTimeout(180_000);
  const key = `season_${Date.now()}_${process.pid}`;
  const positions = Object.values(Position);
  // Preserve the original four-region legacy save fixture. Six-region coverage is separate.
  const regions = [Region.LCK, Region.LPL, Region.LEC, Region.LCS];
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
            password: 'season-calendar-e2e-password',
            displayName: `Season ${suffix}`,
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
        .send({
          code: key.toUpperCase(),
          name: 'Full season E2E catalog',
        })
        .expect(201),
    ).id;
    for (let index = 0; index < 40; index += 1) {
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
            mechanics: 80,
            gameSense: 80,
            laning: 80,
            teamFight: 80,
            macro: 80,
            teamPlay: 80,
            mental: 80,
            championPool: 80,
            personality: PlayerPersonality.PROFESSIONAL,
            potential: 95,
          })
          .expect(201),
      );
      cardIds.push(card.id);
    }
  });

  async function createCareer(): Promise<CareerResult> {
    return json<CareerResult>(
      await api()
        .post('/careers')
        .set(auth())
        .send({
          startYear: 2026,
          managedTeamCode: 'LCK_0',
          teams: regions.flatMap((region, regionIndex) =>
            [0, 1].map((clubIndex) => ({
              code: `${region}_${clubIndex}`,
              name: `${region} club ${clubIndex}`,
              region,
              starters: positions.map((position, index) => ({
                position,
                playerCardId: cardIds[regionIndex * 10 + clubIndex * 5 + index],
              })),
            })),
          ),
        })
        .expect(201),
    );
  }

  async function calendar(careerId: number): Promise<CalendarResponseDto> {
    return json<CalendarResponseDto>(
      await api().get(`/careers/${careerId}/calendar`).set(auth()).expect(200),
    );
  }

  async function start(careerId: number): Promise<CalendarResponseDto> {
    return json<CalendarResponseDto>(
      await api()
        .post(`/careers/${careerId}/calendar/start-season`)
        .set(auth())
        .expect(201),
    );
  }

  async function advance(
    careerId: number,
    mode = 'ONE_DAY',
  ): Promise<CalendarAdvanceResponseDto> {
    return json<CalendarAdvanceResponseDto>(
      await api()
        .post(`/careers/${careerId}/calendar/advance`)
        .set(auth())
        .send({ mode })
        .expect(201),
    );
  }

  async function playerState(careerId: number) {
    return dataSource
      .getRepository(CareerPlayer)
      .find({ where: { careerId }, order: { id: 'ASC' } });
  }

  async function rosterState(careerId: number) {
    return dataSource
      .getRepository(Roster)
      .find({ where: { careerTeam: { careerId } }, order: { id: 'ASC' } });
  }

  it('keeps old saves opted out until an owned, concurrent and idempotent start request', async () => {
    const career = await createCareer();
    const beforePlayers = await playerState(career.id);
    const beforeRosters = await rosterState(career.id);
    const before = await calendar(career.id);
    expect(before.autoSchedule).toBe(false);
    expect(before.season).toMatchObject({
      year: 2026,
      currentPhase: { code: 'PRESEASON' },
    });
    expect(before.season.periods).toHaveLength(14);
    expect(before.seasonReadiness).toHaveLength(6);
    expect(
      before.seasonReadiness
        .filter((row) => regions.includes(row.region))
        .every((row) => row.status === 'READY' && row.teamCount === 2),
    ).toBe(true);
    expect(before.nextMatch).toBeNull();
    expect(
      await dataSource
        .getRepository(LeagueSplit)
        .countBy({ careerId: career.id }),
    ).toBe(0);
    await api().post(`/careers/${career.id}/calendar/start-season`).expect(401);
    await api()
      .post(`/careers/${career.id}/calendar/start-season`)
      .set(auth(otherToken))
      .expect(404);
    await api()
      .get(`/careers/${career.id}/calendar`)
      .set(auth(otherToken))
      .expect(404);
    const starts = await Promise.all([
      start(career.id),
      start(career.id),
      start(career.id),
    ]);
    expect(
      starts.every(
        (result) => result.autoSchedule && result.currentDate === '2026-01-01',
      ),
    ).toBe(true);
    const splits = await dataSource
      .getRepository(LeagueSplit)
      .findBy({ careerId: career.id });
    expect(splits).toHaveLength(4);
    expect(
      new Set(
        splits.map(
          (split) => `${split.year}:${split.region}:${split.splitNumber}`,
        ),
      ).size,
    ).toBe(4);
    const fixtures = await dataSource.getRepository(LeagueFixture).find({
      where: { leagueSplit: { careerId: career.id } },
      order: { id: 'ASC' },
    });
    await start(career.id);
    expect(
      await dataSource.getRepository(LeagueFixture).find({
        where: { leagueSplit: { careerId: career.id } },
        order: { id: 'ASC' },
      }),
    ).toEqual(fixtures);
    expect(await playerState(career.id)).toEqual(beforePlayers);
    expect(await rosterState(career.id)).toEqual(beforeRosters);
  });

  it('plays all twelve regional splits through the public quick/fast/calendar APIs and keeps the save at the year rollover', async () => {
    const career = await createCareer();
    const managedTeam = career.teams.find((team) => team.isUserControlled)!;
    const firstPlayer = (await playerState(career.id)).find(
      (player) => player.currentTeamId === managedTeam.id,
    )!;
    const terms: ContractTerms = {
      annualSalary: 100_000,
      years: 3,
      starterGuarantee: true,
      expectedRole: ContractExpectedRole.STARTER,
      promises: [],
    };
    // A pre-existing long contract is fixture data, not an alternate calendar path.
    const source = await dataSource.getRepository(ContractOffer).save({
      careerId: career.id,
      careerTeamId: managedTeam.id,
      careerPlayerId: firstPlayer.id,
      status: ContractOfferStatus.SIGNED,
      offerType: ContractOfferType.RENEWAL,
      offeredDate: '2026-01-01',
      responseDate: '2026-01-01',
      terms,
      history: [],
    });
    const contract = await dataSource.getRepository(PlayerContract).save({
      careerId: career.id,
      careerTeamId: managedTeam.id,
      careerPlayerId: firstPlayer.id,
      sourceOfferId: source.id,
      signedDate: '2026-01-01',
      startDate: '2026-01-01',
      endDate: '2028-12-31',
      status: PlayerContractStatus.ACTIVE,
      terms,
      promises: [],
    });
    let current = await start(career.id);
    const observedPhases = new Set<string>([current.season.currentPhase.code]);
    const simulatedIds = new Set<number>();
    let quickCount = 0;
    let fastCount = 0;
    for (
      let iteration = 0;
      current.currentDate < '2026-12-31' && iteration < 160;
      iteration += 1
    ) {
      expect(current.scheduleWarnings).toEqual([]);
      expect(
        current.dueMatches.every(
          (fixture) => fixture.scheduledDate === current.currentDate,
        ),
      ).toBe(true);
      if (current.blockingEvents.length) {
        for (const event of current.blockingEvents) {
          expect(event.type).not.toBe(CalendarEventType.CONTRACT_RESPONSE);
          await api()
            .post(`/careers/${career.id}/events/${event.id}/resolve`)
            .set(auth())
            .expect(201);
        }
        current = await calendar(career.id);
        continue;
      }
      const managedFixture = current.dueMatches.find((fixture) =>
        [fixture.teamA.id, fixture.teamB.id].includes(managedTeam.id),
      );
      if (managedFixture) {
        expect(simulatedIds.has(managedFixture.id)).toBe(false);
        await api()
          .post(`/careers/${career.id}/simulations/quick`)
          .set(auth())
          .send({
            leagueSplitId: managedFixture.leagueSplitId,
            fixtureId: managedFixture.id,
          })
          .expect(201);
        simulatedIds.add(managedFixture.id);
        quickCount += 1;
        current = await calendar(career.id);
        continue;
      }
      const result = json<FastSimResponseDto>(
        await api()
          .post(`/careers/${career.id}/simulations/fast`)
          .set(auth())
          .send({
            days: Math.min(
              90,
              calendarDaysBetween(current.currentDate, '2026-12-31'),
            ),
            maxFixtures: 100,
          })
          .expect(201),
      );
      expect(result.currentDate >= current.currentDate).toBe(true);
      expect(
        result.currentDate > current.currentDate ||
          result.simulatedFixtures.length > 0 ||
          result.blockingEvents.length > 0,
      ).toBe(true);
      for (const fixture of result.simulatedFixtures) {
        expect(simulatedIds.has(fixture.fixtureId)).toBe(false);
        simulatedIds.add(fixture.fixtureId);
      }
      current = result.calendar;
      observedPhases.add(current.season.currentPhase.code);
      fastCount += 1;
    }
    expect(current.currentDate).toBe('2026-12-31');
    expect(quickCount).toBeGreaterThan(0);
    expect(fastCount).toBeGreaterThan(0);
    expect([...observedPhases].sort()).toEqual(
      current.season.periods.map((period) => period.code).sort(),
    );
    const completedSplits = json<LeagueSplitResponseDto[]>(
      await api()
        .get(`/careers/${career.id}/league-splits`)
        .set(auth())
        .expect(200),
    );
    expect(completedSplits).toHaveLength(12);
    expect(
      completedSplits.every(
        (split) => split.status === LeagueSplitStatus.COMPLETED,
      ),
    ).toBe(true);
    expect(
      new Set(
        completedSplits.map(
          (split) => `${split.year}:${split.region}:${split.splitNumber}`,
        ),
      ).size,
    ).toBe(12);
    for (const split of completedSplits) {
      const window = getLeagueSplitWindow(split.year, split.splitNumber);
      expect(
        split.fixtures.every(
          (fixture) =>
            fixture.scheduledDate >= window.startsAt &&
            fixture.scheduledDate <= window.endsAt,
        ),
      ).toBe(true);
      const occupiedDays = new Set<string>();
      for (const fixture of split.fixtures) {
        expect(simulatedIds.has(fixture.id)).toBe(true);
        for (const teamId of [fixture.teamA.id, fixture.teamB.id]) {
          const occupied = `${teamId}:${fixture.scheduledDate}`;
          expect(occupiedDays.has(occupied)).toBe(false);
          occupiedDays.add(occupied);
        }
      }
    }
    expect(current.dueMatches).toEqual([]);
    expect(current.nextMatch).toBeNull();
    const playersBeforeRollover = await playerState(career.id);
    const rostersBeforeRollover = await rosterState(career.id);
    const contractsBeforeRollover = await dataSource
      .getRepository(PlayerContract)
      .find({ where: { careerId: career.id }, order: { id: 'ASC' } });
    expect(
      contractsBeforeRollover.some(
        (saved) =>
          saved.id === contract.id &&
          saved.status === PlayerContractStatus.ACTIVE,
      ),
    ).toBe(true);
    const states = await dataSource
      .getRepository(AiClubState)
      .findBy({ careerId: career.id });
    expect(states).toHaveLength(7);
    await dataSource
      .getRepository(AiClubState)
      .update({ careerId: career.id }, { transferSpent: 12_345 });
    const rollover = await advance(career.id);
    expect(rollover).toMatchObject({
      currentDate: '2027-01-01',
      currentYear: 2027,
      autoSchedule: true,
      season: { year: 2027, currentPhase: { code: 'PRESEASON' } },
    });
    expect(rollover.nextMatch?.scheduledDate).toBe('2027-01-12');
    expect(rollover.dueMatches).toEqual([]);
    expect(await playerState(career.id)).toEqual(playersBeforeRollover);
    expect(await rosterState(career.id)).toEqual(rostersBeforeRollover);
    expect(
      await dataSource
        .getRepository(PlayerContract)
        .find({ where: { careerId: career.id }, order: { id: 'ASC' } }),
    ).toEqual(contractsBeforeRollover);
    expect(
      (
        await dataSource
          .getRepository(AiClubState)
          .findBy({ careerId: career.id })
      ).every(
        (state) => state.budgetYear === 2027 && state.transferSpent === 0,
      ),
    ).toBe(true);
    await start(career.id);
    const allSplits = await dataSource
      .getRepository(LeagueSplit)
      .findBy({ careerId: career.id });
    expect(allSplits).toHaveLength(16);
    expect(
      allSplits.filter(
        (split) => split.year === 2027 && split.splitNumber === 1,
      ),
    ).toHaveLength(4);
  });

  it('keeps late legacy fixtures visible and does not invent missing Split 2 seeding history', async () => {
    const career = await createCareer();
    await dataSource
      .getRepository(Career)
      .update(career.id, { currentDate: '2026-03-08' });
    const late = await start(career.id);
    expect(late.scheduleWarnings.length).toBeGreaterThan(0);
    expect(late.nextMatch!.scheduledDate > late.currentDate).toBe(true);
    const savedDates = await dataSource.getRepository(LeagueFixture).find({
      where: { leagueSplit: { careerId: career.id } },
      order: { id: 'ASC' },
    });
    await calendar(career.id);
    await start(career.id);
    expect(
      await dataSource.getRepository(LeagueFixture).find({
        where: { leagueSplit: { careerId: career.id } },
        order: { id: 'ASC' },
      }),
    ).toEqual(savedDates);

    const missingHistory = await createCareer();
    await dataSource
      .getRepository(Career)
      .update(missingHistory.id, { currentDate: '2026-07-29' });
    const summer = await start(missingHistory.id);
    expect(
      summer.seasonReadiness
        .filter((row) => [Region.LCK, Region.LPL].includes(row.region))
        .every((row) => row.status === 'WAITING_FOR_PREVIOUS_SPLIT'),
    ).toBe(true);
    const generated = await dataSource
      .getRepository(LeagueSplit)
      .findBy({ careerId: missingHistory.id });
    expect(generated.map((split) => split.region).sort()).toEqual(
      [Region.LEC, Region.LCS].sort(),
    );
    expect(generated.every((split) => split.splitNumber === 3)).toBe(true);
  });

  it('stops automatic date movement for an unresolved user event, then resumes at the real first match day', async () => {
    const career = await createCareer();
    await start(career.id);
    const event = await dataSource.getRepository(CalendarEvent).save({
      careerId: career.id,
      scheduledDate: '2026-01-02',
      type: CalendarEventType.PLAYER_MEETING,
      status: CalendarEventStatus.SCHEDULED,
      requiresUserAction: true,
      payload: { source: 'season-calendar-e2e' },
    });
    const blocked = await advance(career.id, 'NEXT_MATCH');
    expect(blocked).toMatchObject({
      currentDate: '2026-01-02',
      stopReason: 'BLOCKING_EVENT',
    });
    expect(blocked.blockingEvents.map((item) => item.id)).toContain(event.id);
    const retry = await advance(career.id, 'NEXT_MATCH');
    expect(retry.advancedDays).toBe(0);
    await api()
      .post(`/careers/${career.id}/events/${event.id}/resolve`)
      .set(auth())
      .expect(201);
    const resumed = await advance(career.id, 'NEXT_MATCH');
    expect(resumed).toMatchObject({
      currentDate: '2026-01-12',
      stopReason: 'MATCH_DAY',
    });
    expect(resumed.dueMatches).toHaveLength(4);
    expect(
      await dataSource
        .getRepository(LeagueSplit)
        .countBy({ careerId: career.id }),
    ).toBe(4);
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
