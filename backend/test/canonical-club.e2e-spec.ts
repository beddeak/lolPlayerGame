import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import { CareerResponseDto } from '../src/careers/dto/career-response.dto';
import { ClubCatalogResponseDto } from '../src/clubs/dto/club-response.dto';
import { Club } from '../src/clubs/entities/club.entity';
import { ClubRoster } from '../src/clubs/entities/club-roster.entity';
import { Player } from '../src/players/entities/player.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { validateDevelopmentSeed } from '../src/database/seeds/development-seed.validation';
import { PLAYER_CARD_BASE_STAT_FIELDS } from '../src/players/constants/player-card.constants';
import { DEVELOPMENT_PLAYER_DEFAULTS } from '../src/database/seeds/development-seed.types';

const json = <T>(response: { body: unknown }): T => response.body as T;

describe('canonical seed to T1 career (isolated MySQL)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let accountId: number | undefined;
  const entities = [Club, PlayerCard, Player, Theme] as const;
  const beforeIds = new Map<unknown, Set<number>>();
  let safe = false;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    dataSource = app.get(DataSource);
    if (
      !/^lol_manager_e2e_[0-9]+_[0-9]+$/.test(
        String(dataSource.options.database),
      )
    ) {
      throw new Error(
        'Canonical catalog E2E requires npm run test:e2e:isolated',
      );
    }
    for (const entity of entities) {
      const rows = await dataSource.manager.find(entity, {
        select: { id: true },
      });
      beforeIds.set(entity, new Set(rows.map((row) => row.id)));
    }
    expect(await dataSource.getRepository(Club).count()).toBe(0);
    safe = true;
  });

  function seed() {
    const result = execFileSync(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js'),
        'src/database/seeds/development.seed.ts',
        '--catalog-only',
      ],
      {
        cwd: resolve(__dirname, '..'),
        env: {
          ...process.env,
          DB_DATABASE: String(dataSource.options.database),
        },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(result).toContain('Catalog ready:');
  }

  async function catalogSnapshot() {
    return Promise.all([
      dataSource.getRepository(Club).find({ order: { id: 'ASC' } }),
      dataSource.getRepository(ClubRoster).find({ order: { id: 'ASC' } }),
      dataSource.getRepository(PlayerCard).find({ order: { id: 'ASC' } }),
    ]);
  }

  it('imports the actual seed, starts T1 with its authored roster, and preserves the save on reimport', async () => {
    seed();
    const input = validateDevelopmentSeed(
      JSON.parse(
        readFileSync(
          resolve(__dirname, '../data/development-seed.json'),
          'utf8',
        ),
      ) as unknown,
    );
    const storedCards = await dataSource
      .getRepository(PlayerCard)
      .find({ relations: { player: true, theme: true } });
    expect(storedCards).toHaveLength(input.playerCards.length);
    for (const card of input.playerCards) {
      const stored = storedCards.find(
        (row) =>
          row.player.nickname === card.nickname &&
          row.player.nationality ===
            (card.nationality ?? DEVELOPMENT_PLAYER_DEFAULTS.nationality) &&
          row.theme.code === card.themeCode &&
          row.cardYear === card.cardYear,
      )!;
      expect(stored).toBeDefined();
      for (const stat of PLAYER_CARD_BASE_STAT_FIELDS)
        expect(stored[stat]).toBe(card[stat]);
      expect(stored.startingAge).toBe(
        card.startingAge ?? DEVELOPMENT_PLAYER_DEFAULTS.startingAge,
      );
    }
    const active = input.teams.filter((team) => team.enabled !== false);
    const t1 = active.find((team) => team.code === 'T1')!;
    expect(t1).toBeDefined();
    const auth = json<{ accessToken: string; account: { id: number } }>(
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `canonical-${Date.now()}-${process.pid}@example.com`,
          password: 'isolated-catalog-test-only',
          displayName: 'Canonical catalog test',
        })
        .expect(201),
    );
    accountId = auth.account.id;
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    const catalog = json<ClubCatalogResponseDto>(
      await request(app.getHttpServer()).get('/clubs').set(headers).expect(200),
    );
    expect(catalog.ready).toBe(true);
    expect(catalog.clubs).toHaveLength(active.length);
    expect(catalog.clubs.some((club) => /^DEV_/.test(club.code))).toBe(false);
    expect(catalog.clubs.find((club) => club.code === 'T1')?.selectable).toBe(
      true,
    );
    const career = json<CareerResponseDto>(
      await request(app.getHttpServer())
        .post('/careers/from-club')
        .set(headers)
        .send({ clubCode: 'T1' })
        .expect(201),
    );
    expect(career.teams).toHaveLength(active.length);
    const managed = career.teams.find((team) => team.isUserControlled)!;
    expect(managed.code).toBe('T1');
    for (const starter of t1.starters) {
      const card = input.playerCards.find(
        (item) => item.key === starter.playerCardKey,
      )!;
      const slot = managed.starters.find(
        (item) => item.starterPosition === starter.position,
      )!;
      expect(slot.careerPlayer.playerCard.player.nickname).toBe(card.nickname);
    }
    const before = await catalogSnapshot();
    seed();
    expect(await catalogSnapshot()).toEqual(before);
    expect(
      json<CareerResponseDto>(
        await request(app.getHttpServer())
          .get(`/careers/${career.id}`)
          .set(headers)
          .expect(200),
      ),
    ).toEqual(career);
  });

  afterAll(async () => {
    try {
      if (safe && dataSource?.isInitialized) {
        if (accountId)
          await dataSource.getRepository(Account).delete(accountId);
        // Only remove rows created by this test in its isolated database.
        // Clubs cascade their roster templates; saves were removed above.
        for (const entity of entities) {
          const rows = await dataSource.manager.find(entity, {
            select: { id: true },
          });
          const ids = rows
            .filter((row) => !beforeIds.get(entity)!.has(row.id))
            .map((row) => row.id);
          if (ids.length)
            await dataSource.manager.delete(entity, { id: In(ids) });
        }
      }
    } finally {
      if (app) await app.close();
    }
  });
});
