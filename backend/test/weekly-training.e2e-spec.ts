import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import { CareerResponseDto } from '../src/careers/dto/career-response.dto';
import { TrainingPeriodResponseDto } from '../src/careers/dto/training.dto';
import { Career } from '../src/careers/entities/career.entity';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { CareerTeam } from '../src/careers/entities/career-team.entity';
import { CareerTeamStrategyProficiency } from '../src/careers/entities/career-team-strategy-proficiency.entity';
import { TrainingPeriod } from '../src/careers/entities/training-period.entity';
import { TeamStrategy } from '../src/careers/enums/team-strategy.enum';
import { Player } from '../src/players/entities/player.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { Position } from '../src/players/enums/position.enum';
import { passiveRecoveryInterval } from '../src/careers/config/form-recovery';
import { addCalendarDays } from '../src/calendars/calendar-date';

describe('weekly training, scrims and rest (isolated DB)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication<App>;
  let db: DataSource;
  let token: string;
  let otherToken: string;
  let career: CareerResponseDto;
  let themeId: number;
  const accounts: number[] = [];
  const cards: number[] = [];
  const players: number[] = [];
  const key = `training_${Date.now()}_${process.pid}`;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const path = () => `/careers/${career.id}/training-periods/current`;
  const individual = (careerPlayerId: number, type = 'LANING') =>
    api()
      .post(`${path()}/individual`)
      .set(auth())
      .send({ careerPlayerId, type });
  const scrim = () =>
    api()
      .post(`${path()}/team`)
      .set(auth())
      .send({ type: 'STRATEGY', strategy: 'BALANCED' });
  const rest = () =>
    api().post(`${path()}/team`).set(auth()).send({ type: 'REST' });
  const current = async () =>
    (await api().get(path()).set(auth()).expect(200))
      .body as TrainingPeriodResponseDto;
  const date = (value: string) =>
    db.getRepository(Career).update(career.id, { currentDate: value });
  const player = () => career.teams[0].starters[0].careerPlayer.id;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    if (!/^lol_manager_e2e_[0-9]+_[0-9]+$/.test(String(db.options.database)))
      throw new Error('Requires test:e2e:isolated');
    const tokens: string[] = [];
    for (const suffix of ['owner', 'other']) {
      const response = await api()
        .post('/auth/register')
        .send({
          email: `${key}_${suffix}@example.com`,
          password: 'training-test-password',
          displayName: suffix,
        })
        .expect(201);
      const body = response.body as {
        account: { id: number };
        accessToken: string;
      };
      accounts.push(body.account.id);
      tokens.push(body.accessToken);
    }
    [token, otherToken] = tokens;
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accounts[0]]);
    const theme = await api()
      .post('/themes')
      .set(auth())
      .send({ code: key.toUpperCase(), name: key })
      .expect(201);
    themeId = (theme.body as { id: number }).id;
    const positions = Object.values(Position);
    for (let index = 0; index < 11; index++) {
      const result = await api()
        .post('/players')
        .set(auth())
        .send({ nickname: `${key}_${index}`, nationality: 'KR' })
        .expect(201);
      const playerId = (result.body as { id: number }).id;
      players.push(playerId);
      const card = await api()
        .post('/player-cards')
        .set(auth())
        .send({
          playerId,
          themeId,
          cardYear: 2026,
          startingAge: 20,
          mainPosition: positions[index % 5],
          mechanics: 80,
          gameSense: 80,
          laning: 80,
          teamFight: 80,
          macro: 80,
          teamPlay: 80,
          mental: 80,
          championPool: 80,
          potential: 100,
        })
        .expect(201);
      cards.push((card.body as { id: number }).id);
    }
  });

  beforeEach(async () => {
    const response = await api()
      .post('/careers')
      .set(auth())
      .send({
        startYear: 2026,
        managedTeamCode: 'TRAIN_HOME',
        teams: ['HOME', 'AWAY'].map((suffix, index) => ({
          code: `TRAIN_${suffix}`,
          name: suffix,
          region: 'LCK',
          starters: Object.values(Position).map((position, offset) => ({
            position,
            playerCardId: cards[index * 5 + offset],
          })),
          benches: index === 0 ? [{ playerCardId: cards[10] }] : [],
        })),
      })
      .expect(201);
    career = response.body as CareerResponseDto;
  });

  afterAll(async () => {
    if (accounts.length)
      await db.getRepository(Account).delete({ id: In(accounts) });
    if (cards.length)
      await db.getRepository(PlayerCard).delete({ id: In(cards) });
    if (players.length)
      await db.getRepository(Player).delete({ id: In(players) });
    if (themeId) await db.getRepository(Theme).delete(themeId);
    await app?.close();
  });

  it('is read-only on GET, enforces owner/team scope and validates targets', async () => {
    const before = await db
      .getRepository(TrainingPeriod)
      .countBy({ careerId: career.id });
    await date('2026-01-05');
    await current();
    await current();
    expect(
      await db.getRepository(TrainingPeriod).countBy({ careerId: career.id }),
    ).toBe(before);
    await api().get(path()).expect(401);
    await api()
      .get(path())
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await api()
      .post(`${path()}/team`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ type: 'REST' })
      .expect(404);
    await individual(career.teams[1].starters[0].careerPlayer.id).expect(404);
    await individual(player(), 'UNKNOWN').expect(400);
    await api()
      .post(`${path()}/individual`)
      .set(auth())
      .send({ careerPlayerId: player(), type: 'LANING', amount: 119 })
      .expect(400);
    expect((await current()).sessions).toHaveLength(0);
  });

  it('serializes simultaneous scrims, raises both team attributes and keeps player budgets separate', async () => {
    const responses = await Promise.all([scrim(), scrim()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const team = await db
      .getRepository(CareerTeam)
      .findOneByOrFail({ id: career.teams[0].id });
    expect(team.chemistry).toBe(53);
    const proficiency = await db
      .getRepository(CareerTeamStrategyProficiency)
      .findOneByOrFail({
        careerTeamId: team.id,
        strategy: TeamStrategy.BALANCED,
      });
    expect(proficiency.proficiency).toBe(54);
    await individual(player()).expect(201);
    const benchId = career.teams[0].benches[0].careerPlayer.id;
    await individual(benchId, 'MECHANICS').expect(201);
    expect((await current()).usedPlayerIds.sort()).toEqual(
      [player(), benchId].sort(),
    );
    await rest().expect(409);
    const stored = await db
      .getRepository(CareerPlayer)
      .findOneByOrFail({ id: player() });
    expect(stored.currentLaning).toBeGreaterThanOrEqual(80);
    expect(stored.currentLaning).toBeLessThanOrEqual(82);
    expect(stored.condition).toBeLessThan(100);
    expect(
      (
        await db
          .getRepository(PlayerCard)
          .findOneByOrFail({ id: stored.playerCardId })
      ).laning,
    ).toBe(80);
  });

  it('allows one individual action per player even under concurrent requests, and resets on Monday', async () => {
    const responses = await Promise.all([
      individual(player()),
      individual(player()),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    await date('2026-01-04');
    await individual(player()).expect(409);
    const oldId = (await current()).id;
    await date('2026-01-05');
    expect((await current()).usedPlayerIds).toEqual([]);
    await rest().expect(201);
    expect((await current()).id).not.toBe(oldId);
    await individual(player()).expect(409);
    expect(
      (await db.getRepository(CareerPlayer).findOneByOrFail({ id: player() }))
        .condition,
    ).toBe(100);
  });

  it.each([
    '2026-01-12',
    '2026-03-16',
    '2026-06-28',
    '2026-07-29',
    '2026-10-15',
    '2026-11-20',
  ])(
    'allows weekly team activities but blocks stat training outside preparation (%s)',
    async (value) => {
      await date(value);
      expect((await current()).available).toBe(false);
      await individual(player()).expect(409);
      await individual(player(), 'REST').expect(400);
      expect((await current()).teamAvailable).toBe(true);
      await scrim().expect(201);
      await rest().expect(409);
      await date(addCalendarDays(value, 7));
      await rest().expect(201);
      await scrim().expect(409);
    },
  );

  it('caps recovery at 100, allows rest from zero, and rejects useless rest without consuming a use', async () => {
    await db
      .getRepository(CareerPlayer)
      .update(
        { currentTeamId: career.teams[0].id },
        { condition: 100, form: 100 },
      );
    await rest().expect(400);
    expect((await current()).teamTraining.remaining).toBe(1);
    await db.getRepository(CareerPlayer).update(player(), { condition: 0 });
    await individual(player()).expect(400);
    await rest().expect(201);
    expect(
      (await db.getRepository(CareerPlayer).findOneByOrFail({ id: player() }))
        .condition,
    ).toBe(20);
    await date('2026-01-05');
    await db.getRepository(CareerPlayer).update(player(), { condition: 99 });
    await rest().expect(201);
    expect(
      (await current()).sessions[0].playerEffects.find(
        (effect) => effect.careerPlayerId === player(),
      )?.conditionDelta,
    ).toBe(1);
  });

  it('recovers form at full condition, scales with Mental and saves capped per-player effects including benches', async () => {
    const ids = [
      player(),
      career.teams[0].starters[1].careerPlayer.id,
      career.teams[0].benches[0].careerPlayer.id,
    ];
    await db
      .getRepository(CareerPlayer)
      .update(ids[0], { condition: 100, form: 30, currentMental: 0 });
    await db
      .getRepository(CareerPlayer)
      .update(ids[1], { condition: 100, form: 30, currentMental: 119 });
    await db
      .getRepository(CareerPlayer)
      .update(ids[2], { condition: 99, form: 99, currentMental: 119 });
    const responses = await Promise.all([rest(), rest()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    await scrim().expect(409);
    const period = await current();
    expect(period.teamRested).toBe(true);
    expect(period.sessions).toHaveLength(1);
    expect(period.sessions[0].playerEffects).toHaveLength(6);
    const effects = new Map(
      period.sessions[0].playerEffects.map((effect) => [
        effect.careerPlayerId,
        effect,
      ]),
    );
    expect(effects.get(ids[0])).toMatchObject({
      conditionDelta: 0,
      formDelta: 1,
      formAfter: 31,
    });
    expect(effects.get(ids[1])).toMatchObject({
      conditionDelta: 0,
      formDelta: 3,
      formAfter: 33,
    });
    expect(effects.get(ids[2])).toMatchObject({
      conditionDelta: 1,
      formDelta: 1,
      formAfter: 100,
    });
    expect(period.teamTraining).toEqual({ used: 1, limit: 1, remaining: 0 });
    expect(period.usedPlayerIds).toEqual([]);
    await individual(player()).expect(409);
    const away = await db
      .getRepository(CareerPlayer)
      .findOneByOrFail({ id: career.teams[1].starters[0].careerPlayer.id });
    expect(away.form).toBe(50);
    expect(away.condition).toBe(100);
  });

  it('prevents individual training then team rest in the same week, without charging a failed rest', async () => {
    await individual(player()).expect(201);
    await rest().expect(409);
    expect((await current()).teamTraining.remaining).toBe(1);
    await scrim().expect(201);
  });

  it('recovers only low form on actual game-date advances, using Mental cadence and never condition', async () => {
    await db
      .getRepository(CareerPlayer)
      .update(
        { careerId: career.id },
        { condition: 40, form: 20, currentMental: 0 },
      );
    const high = career.teams[0].starters[1].careerPlayer.id;
    const capped = career.teams[0].benches[0].careerPlayer.id;
    await db.getRepository(CareerPlayer).update(high, { currentMental: 119 });
    await db
      .getRepository(CareerPlayer)
      .update(capped, { form: 50, currentMental: 119 });
    const before = await db
      .getRepository(CareerPlayer)
      .findBy({ careerId: career.id });
    const url = `/careers/${career.id}/calendar`;
    await api().get(url).set(auth()).expect(200);
    await current();
    expect(
      await db.getRepository(CareerPlayer).findBy({ careerId: career.id }),
    ).toEqual(before);
    const visited: string[] = [];
    for (let index = 0; index < 14; index++) {
      const response = await api()
        .post(`${url}/advance`)
        .set(auth())
        .send({ mode: 'ONE_DAY' })
        .expect(201);
      const body = response.body as {
        currentDate: string;
        advancedDays: number;
      };
      expect(body.advancedDays).toBe(1);
      visited.push(body.currentDate);
    }
    const after = await db
      .getRepository(CareerPlayer)
      .findBy({ careerId: career.id });
    for (const record of after) {
      const initial = before.find((entry) => entry.id === record.id)!;
      const interval = passiveRecoveryInterval(initial.currentMental);
      const recovery = visited.filter(
        (day) =>
          (Date.parse(`${day}T00:00:00Z`) / 86_400_000 + record.id) %
            interval ===
          0,
      ).length;
      expect(record.form).toBe(Math.min(50, initial.form + recovery));
      expect(record.condition).toBe(40);
    }
    expect(after.find((entry) => entry.id === high)!.form).toBe(27);
    expect(after.find((entry) => entry.id === player())!.form).toBe(21);
  });

  it('never exceeds stat 119, and rejects capped training without spending the weekly use', async () => {
    await db
      .getRepository(CareerPlayer)
      .update(player(), { currentLaning: 119, currentMechanics: 118 });
    await individual(player()).expect(400);
    expect((await current()).usedPlayerIds).toEqual([]);
    await individual(player(), 'MECHANICS').expect(201);
    const stored = await db
      .getRepository(CareerPlayer)
      .findOneByOrFail({ id: player() });
    expect(stored.currentMechanics).toBeLessThanOrEqual(119);
    expect(stored.currentMechanics).toBeGreaterThanOrEqual(118);
  });

  it('preserves legacy undated history and caps chemistry/proficiency independently', async () => {
    await db
      .getRepository(TrainingPeriod)
      .update({ careerId: career.id }, { weekStartsAt: null });
    const teamId = career.teams[0].id;
    await db.getRepository(CareerTeam).update(teamId, { chemistry: 99 });
    await db
      .getRepository(CareerTeamStrategyProficiency)
      .update(
        { careerTeamId: teamId, strategy: TeamStrategy.BALANCED },
        { proficiency: 100 },
      );
    await scrim().expect(201);
    expect(
      await db.getRepository(TrainingPeriod).countBy({ careerId: career.id }),
    ).toBe(2);
    expect(
      (await db.getRepository(CareerTeam).findOneByOrFail({ id: teamId }))
        .chemistry,
    ).toBe(100);
    await date('2026-01-05');
    await scrim().expect(400);
    expect((await current()).teamTraining.remaining).toBe(1);
  });
});
