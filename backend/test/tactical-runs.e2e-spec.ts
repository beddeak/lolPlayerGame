import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, QueryRunner } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { CareerResponseDto } from '../src/careers/dto/career-response.dto';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { CareerTeam } from '../src/careers/entities/career-team.entity';
import { CareerTeamStrategyProficiency } from '../src/careers/entities/career-team-strategy-proficiency.entity';
import { Region } from '../src/careers/enums/region.enum';
import { TeamStrategy } from '../src/careers/enums/team-strategy.enum';
import { TacticalReplays1789768800000 } from '../src/database/migrations/1789768800000-tactical-replays';
import { MatchSimulationResponseDto } from '../src/matches/dto/match-simulation-response.dto';
import { Match } from '../src/matches/entities/match.entity';
import { MatchTacticalRun } from '../src/matches/entities/match-tactical-run.entity';
import { MatchPlayerStat } from '../src/matches/entities/match-player-stat.entity';
import {
  TacticalReplayChunk,
  TacticalReplayManifest,
} from '../src/matches/simulation-v2/replay';
import { canonicalHash } from '../src/matches/simulation-v2/seeded-rng';
import { createLabInput } from '../src/matches/simulation-v2/test-fixtures';
import { startSimulation, runUntil } from '../src/matches/simulation-v2/engine';
import { buildReplayArchive } from '../src/matches/simulation-v2/replay';
import { TACTICAL_JSON_TRANSFORMER } from '../src/matches/tactical-json.transformer';
import { Player } from '../src/players/entities/player.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { Position } from '../src/players/enums/position.enum';

interface AuthResult {
  accessToken: string;
  account: { id: number };
}

