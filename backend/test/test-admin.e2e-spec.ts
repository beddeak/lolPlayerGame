import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import { Player } from '../src/players/entities/player.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { Position } from '../src/players/enums/position.enum';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { MatchSeries } from '../src/match-series/entities/match-series.entity';
import { Match } from '../src/matches/entities/match.entity';
import { LeagueSplit } from '../src/leagues/entities/league-split.entity';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventType } from '../src/event-queue/enums/calendar-event-type.enum';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';
import { CalendarsService } from '../src/calendars/calendars.service';
import { CalendarAdvanceMode } from '../src/calendars/enums/calendar-advance-mode.enum';
import { ManagerCareerState } from '../src/manager-career/entities/manager-career-state.entity';
import { updateSeriesDraft } from '../src/drafts/series-draft.store';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { CareerTeam } from '../src/careers/entities/career-team.entity';
import { TrainingSession } from '../src/careers/entities/training-session.entity';
import { TrainingService } from '../src/careers/training.service';
import { TrainingType } from '../src/careers/enums/training-type.enum';
import { TrainingCategory } from '../src/careers/enums/training-category.enum';
import { LeagueStage } from '../src/leagues/entities/league-stage.entity';
import { LeagueStageStatus } from '../src/leagues/enums/league-stage-status.enum';
import { LeagueFixture } from '../src/leagues/entities/league-fixture.entity';
import { isRegularStage } from '../src/season-skip/season-skip.policy';