// Real MySQL + real autonomous engine. Never run against a user's save database.
describe('Stage 6 actual career execution and replay (isolated MySQL)', () => {
  // Full autonomous matches include checkpoint compression and real MySQL I/O.
  jest.setTimeout(600_000);
  let app: INestApplication<App>;
  let db: DataSource;

  beforeAll(async () => {
    if (!/^lol_manager_e2e_[0-9]+_[0-9]+$/.test(process.env.DB_DATABASE ?? ''))
      throw new Error(
        'Run via npm run test:e2e:isolated; a temporary database is required',
      );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('round trips input, manifest and replay through MySQL lossless text without changing hashes or byte counts', async () => {
    const state = startSimulation(createLabInput(123));
    runUntil(state, 60_000);
    const archive = buildReplayArchive(state);
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(
        'CREATE TEMPORARY TABLE stage6_json_roundtrip (payload longtext NOT NULL)',
      );
      for (const payload of [
        state.input,
        archive.manifest,
        ...archive.chunks,
      ]) {
        await runner.query('DELETE FROM stage6_json_roundtrip');
        await runner.query('INSERT INTO stage6_json_roundtrip VALUES (?)', [
          TACTICAL_JSON_TRANSFORMER.to(payload) as string,
        ]);
        const rows = (await runner.query(
          'SELECT payload FROM stage6_json_roundtrip',
        )) as Array<{ payload: string }>;
        const actual: unknown = TACTICAL_JSON_TRANSFORMER.from(rows[0].payload);
        expect({
          hash: canonicalHash(actual),
          bytes: Buffer.byteLength(JSON.stringify(actual)),
        }).toEqual({
          hash: canonicalHash(payload),
          bytes: Buffer.byteLength(JSON.stringify(payload)),
        });
      }
    } finally {
      await runner.query(
        'DROP TEMPORARY TABLE IF EXISTS stage6_json_roundtrip',
      );
      await runner.release();
    }
  });

  it('preserves historical integer metrics through MySQL upgrade and compatible rollback', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      // A connection-local temporary table shadows only the metrics table.
      // Creation of the permanent replay tables was checked by the isolated runner.
      await runner.query(
        'CREATE TEMPORARY TABLE `match_player_stats` (`id` int PRIMARY KEY, `gold` int UNSIGNED NOT NULL, `gdAt15` smallint NOT NULL, `csdAt15` smallint NOT NULL)',
      );
      await runner.query(
        'INSERT INTO `match_player_stats` VALUES (1, 18543, -1234, 37), (2, 4294967295, 32767, -32768), (3, 0, -32768, 32767)',
      );
      const original: unknown = await runner.query(
        'SELECT * FROM `match_player_stats` ORDER BY id',
      );
      const migration = new TacticalReplays1789768800000();
      const adapter = {
        query: (sql: string): Promise<unknown> =>
          runner.query(sql) as Promise<unknown>,
        createTable: jest.fn().mockResolvedValue(undefined),
        dropTable: jest.fn().mockResolvedValue(undefined),
      };
      await migration.up(adapter as unknown as QueryRunner);
      expect(
        await runner.query('SELECT * FROM `match_player_stats` ORDER BY id'),
      ).toEqual(original);
      await runner.query(
        'INSERT INTO `match_player_stats` VALUES (4, 12.25, NULL, NULL)',
      );
      await expect(
        migration.down(adapter as unknown as QueryRunner),
      ).rejects.toThrow('without losing');
      expect(adapter.dropTable).not.toHaveBeenCalled();
      await runner.query('DELETE FROM `match_player_stats` WHERE id = 4');
      await migration.down(adapter as unknown as QueryRunner);
      expect(
        await runner.query('SELECT * FROM `match_player_stats` ORDER BY id'),
      ).toEqual(original);
    } finally {
      await runner.query('DROP TEMPORARY TABLE IF EXISTS `match_player_stats`');
      await runner.release();
    }
  });

  it('runs a real match, persists the same report, serves verified chunks and rejects duplicate/foreign writes', async () => {
    const api = request(app.getHttpServer());
    const register = async (name: string): Promise<AuthResult> => {
      const response = await api
        .post('/auth/register')
        .send({
          email: `${name}-${Date.now()}@example.com`,
          password: 'stage6-test-password',
          displayName: name,
        })
        .expect(201);
      return response.body as AuthResult;
    };
    const owner = await register('stage6-owner');
    const other = await register('stage6-other');
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [owner.account.id]);
    const theme = await db.manager.save(
      Theme,
      db.manager.create(Theme, { code: 'STAGE6_E2E', name: 'Stage 6 fixture' }),
    );
    const positions = Object.values(Position);
    const cards: PlayerCard[] = [];
    for (let i = 0; i < 10; i++) {
      const player = await db.manager.save(
        Player,
        db.manager.create(Player, {
          nickname: `Stage6_${i}`,
          nationality: 'KR',
        }),
      );
      cards.push(
        await db.manager.save(
          PlayerCard,
          db.manager.create(PlayerCard, {
            playerId: player.id,
            themeId: theme.id,
            cardYear: 2026,
            startingAge: 20,
            mainPosition: positions[i % 5],
            mechanics: 85,
            gameSense: 85,
            laning: 85,
            teamFight: 85,
            macro: 85,
            teamPlay: 85,
            mental: 85,
            championPool: 85,
            potential: 90,
          }),
        ),
      );
    }
    const careerResponse = await api
      .post('/careers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        startYear: 2026,
        managedTeamCode: 'STAGE6_A',
        teams: [0, 1].map((side) => ({
          code: side ? 'STAGE6_B' : 'STAGE6_A',
          name: `Stage6 ${side}`,
          region: Region.LCK,
          starters: positions.map((position, index) => ({
            position,
            playerCardId: cards[side * 5 + index].id,
          })),
        })),
      })
      .expect(201);
    const career = careerResponse.body as CareerResponseDto;
    await db.manager.update(
      CareerTeam,
      { careerId: career.id },
      { chemistry: 70 },
    );
    for (const team of career.teams) {
      await db.manager.update(
        CareerTeamStrategyProficiency,
        { careerTeamId: team.id, strategy: TeamStrategy.BALANCED },
        { proficiency: 70 },
      );
    }
    const body = {
      careerId: career.id,
      teamAId: career.teams[0].id,
      teamBId: career.teams[1].id,
      seed: 123,
    };
    const playerState = () =>
      db.manager.find(CareerPlayer, {
        where: { careerId: career.id },
        order: { id: 'ASC' },
      });
    const before = await playerState();
    await api.post('/matches/simulate').send(body).expect(401);
    await api
      .post('/matches/simulate')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send(body)
      .expect(404);

    const startedAt = performance.now();
    const running = api
      .post('/matches/simulate')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(body)
      .then((response) => response);
    // Do not use a mocked engine or inject a terminal winner/checkpoint.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await db.manager.existsBy(MatchTacticalRun, {
          careerId: career.id,
          status: 'RUNNING',
        })
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await api
      .post('/matches/simulate')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(body)
      .expect(409);
    const response = await running;
    expect({
      status: response.status,
      message: (response.body as { message?: string }).message,
    }).toEqual({ status: 201, message: undefined });
    const match = response.body as MatchSimulationResponseDto;
    expect(match.tacticalReplay).toBeTruthy();
    const storedRun = await db
      .getRepository(MatchTacticalRun)
      .createQueryBuilder('run')
      .addSelect('run.input')
      .where('run.matchId = :matchId', { matchId: match.matchId })
      .getOneOrFail();
    expect(storedRun.input?.rules.macroAi).toBe('COORDINATED_V2');
    const after = await playerState();
    expect(
      after.some((player, index) => player.condition < before[index].condition),
    ).toBe(true);

    const path = `/matches/${match.matchId}/tactical-run`;
    await api.get(path).expect(401);
    await api
      .get(path)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    const replayResponse = await api
      .get(path)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const replay = replayResponse.body as {
      status: string;
      manifest: TacticalReplayManifest;
    };
    expect(replay.status).toBe('FINISHED');
    const manifest = replay.manifest;
    expect(manifest.winnerTeamId).toBe(match.winnerTeamId);
    expect(manifest.report.winnerTeamId).toBe(match.winnerTeamId);
    expect(match.durationMinutes).toBeCloseTo(manifest.durationMs / 60_000, 8);
    const stats = await db.manager.find(MatchPlayerStat, {
      where: { matchId: match.matchId },
    });
    expect(stats).toHaveLength(10);
    for (const projected of manifest.report.players) {
      const stored = stats.find(
        (row) => row.careerPlayerId === projected.careerPlayerId,
      )!;
      expect(stored.kills).toBe(projected.kills);
      expect(stored.deaths).toBe(projected.deaths);
      expect(stored.assists).toBe(projected.assists);
      expect(stored.gold).toBeCloseTo(projected.goldEarned, 8);
      expect(stored.dpm).toBeCloseTo(projected.dpm, 8);
      expect(stored.gdAt15).toBe(projected.gdAt15);
    }
    expect(manifest.chunks.length).toBeGreaterThan(1);
    for (const descriptor of [manifest.chunks[0], manifest.chunks.at(-1)!]) {
      const chunkPath = `${path}/chunks/${descriptor.index}`;
      await api
        .get(chunkPath)
        .set('Authorization', `Bearer ${other.accessToken}`)
        .expect(404);
      const chunkResponse = await api
        .get(chunkPath)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      const chunk = chunkResponse.body as TacticalReplayChunk;
      expect(canonicalHash(chunk)).toBe(descriptor.hash);
      expect(chunk.inputHash).toBe(manifest.inputHash);
      if (descriptor.index === manifest.chunks.at(-1)!.index)
        expect(
          chunk.events.some((event) => event.kind === 'NEXUS_DESTROYED'),
        ).toBe(true);
    }
    await api
      .get(`${path}/chunks/${manifest.chunks.length}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
    const repeated = await api
      .post('/matches/simulate')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(body)
      .expect(201);
    expect((repeated.body as MatchSimulationResponseDto).matchId).toBe(
      match.matchId,
    );
    expect(await db.manager.countBy(Match, { careerId: career.id })).toBe(1);
    expect(
      await db.manager.countBy(MatchTacticalRun, { careerId: career.id }),
    ).toBe(1);
    expect(await playerState()).toEqual(after);
    const refreshed = await api
      .get(`/matches/${match.matchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(
      (refreshed.body as MatchSimulationResponseDto).tacticalReplay,
    ).toEqual(match.tacticalReplay);
    console.log(
      `Stage 6 API: actual nexus victory at ${match.durationMinutes.toFixed(2)} minutes; ${manifest.chunks.length} chunks, 10 persisted player reports, duplicate/ownership protection passed; ${((performance.now() - startedAt) / 1000).toFixed(1)}s wall time.`,
    );
  });
});