interface Snapshot {
  currentDate: string;
  cursor: string;
  games: number;
  players: Array<{ id: number; values: Record<string, number> }>;
}
interface Step extends Snapshot {
  done: boolean;
  stopped: boolean;
  message: string;
}
describe('temporary own-save admin (e2e)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication<App>,
    db: DataSource,
    token: string,
    outsider: string,
    themeId: number;
  const accounts: number[] = [],
    cards: number[] = [],
    players: number[] = [];
  const key = `testadmin_${Date.now()}_${process.pid}`;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    app.get(ConfigService).set('TEST_ADMIN_ENABLED', 'true');
    for (let i = 0; i < 2; i++) {
      const response = await api()
        .post('/auth/register')
        .send({
          email: `${key}_${i}@example.com`,
          password: 'test-admin-e2e-password',
          displayName: 'Test admin',
        })
        .expect(201);
      const body = response.body as {
        accessToken: string;
        account: { id: number };
      };
      accounts.push(body.account.id);
      if (i === 0) token = body.accessToken;
      else outsider = body.accessToken;
    }
    const theme = await db.manager.save(
      Theme,
      db.manager.create(Theme, { code: key, name: key }),
    );
    themeId = theme.id;
    for (let i = 0; i < 50; i++) {
      const player = await db.manager.save(
        Player,
        db.manager.create(Player, {
          nickname: `${key}_${i}`,
          nationality: 'KR',
        }),
      );
      players.push(player.id);
      const card = await db.manager.save(
        PlayerCard,
        db.manager.create(PlayerCard, {
          playerId: player.id,
          themeId,
          cardYear: 2026,
          startingAge: 20,
          mainPosition: Object.values(Position)[i % 5],
          mechanics: 85,
          gameSense: 85,
          laning: 85,
          teamFight: 85,
          macro: 85,
          teamPlay: 85,
          mental: 85,
          championPool: 85,
          potential: 110,
          personality: PlayerPersonality.PROFESSIONAL,
        }),
      );
      cards.push(card.id);
    }
  });
  async function create(teamCount = 2) {
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accounts[0]]);
    try {
      const response = await api()
        .post('/careers')
        .set(auth())
        .send({
          startYear: 2026,
          managedTeamCode: 'A',
          teams: Array.from({ length: teamCount }, (_, i) =>
            String.fromCharCode(65 + i),
          ).map((code, i) => ({
            code,
            name: code,
            region: 'LEC',
            starters: Object.values(Position).map((position, j) => ({
              position,
              playerCardId: cards[i * 5 + j],
            })),
          })),
        })
        .expect(201);
      return (response.body as { id: number }).id;
    } finally {
      app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', []);
    }
  }
  async function inspect(id: number) {
    return (
      await api().get(`/careers/${id}/test-admin`).set(auth()).expect(200)
    ).body as Snapshot;
  }
  async function step(id: number, cursor: string) {
    return (
      await api()
        .post(`/careers/${id}/test-admin/advance`)
        .set(auth())
        .send({ cursor, targetDate: '2026-11-19' })
        .expect(201)
    ).body as Step;
  }
  afterAll(async () => {
    if (db?.isInitialized) {
      if (accounts.length)
        await db.manager.delete(Account, { id: In(accounts) });
      if (cards.length) await db.manager.delete(PlayerCard, { id: In(cards) });
      if (players.length) await db.manager.delete(Player, { id: In(players) });
      if (themeId) await db.manager.delete(Theme, themeId);
    }
    await app?.close();
  });

  it('normal season skip applies weekly plans and preseason individual training, resumes and stops before real playoffs', async () => {
    const id = await create(10);
    const team = await db.manager.findOneByOrFail(CareerTeam, {
      careerId: id,
      isUserControlled: true,
    });
    const roster = await db.manager.find(CareerPlayer, {
      where: { careerId: id },
      order: { id: 'ASC' },
    });
    for (const p of roster) {
      const ability = p.currentTeamId === team.id ? 100 : 40;
      Object.assign(p, {
        currentMechanics: ability,
        currentGameSense: ability,
        currentLaning: ability,
        currentTeamFight: ability,
        currentMacro: ability,
        currentTeamPlay: ability,
        currentMental: ability,
        currentChampionPool: ability,
      });
    }
    await db.manager.save(CareerPlayer, roster);
    await api()
      .post(`/careers/${id}/calendar/start-season`)
      .set(auth())
      .expect(201);
    const base = `/careers/${id}/season-skip`;
    await api().get(base).expect(401);
    await api()
      .get(base)
      .set('Authorization', `Bearer ${outsider}`)
      .expect(404);
    type SkipState = {
      cursor: string;
      currentDate: string;
      splitId: number;
      games: number;
      activities: number;
      done?: boolean;
      stopped?: boolean;
      message?: string;
    };
    let state = (await api().get(base).set(auth()).expect(200))
      .body as SkipState;
    const plan = {
      splitId: state.splitId,
      startDate: state.currentDate,
      strategy: 'BALANCED',
      pattern: ['SCRIM', 'REST'],
      individuals: [{ careerPlayerId: roster[0].id, type: 'MECHANICS' }],
    };
    await api()
      .post(base + '/step')
      .set(auth())
      .send({ ...plan, cursor: state.cursor, pattern: [] })
      .expect(400);
    await api()
      .post(base + '/step')
      .set('Authorization', `Bearer ${outsider}`)
      .send({ ...plan, cursor: state.cursor })
      .expect(404);
    await expect(
      app
        .get(TrainingService)
        .trainTeam(accounts[0], id, { type: TrainingType.REST }, '2025-12-31'),
    ).rejects.toThrow('날짜가 변경');
    const originalCursor = state.cursor;
    state = (
      await api()
        .post(base + '/step')
        .set(auth())
        .send({ ...plan, cursor: state.cursor })
        .expect(201)
    ).body as SkipState;
    expect(state.activities).toBe(1);
    await api()
      .post(base + '/step')
      .set(auth())
      .send({ ...plan, cursor: originalCursor })
      .expect(409);
    let complete = false;
    for (let i = 0; i < 600; i++) {
      state = (
        await api()
          .post(base + '/step')
          .set(auth())
          .send({ ...plan, cursor: state.cursor })
          .expect(201)
      ).body as SkipState;
      if (state.stopped) throw new Error(JSON.stringify(state));
      if (state.done) {
        complete = true;
        break;
      }
    }
    expect(complete).toBe(true);
    expect(state.games).toBe(45);
    const stages = await db.manager.find(LeagueStage, {
      where: { leagueSplitId: plan.splitId },
      relations: { fixtures: true },
    });
    const regular = stages.find((s) => isRegularStage(s.format))!;
    expect(regular.status).toBe(LeagueStageStatus.COMPLETED);
    const playoff = stages.find((s) => !isRegularStage(s.format))!;
    expect(playoff).toBeDefined();
    expect(playoff.fixtures.every((f) => f.seriesId === null)).toBe(true);
    const sessions = await db.manager.find(TrainingSession, {
      where: { trainingPeriod: { careerId: id } },
      relations: { trainingPeriod: true },
    });
    const individual = sessions.filter(
      (s) => s.category === TrainingCategory.INDIVIDUAL,
    );
    expect(individual).toHaveLength(1);
    expect(individual[0].trainingPeriod.weekStartsAt).toBe('2025-12-29');
    const restWeek = sessions.filter(
      (s) => s.trainingPeriod.weekStartsAt === '2026-01-05',
    );
    expect(restWeek).toHaveLength(1);
    expect(restWeek[0].type).toBe(TrainingType.REST);
    const groups = new Set(
      sessions
        .filter((s) => s.category === TrainingCategory.TEAM)
        .map((s) => s.trainingPeriod.weekStartsAt),
    );
    expect(groups.size).toBe(
      sessions.filter((s) => s.category === TrainingCategory.TEAM).length,
    );
    const again = (
      await api()
        .post(base + '/step')
        .set(auth())
        .send({ ...plan, cursor: state.cursor })
        .expect(201)
    ).body as SkipState;
    expect(again.done).toBe(true);
    expect(again.cursor).toBe(state.cursor);
    expect(
      await db.manager.count(LeagueFixture, {
        where: { leagueSplitId: plan.splitId },
      }),
    ).toBeGreaterThan(45);
  });

  it('season skip preserves manual blockers and skips needless recovery without individual training on rest weeks', async () => {
    const id = await create(10);
    await api()
      .post(`/careers/${id}/calendar/start-season`)
      .set(auth())
      .expect(201);
    const base = `/careers/${id}/season-skip`;
    const state = (await api().get(base).set(auth()).expect(200)).body as {
      cursor: string;
      splitId: number;
      currentDate: string;
      players: { id: number }[];
    };
    const plan = {
      cursor: state.cursor,
      splitId: state.splitId,
      startDate: state.currentDate,
      strategy: 'BALANCED',
      pattern: ['REST'],
      individuals: [{ careerPlayerId: state.players[0].id, type: 'MECHANICS' }],
    };
    const event = await db.manager.save(
      CalendarEvent,
      db.manager.create(CalendarEvent, {
        careerId: id,
        type: CalendarEventType.PLAYER_MEETING,
        status: CalendarEventStatus.SCHEDULED,
        scheduledDate: state.currentDate,
        requiresUserAction: true,
        payload: {},
      }),
    );
    const blocked = (
      await api()
        .post(base + '/step')
        .set(auth())
        .send(plan)
        .expect(201)
    ).body as { stopped: boolean; cursor: string };
    expect(blocked.stopped).toBe(true);
    expect(blocked.cursor).toBe(state.cursor);
    expect(
      await db.manager.findOneBy(CalendarEvent, { id: event.id }),
    ).not.toBeNull();
    await db.manager.delete(CalendarEvent, event.id);
    await db.manager.update(
      CareerPlayer,
      { careerId: id },
      { condition: 100, form: 100 },
    );
    const result = (
      await api()
        .post(base + '/step')
        .set(auth())
        .send(plan)
        .expect(201)
    ).body as { currentDate: string; activities: number; stopped: boolean };
    expect(result.stopped).toBe(false);
    expect(result.currentDate).toBe('2026-01-02');
    expect(result.activities).toBe(0);
    expect(
      await db.manager.count(TrainingSession, {
        where: { trainingPeriod: { careerId: id } },
      }),
    ).toBe(0);
  });

  it('requires auth and ownership and never changes the original card or another save', async () => {
    const id = await create(),
      other = await create();
    const snapshot = await inspect(id),
      player = snapshot.players[0];
    await api().get(`/careers/${id}/test-admin`).expect(401);
    await api()
      .get(`/careers/${id}/test-admin`)
      .set('Authorization', `Bearer ${outsider}`)
      .expect(404);
    const path = `/careers/${id}/test-admin/players/${player.id}`;
    await api()
      .patch(path)
      .set('Authorization', `Bearer ${outsider}`)
      .send({
        values: { currentMechanics: 119 },
        expected: { currentMechanics: 85 },
      })
      .expect(404);
    await api()
      .patch(path)
      .set(auth())
      .send({
        values: { currentMechanics: 120 },
        expected: { currentMechanics: 85 },
      })
      .expect(400);
    await api()
      .patch(path)
      .set(auth())
      .send({ values: { condition: 101 }, expected: { condition: 100 } })
      .expect(400);
    await api()
      .patch(path)
      .set(auth())
      .send({ values: { currentTeamId: 1 }, expected: { currentTeamId: 1 } })
      .expect(400);
    await api()
      .patch(path)
      .set(auth())
      .send({
        values: { currentMechanics: 119 },
        expected: { currentMechanics: 85 },
      })
      .expect(200);
    await api()
      .patch(path)
      .set(auth())
      .send({
        values: { currentMechanics: 100 },
        expected: { currentMechanics: 85 },
      })
      .expect(409);
    expect((await inspect(id)).players[0].values.currentMechanics).toBe(119);
    expect((await inspect(other)).players[0].values.currentMechanics).toBe(85);
    expect(
      (await db.manager.findOneByOrFail(PlayerCard, { id: cards[0] }))
        .mechanics,
    ).toBe(85);
    const foreign = (await inspect(other)).players[0];
    await api()
      .patch(`/careers/${id}/test-admin/players/${foreign.id}`)
      .set(auth())
      .send({
        values: { currentMechanics: 100 },
        expected: { currentMechanics: 85 },
      })
      .expect(404);
  });

  it('can be disabled globally without granting catalog permissions', async () => {
    const id = await create();
    app.get(ConfigService).set('TEST_ADMIN_ENABLED', 'false');
    try {
      await api().get(`/careers/${id}/test-admin`).set(auth()).expect(403);
    } finally {
      app.get(ConfigService).set('TEST_ADMIN_ENABLED', 'true');
    }
  });

  it('serializes concurrent clicks and rejects stale date advancement', async () => {
    const id = await create(),
      state = await inspect(id);
    const results = await Promise.all(
      [0, 1].map(() =>
        api()
          .post(`/careers/${id}/test-admin/advance`)
          .set(auth())
          .send({ cursor: state.cursor, targetDate: '2026-11-19' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await inspect(id)).currentDate).toBe('2026-01-02');
    await expect(
      app
        .get(CalendarsService)
        .advance(
          accounts[0],
          id,
          { mode: CalendarAdvanceMode.ONE_DAY },
          '2026-01-01',
        ),
    ).rejects.toThrow('날짜가 변경');
    expect((await inspect(id)).currentDate).toBe('2026-01-02');
  });

  it('runs the real daily/league/draft pipeline through the market and resumes after stopping', async () => {
    const id = await create();
    let state = await inspect(id);
    let finished = false;
    let observedDraft = false;
    // Keep this completion test deterministic enough to avoid the separately tested dismissal stop.
    for (let index = 0; index < state.players.length; index++) {
      const player = state.players[index];
      await api()
        .patch(`/careers/${id}/test-admin/players/${player.id}`)
        .set(auth())
        .send({
          expected: player.values,
          values: Object.fromEntries(
            Object.keys(player.values).map((key) => [
              key,
              key.startsWith('current') ? (index < 5 ? 119 : 0) : 100,
            ]),
          ),
        })
        .expect(200);
    }
    for (let i = 0; i < 600; i++) {
      const next = await step(id, state.cursor);
      if (next.stopped) throw new Error(JSON.stringify(next));
      expect(next.currentDate <= '2026-11-19').toBe(true);
      if (next.games > 0 && !observedDraft) {
        const allSeries = await db.manager.find(MatchSeries, {
          where: { careerId: id },
          relations: { games: true },
        });
        const series = allSeries.find(
          (candidate) =>
            candidate.games.length > 0 &&
            [candidate.teamAId, candidate.teamBId].every(
              (teamId) =>
                candidate.games.filter((game) => game.winnerTeamId === teamId)
                  .length <
                Math.floor(candidate.bestOf / 2) + 1,
            ),
        );
        if (!series) {
          state = next;
          continue;
        }
        observedDraft = true;
        expect(series.drafts?.['1']?.completed).toBe(true);
        expect(series.drafts?.['1']?.selection?.choices).toHaveLength(2);
        expect(series.games.length).toBeGreaterThan(0);
        await updateSeriesDraft(
          db,
          accounts[0],
          series.id,
          series.games.length + 1,
        );
        const draftedSeries = await db.manager.findOneByOrFail(MatchSeries, {
          id: series.id,
        });
        const nextDraft =
          draftedSeries.drafts![String(series.games.length + 1)];
        const previousGame = series.games.find(
          (g) => g.seriesGameNumber === series.games.length,
        )!;
        expect(nextDraft.selection?.firstSelectionTeamId).toBe(
          previousGame.winnerTeamId === series.teamAId
            ? series.teamBId
            : series.teamAId,
        );
        expect(nextDraft.selection?.policy).toBe('PREVIOUS_LOSER');
        expect(nextDraft.unavailable).toHaveLength(series.games.length * 10);
        expect(nextDraft.unavailable).toEqual(
          expect.arrayContaining(
            series
              .drafts!['1'].actions.filter((a) => a.kind === 'PICK')
              .map((a) => a.variantId),
          ),
        );
        const player = (await inspect(id)).players[0];
        await api()
          .patch(`/careers/${id}/test-admin/players/${player.id}`)
          .set(auth())
          .send({
            values: { currentMechanics: 118 },
            expected: { currentMechanics: 119 },
          })
          .expect(409);
        // The regular simulation path still refuses unfinished managed drafts.
        await expect(
          updateSeriesDraft(
            db,
            accounts[0],
            series.id,
            series.games.length + 1,
            undefined,
            true,
          ),
        ).rejects.toThrow('밴픽을 먼저');
        // Reloading the panel after a pause resumes persisted progress, not a new season.
        expect((await inspect(id)).cursor).toBe(next.cursor);
      }
      state = next;
      if (next.done) {
        finished = true;
        break;
      }
    }
    expect(finished).toBe(true);
    expect(observedDraft).toBe(true);
    expect(state.currentDate).toBe('2026-11-19');
    expect(
      await db.manager.count(LeagueSplit, { where: { careerId: id } }),
    ).toBe(3);
    const before = await db.manager.count(Match, { where: { careerId: id } });
    expect((await step(id, state.cursor)).done).toBe(true);
    expect(await db.manager.count(Match, { where: { careerId: id } })).toBe(
      before,
    );
    expect(
      (
        (await api().get(`/careers/${id}/calendar`).set(auth()).expect(200))
          .body as { transferWindow: { isOpen: boolean } }
      ).transferWindow.isOpen,
    ).toBe(true);
  });

  it('stops for manual events without deleting them or jumping the date', async () => {
    const id = await create();
    const event = await db.manager.save(
      CalendarEvent,
      db.manager.create(CalendarEvent, {
        careerId: id,
        type: CalendarEventType.PLAYER_MEETING,
        status: CalendarEventStatus.SCHEDULED,
        scheduledDate: '2026-01-01',
        requiresUserAction: true,
        payload: {},
      }),
    );
    const state = await inspect(id),
      result = await step(id, state.cursor);
    expect(result.stopped).toBe(true);
    expect(result.currentDate).toBe('2026-01-01');
    expect(
      await db.manager.findOneBy(CalendarEvent, { id: event.id }),
    ).not.toBeNull();
  });

  it('stops on dismissal rather than silently changing employment state', async () => {
    const id = await create();
    await step(id, (await inspect(id)).cursor);
    await db.manager.update(
      ManagerCareerState,
      { careerId: id },
      { status: 'DISMISSED' },
    );
    const state = await inspect(id),
      result = await step(id, state.cursor);
    expect(result.stopped).toBe(true);
    expect(result.message).toContain('경질');
    expect(result.currentDate).toBe(state.currentDate);
    expect(
      (await db.manager.findOneByOrFail(ManagerCareerState, { careerId: id }))
        .status,
    ).toBe('DISMISSED');
  });
});
