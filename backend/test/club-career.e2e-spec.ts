import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, EntitySubscriberInterface, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import {
  CareerResponseDto,
  CareerSummaryResponseDto,
} from '../src/careers/dto/career-response.dto';
import { Career } from '../src/careers/entities/career.entity';
import { CareerPlayer } from '../src/careers/entities/career-player.entity';
import { CareerPlayerPositionProficiency } from '../src/careers/entities/career-player-position-proficiency.entity';
import { CareerPlayerRoleProficiency } from '../src/careers/entities/career-player-role-proficiency.entity';
import { CareerTeam } from '../src/careers/entities/career-team.entity';
import { CareerTeamStrategyProficiency } from '../src/careers/entities/career-team-strategy-proficiency.entity';
import { Roster } from '../src/careers/entities/roster.entity';
import { ChampionArchetype } from '../src/careers/enums/champion-archetype.enum';
import { Region } from '../src/careers/enums/region.enum';
import { RosterRole } from '../src/careers/enums/roster-role.enum';
import { TeamStrategy } from '../src/careers/enums/team-strategy.enum';
import { Club } from '../src/clubs/entities/club.entity';
import { ClubRoster } from '../src/clubs/entities/club-roster.entity';
import {
  ClubSeedData,
  seedClubCatalog,
} from '../src/database/seeds/club-catalog.seed';
import { PlayerCardResponseDto } from '../src/players/dto/player-card-response.dto';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
import { Position } from '../src/players/enums/position.enum';

interface AuthResult {
  accessToken: string;
  account: { id: number };
}

interface CatalogResult {
  startYear: number;
  worldTeamCount: number;
  ready: boolean;
  unavailableReason: string | null;
  clubs: Array<{
    code: string;
    name: string;
    region: Region;
    logoUrl: string | null;
    selectable: boolean;
    unavailableReason: string | null;
    startingStrength: number | null;
    starters: Array<{ position: Position; playerCard: PlayerCardResponseDto }>;
    benches: Array<{ playerCard: PlayerCardResponseDto }>;
  }>;
}

const json = <T>(response: { body: unknown }): T => response.body as T;

describe('official club catalog and server-owned career initialization (e2e)', () => {
  jest.setTimeout(120_000);
  const key = `club_${Date.now()}_${process.pid}`;
  const positions = Object.values(Position);
  const regions = [Region.LCK, Region.LPL, Region.LEC, Region.LCS];
  const accountIds: number[] = [];
  const clubs: Club[] = [];
  const rosterTemplates: ClubRoster[] = [];
  const players: Player[] = [];
  const cards: PlayerCard[] = [];
  let themeId: number;
  let disabledClub: Club;
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let adminToken: string;
  let isolatedDatabaseVerified = false;
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
    // This suite intentionally changes catalog templates to test bad setup.
    // Refuse every write unless the existing isolated runner created the DB.
    const database = String(dataSource.options.database ?? '');
    if (!/^lol_manager_e2e_[0-9]+_[0-9]+$/.test(database)) {
      throw new Error('Club E2E requires npm run test:e2e:isolated');
    }
    isolatedDatabaseVerified = true;
    expect(await dataSource.getRepository(Club).count()).toBe(0);

    const tokens: string[] = [];
    for (const suffix of ['owner', 'other', 'admin']) {
      const account = json<AuthResult>(
        await api()
          .post('/auth/register')
          .send({
            email: `${key}_${suffix}@example.com`,
            password: 'official-club-e2e-password',
            displayName: `Club ${suffix}`,
          })
          .expect(201),
      );
      accountIds.push(account.account.id);
      tokens.push(account.accessToken);
    }
    [ownerToken, otherToken, adminToken] = tokens;
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accountIds[2]]);

    const theme = await dataSource.getRepository(Theme).save({
      code: key.toUpperCase(),
      name: 'Official club E2E catalog',
      description: 'Generated fixture, never development data',
      legendEnabled: false,
    });
    themeId = theme.id;
    players.push(
      ...(await dataSource.getRepository(Player).save(
        Array.from({ length: 57 }, (_, index) => ({
          nickname: `${key}_${index}`,
          nationality: 'KR',
        })),
      )),
    );
    cards.push(
      ...(await dataSource.getRepository(PlayerCard).save(
        players.map((player, index) => ({
          playerId: player.id,
          themeId,
          cardYear: 2026,
          startingAge: 20 + (index % 5),
          imageUrl: `/e2e/${key}/${index}.svg`,
          mainPosition: positions[(index % 7) % positions.length],
          mechanics: 70 + (index % 10),
          gameSense: 71,
          laning: 72,
          teamFight: 73,
          macro: 74,
          teamPlay: 75,
          mental: 76,
          championPool: 77,
          personality: PlayerPersonality.PROFESSIONAL,
          potential: 98,
        })),
      )),
    );
    // A different card year for the same real player must not allow duplicates.
    cards.push(
      await dataSource.getRepository(PlayerCard).save({
        ...cards[0],
        id: undefined,
        cardYear: 2025,
      }),
    );
    clubs.push(
      ...(await dataSource.getRepository(Club).save(
        regions.flatMap((region, regionIndex) =>
          [0, 1].map((clubIndex) => ({
            code: `C${Date.now()}_${process.pid}_${regionIndex * 2 + clubIndex}`,
            name: `${region} Official ${clubIndex + 1}`,
            region,
            logoUrl: clubIndex === 0 ? `/e2e/${key}/${region}.svg` : null,
            enabled: true,
            initialChemistry: 60 + regionIndex * 2 + clubIndex,
          })),
        ),
      )),
    );
    disabledClub = await dataSource.getRepository(Club).save({
      code: `D${Date.now()}_${process.pid}`,
      name: 'Disabled official club',
      region: Region.LCK,
      logoUrl: null,
      enabled: false,
      initialChemistry: null,
    });
    rosterTemplates.push(
      ...(await dataSource.getRepository(ClubRoster).save(
        clubs.flatMap((club, clubIndex) =>
          Array.from({ length: 7 }, (_, index) => ({
            clubId: club.id,
            playerCardId: cards[clubIndex * 7 + index].id,
            role: index < 5 ? RosterRole.STARTER : RosterRole.BENCH,
            position: index < 5 ? positions[index] : null,
            championArchetype: index === 0 ? ChampionArchetype.TOP_TANK : null,
            initialCoachTrust: index === 0 ? 65 : null,
            initialForm: index === 0 ? 55 : null,
          })),
        ),
      )),
    );
  });

  async function catalog(token = ownerToken): Promise<CatalogResult> {
    return json<CatalogResult>(
      await api().get('/clubs').set(auth(token)).expect(200),
    );
  }

  async function createCareer(
    token = ownerToken,
    clubCode = clubs[0].code,
  ): Promise<CareerResponseDto> {
    return json<CareerResponseDto>(
      await api()
        .post('/careers/from-club')
        .set(auth(token))
        .send({ clubCode })
        .expect(201),
    );
  }

  async function loadCareer(id: number, token = ownerToken) {
    return json<CareerResponseDto>(
      await api().get(`/careers/${id}`).set(auth(token)).expect(200),
    );
  }

  async function persistenceCounts(): Promise<number[]> {
    return Promise.all(
      [
        Career,
        CareerTeam,
        CareerPlayer,
        Roster,
        CareerTeamStrategyProficiency,
        CareerPlayerPositionProficiency,
        CareerPlayerRoleProficiency,
      ].map((entity) => dataSource.getRepository(entity).count()),
    );
  }

  async function catalogSnapshot() {
    return Promise.all([
      dataSource.getRepository(Club).find({ order: { id: 'ASC' } }),
      dataSource.getRepository(ClubRoster).find({ order: { id: 'ASC' } }),
      dataSource.getRepository(PlayerCard).find({
        where: { id: In(cards.map((card) => card.id)) },
        order: { id: 'ASC' },
      }),
    ]);
  }

  it('requires JWT and exposes the same read-only public catalog to ordinary accounts', async () => {
    await api().get('/clubs').expect(401);
    await api()
      .post('/careers/from-club')
      .send({ clubCode: clubs[0].code })
      .expect(401);
    const before = await catalogSnapshot();
    const counts = await persistenceCounts();
    const result = await catalog();
    expect(await catalog(otherToken)).toEqual(result);
    expect(result).toMatchObject({
      startYear: 2026,
      worldTeamCount: 8,
      ready: true,
      unavailableReason: null,
    });
    for (const [clubIndex, club] of clubs.entries()) {
      const preview = result.clubs.find((item) => item.code === club.code)!;
      expect(preview).toMatchObject({
        code: club.code,
        name: club.name,
        region: club.region,
        logoUrl: club.logoUrl,
        selectable: true,
        unavailableReason: null,
      });
      expect(preview.startingStrength).toEqual(expect.any(Number));
      expect(preview.starters.map((slot) => slot.position)).toEqual(positions);
      expect(preview.starters.map((slot) => slot.playerCard.id)).toEqual(
        cards.slice(clubIndex * 7, clubIndex * 7 + 5).map((card) => card.id),
      );
      expect(preview.benches.map((slot) => slot.playerCard.id)).toEqual(
        cards
          .slice(clubIndex * 7 + 5, clubIndex * 7 + 7)
          .map((card) => card.id),
      );
    }
    expect(
      result.clubs.find((item) => item.code === disabledClub.code),
    ).toBeUndefined();
    expect(result.clubs).toHaveLength(result.worldTeamCount);
    expect(JSON.stringify(result)).not.toMatch(/potential/i);
    expect(await catalogSnapshot()).toEqual(before);
    expect(await persistenceCounts()).toEqual(counts);
  });

  it('creates all enabled clubs, exact starters/benches and copied player state in one owned career', async () => {
    const before = await catalogSnapshot();
    const career = await createCareer(ownerToken, clubs[3].code);
    expect(career).toMatchObject({
      startYear: 2026,
      currentYear: 2026,
      currentDate: '2026-01-01',
    });
    expect(career.teams).toHaveLength(8);
    expect(career.teams.filter((team) => team.isUserControlled)).toEqual([
      expect.objectContaining({ code: clubs[3].code }),
    ]);
    for (const region of regions) {
      expect(
        career.teams.filter((team) => team.region === region),
      ).toHaveLength(2);
    }
    for (const [clubIndex, club] of clubs.entries()) {
      const team = career.teams.find((item) => item.code === club.code)!;
      expect(team).toMatchObject({
        clubCode: club.code,
        name: club.name,
        region: club.region,
        logoUrl: club.logoUrl,
        chemistry: club.initialChemistry,
      });
      expect(team.starters.map((slot) => slot.starterPosition)).toEqual(
        positions,
      );
      expect(
        team.starters.map((slot) => slot.careerPlayer.playerCardId),
      ).toEqual(
        cards.slice(clubIndex * 7, clubIndex * 7 + 5).map((card) => card.id),
      );
      expect(
        team.benches.map((slot) => slot.careerPlayer.playerCardId),
      ).toEqual(
        cards
          .slice(clubIndex * 7 + 5, clubIndex * 7 + 7)
          .map((card) => card.id),
      );
      for (const [index, slot] of [
        ...team.starters,
        ...team.benches,
      ].entries()) {
        const card = cards[clubIndex * 7 + index];
        expect(slot).toMatchObject({
          role: index < 5 ? RosterRole.STARTER : RosterRole.BENCH,
          starterPosition: index < 5 ? positions[index] : null,
          championArchetype: index === 0 ? ChampionArchetype.TOP_TANK : null,
        });
        expect(slot.careerPlayer).toMatchObject({
          currentTeamId: team.id,
          currentAge: card.startingAge,
          currentPosition: card.mainPosition,
          currentMechanics: card.mechanics,
          currentGameSense: card.gameSense,
          currentLaning: card.laning,
          currentTeamFight: card.teamFight,
          currentMacro: card.macro,
          currentTeamPlay: card.teamPlay,
          currentMental: card.mental,
          currentChampionPool: card.championPool,
          personality: card.personality,
          coachTrust: index === 0 ? 65 : 50,
          form: index === 0 ? 55 : 50,
          condition: 100,
        });
      }
    }
    expect(
      await dataSource.getRepository(Career).findOneByOrFail({ id: career.id }),
    ).toMatchObject({ accountId: accountIds[0], autoSchedule: true });
    expect(
      await dataSource
        .getRepository(CareerPlayer)
        .countBy({ careerId: career.id }),
    ).toBe(56);
    expect(JSON.stringify(career)).not.toMatch(/potential/i);
    expect(await loadCareer(career.id)).toEqual(career);
    expect(await catalogSnapshot()).toEqual(before);
  });

  it('accepts 119 stats through HTTP and career setup but rejects values outside the shared limit', async () => {
    const repository = dataSource.getRepository(PlayerCard);
    const body = {
      playerId: players[0].id,
      themeId,
      cardYear: 2024,
      startingAge: 20,
      mainPosition: Position.TOP,
      mechanics: 119,
      gameSense: 119,
      laning: 119,
      teamFight: 119,
      macro: 119,
      teamPlay: 119,
      mental: 119,
      championPool: 119,
      potential: 119,
    };
    const stats = [
      'mechanics',
      'gameSense',
      'laning',
      'teamFight',
      'macro',
      'teamPlay',
      'mental',
      'championPool',
      'potential',
    ] as const;
    const beforeCount = await repository.count();
    for (const field of stats) {
      await api()
        .post('/player-cards')
        .set(auth(adminToken))
        .send({ ...body, [field]: 120 })
        .expect(400);
    }
    for (const mechanics of [-1, 1.5, 256, 999]) {
      await api()
        .post('/player-cards')
        .set(auth(adminToken))
        .send({ ...body, mechanics })
        .expect(400);
    }
    expect(await repository.count()).toBe(beforeCount);
    const created = json<PlayerCardResponseDto>(
      await api()
        .post('/player-cards')
        .set(auth(adminToken))
        .send(body)
        .expect(201),
    );
    const saved = await repository.findOneByOrFail({ id: created.id });
    cards.push(saved);
    expect(created).not.toHaveProperty('potential');
    expect(saved.potential).toBe(119);
    await expect(
      repository.update(saved.id, { mechanics: 120 }),
    ).rejects.toThrow();
    await expect(
      repository.save({ ...saved, potential: 120 }),
    ).rejects.toThrow();
    expect(await repository.findOneByOrFail({ id: saved.id })).toEqual(saved);

    const slot = rosterTemplates[0];
    try {
      await dataSource.getRepository(ClubRoster).update(slot.id, {
        playerCardId: saved.id,
      });
      const career = await createCareer();
      const top = career.teams
        .find((team) => team.code === clubs[0].code)!
        .starters.find(
          (entry) => entry.starterPosition === Position.TOP,
        )!.careerPlayer;
      expect(top).toMatchObject({
        currentMechanics: 119,
        currentGameSense: 119,
        currentLaning: 119,
        currentTeamFight: 119,
        currentMacro: 119,
        currentTeamPlay: 119,
        currentMental: 119,
        currentChampionPool: 119,
      });
      await expect(
        dataSource
          .getRepository(CareerPlayer)
          .update(top.id, { currentMechanics: 120 }),
      ).rejects.toThrow();
      expect(
        (
          await dataSource
            .getRepository(CareerPlayer)
            .findOneByOrFail({ id: top.id })
        ).currentMechanics,
      ).toBe(119);
    } finally {
      await dataSource.getRepository(ClubRoster).save(slot);
    }
  });

  it('rejects forged world, year, owner and player selection fields before saving', async () => {
    const before = await persistenceCounts();
    for (const body of [
      {},
      { clubCode: '' },
      { clubCode: 123 },
      { clubCode: clubs[0].code, teams: [] },
      { clubCode: clubs[0].code, startYear: 2027 },
      { clubCode: clubs[0].code, managedTeamCode: clubs[1].code },
      { clubCode: clubs[0].code, accountId: accountIds[1] },
      { clubCode: clubs[0].code, playerCardIds: [cards[56].id] },
    ]) {
      await api().post('/careers/from-club').set(auth()).send(body).expect(400);
    }
    expect(await persistenceCounts()).toEqual(before);
  });

  it('returns 404 for unknown clubs and 409 for disabled clubs without saving', async () => {
    const before = await persistenceCounts();
    await api()
      .post('/careers/from-club')
      .set(auth())
      .send({ clubCode: 'UNKNOWN_CLUB' })
      .expect(404);
    await api()
      .post('/careers/from-club')
      .set(auth())
      .send({ clubCode: disabledClub.code })
      .expect(409);
    expect(await persistenceCounts()).toEqual(before);
  });

  it('blocks incomplete opponent templates and reports the unavailable world', async () => {
    const slot = rosterTemplates.find(
      (item) =>
        item.clubId === clubs[7].id && item.position === Position.SUPPORT,
    )!;
    const before = await persistenceCounts();
    try {
      await dataSource.getRepository(ClubRoster).delete(slot.id);
      const result = await catalog();
      expect(result.ready).toBe(false);
      expect(result.unavailableReason).toEqual(expect.any(String));
      expect(result.clubs.every((club) => !club.selectable)).toBe(true);
      await api()
        .post('/careers/from-club')
        .set(auth())
        .send({ clubCode: clubs[0].code })
        .expect(409);
      expect(await persistenceCounts()).toEqual(before);
    } finally {
      await dataSource.getRepository(ClubRoster).save(slot);
    }
  });

  it('rejects the same real player on two clubs even when their cards differ', async () => {
    const slot = rosterTemplates[7];
    const before = await persistenceCounts();
    try {
      await dataSource.getRepository(ClubRoster).update(slot.id, {
        playerCardId: cards[57].id,
      });
      expect((await catalog()).ready).toBe(false);
      await api()
        .post('/careers/from-club')
        .set(auth())
        .send({ clubCode: clubs[0].code })
        .expect(409);
      expect(await persistenceCounts()).toEqual(before);
    } finally {
      await dataSource.getRepository(ClubRoster).save(slot);
    }
  });

  it('enforces catalog foreign keys and rejects invalid initial player settings', async () => {
    const slot = rosterTemplates[0];
    const before = await persistenceCounts();
    await expect(
      dataSource.getRepository(ClubRoster).update(slot.id, {
        playerCardId: 2147483647,
      }),
    ).rejects.toMatchObject({
      driverError: { code: 'ER_NO_REFERENCED_ROW_2' },
    });
    try {
      await dataSource.getRepository(ClubRoster).update(slot.id, {
        initialForm: 101,
      });
      expect((await catalog()).ready).toBe(false);
      await api()
        .post('/careers/from-club')
        .set(auth())
        .send({ clubCode: clubs[0].code })
        .expect(409);
      expect(await persistenceCounts()).toEqual(before);
    } finally {
      await dataSource.getRepository(ClubRoster).save(slot);
    }
  });

  it('keeps accounts and repeated saves independent when the same club is selected', async () => {
    const beforeCatalog = await catalogSnapshot();
    const first = await createCareer();
    const second = await createCareer(otherToken);
    const third = await createCareer();
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    const firstIds = new Set(
      first.teams.flatMap((team) =>
        [...team.starters, ...team.benches].map((slot) => slot.careerPlayer.id),
      ),
    );
    expect(
      second.teams
        .flatMap((team) => [...team.starters, ...team.benches])
        .every((slot) => !firstIds.has(slot.careerPlayer.id)),
    ).toBe(true);
    await api().get(`/careers/${first.id}`).set(auth(otherToken)).expect(404);
    await api().get(`/careers/${second.id}`).set(auth()).expect(404);
    const otherSaves = json<CareerSummaryResponseDto[]>(
      await api().get('/careers').set(auth(otherToken)).expect(200),
    );
    expect(otherSaves.map((item) => item.id)).toEqual([second.id]);
    const managed = first.teams.find((team) => team.isUserControlled)!;
    const strategyPath = `/careers/${first.id}/teams/${managed.id}/strategy`;
    await api()
      .patch(strategyPath)
      .set(auth(otherToken))
      .send({ strategy: TeamStrategy.TOP_CARRY })
      .expect(404);
    await api()
      .patch(strategyPath)
      .set(auth())
      .send({ strategy: TeamStrategy.TOP_CARRY })
      .expect(200);
    await api()
      .patch(`/careers/${first.id}/teams/${managed.id}/starters/TOP/swap`)
      .set(auth())
      .send({ benchCareerPlayerId: managed.benches[0].careerPlayer.id })
      .expect(200);
    const changed = await loadCareer(first.id);
    const changedManaged = changed.teams.find(
      (team) => team.id === managed.id,
    )!;
    expect(changedManaged.teamStrategy).toBe(TeamStrategy.TOP_CARRY);
    expect(
      changedManaged.starters.find(
        (slot) => slot.starterPosition === Position.TOP,
      )?.careerPlayer.id,
    ).toBe(managed.benches[0].careerPlayer.id);
    expect(await loadCareer(second.id, otherToken)).toEqual(second);
    expect(await loadCareer(third.id)).toEqual(third);
    expect(await catalogSnapshot()).toEqual(beforeCatalog);
  });

  it('keeps existing official and admin custom saves intact after catalog edits', async () => {
    const official = await createCareer();
    const customBody = {
      startYear: 2026,
      managedTeamCode: clubs[0].code,
      teams: clubs.slice(0, 2).map((club, clubIndex) => ({
        code: club.code,
        name: club.name,
        region: club.region,
        starters: positions.map((position, index) => ({
          position,
          playerCardId: cards[clubIndex * 7 + index].id,
        })),
      })),
    };
    await api().post('/careers').send(customBody).expect(401);
    await api().post('/careers').set(auth()).send(customBody).expect(403);
    const custom = json<CareerResponseDto>(
      await api()
        .post('/careers')
        .set(auth(adminToken))
        .send(customBody)
        .expect(201),
    );
    const club = clubs[0];
    const top = rosterTemplates[0];
    const bench = rosterTemplates[5];
    try {
      await dataSource.getRepository(Club).update(club.id, {
        name: 'Updated catalog name',
        initialChemistry: 87,
      });
      await dataSource.getRepository(ClubRoster).update(top.id, {
        initialCoachTrust: 88,
        initialForm: 67,
        championArchetype: ChampionArchetype.TOP_SIDE_LANE,
      });
      await dataSource.getRepository(ClubRoster).update(bench.id, {
        playerCardId: cards[56].id,
      });
      expect(await loadCareer(official.id)).toEqual(official);
      expect(await loadCareer(custom.id, adminToken)).toEqual(custom);
      const next = await createCareer();
      const nextManaged = next.teams.find((team) => team.isUserControlled)!;
      expect(nextManaged).toMatchObject({
        name: 'Updated catalog name',
        chemistry: 87,
      });
      expect(nextManaged.starters[0]).toMatchObject({
        championArchetype: ChampionArchetype.TOP_SIDE_LANE,
        careerPlayer: { coachTrust: 88, form: 67 },
      });
      expect(
        nextManaged.benches.map((slot) => slot.careerPlayer.playerCardId),
      ).toContain(cards[56].id);
      expect(
        nextManaged.benches.map((slot) => slot.careerPlayer.playerCardId),
      ).not.toContain(bench.playerCardId);
    } finally {
      await dataSource.getRepository(Club).save(club);
      await dataSource.getRepository(ClubRoster).save([top, bench]);
    }
  });

  it('repeats catalog seeding without duplicate rows and preserves saves when definitions change', async () => {
    const career = await createCareer();
    const before = await catalogSnapshot();
    const cardMap = new Map(cards.map((card) => [String(card.id), card]));
    const definitions: ClubSeedData[] = clubs.map((club, clubIndex) => ({
      code: club.code,
      name: club.name,
      region: club.region,
      enabled: true,
      logoUrl: club.logoUrl,
      initialChemistry: club.initialChemistry ?? undefined,
      starters: positions.map((position, index) => ({
        position,
        playerCardKey: String(cards[clubIndex * 7 + index].id),
        championArchetype: index === 0 ? ChampionArchetype.TOP_TANK : undefined,
        initialCoachTrust: index === 0 ? 65 : undefined,
      })),
      benches: [5, 6].map((index) => ({
        playerCardKey: String(cards[clubIndex * 7 + index].id),
      })),
    }));
    const seed = (data: ClubSeedData[]) =>
      dataSource.transaction((manager) =>
        seedClubCatalog(manager, data, cardMap),
      );
    try {
      expect(await seed(definitions)).toBe(8);
      const seeded = await catalogSnapshot();
      expect(await seed(definitions)).toBe(8);
      // Identical imports retain primary keys as well as row counts and values.
      expect(await catalogSnapshot()).toEqual(seeded);
      expect(await loadCareer(career.id)).toEqual(career);

      const changed = structuredClone(definitions);
      changed[0].name = 'Seeded replacement club name';
      changed[0].benches![0].playerCardKey = String(cards[56].id);
      expect(await seed(changed)).toBe(8);
      expect(await loadCareer(career.id)).toEqual(career);
      const newCareer = await createCareer();
      const managed = newCareer.teams.find((team) => team.isUserControlled)!;
      expect(managed.name).toBe('Seeded replacement club name');
      expect(
        managed.benches.map((slot) => slot.careerPlayer.playerCardId),
      ).toContain(cards[56].id);

      // Removing a definition disables its catalog club; existing saves retain it.
      expect(await seed(changed.slice(0, -1))).toBe(7);
      expect(
        await dataSource
          .getRepository(Club)
          .findOneByOrFail({ id: clubs[7].id }),
      ).toMatchObject({ enabled: false });
      expect(await loadCareer(career.id)).toEqual(career);
      expect(await loadCareer(newCareer.id)).toEqual(newCareer);
    } finally {
      await dataSource.transaction(async (manager) => {
        await manager.delete(ClubRoster, {
          clubId: In(clubs.map((club) => club.id)),
        });
        await manager.save(Club, clubs);
        await manager.save(ClubRoster, rosterTemplates);
      });
    }
    expect(await catalogSnapshot()).toEqual(before);
  });

  it('rolls back career, teams and all dependent rows on a real MySQL save failure', async () => {
    const beforeCounts = await persistenceCounts();
    const beforeCatalog = await catalogSnapshot();
    let injected = false;
    let createdTeamCount = 0;
    const subscriber: EntitySubscriberInterface<CareerPlayer> = {
      listenTo: () => CareerPlayer,
      async beforeInsert(event) {
        if (injected) return;
        injected = true;
        createdTeamCount = await event.manager.countBy(CareerTeam, {
          careerId: event.entity.careerId,
        });
        // Exercise the actual MySQL foreign key after career/teams were saved.
        event.entity.currentTeamId = 2147483647;
        event.entity.currentTeam = { id: 2147483647 } as CareerTeam;
      },
    };
    dataSource.subscribers.push(subscriber);
    try {
      await api()
        .post('/careers/from-club')
        .set(auth())
        .send({ clubCode: clubs[0].code })
        .expect(500);
    } finally {
      const index = dataSource.subscribers.indexOf(subscriber);
      if (index >= 0) dataSource.subscribers.splice(index, 1);
    }
    expect(injected).toBe(true);
    expect(createdTeamCount).toBe(8);
    expect(await persistenceCounts()).toEqual(beforeCounts);
    expect(await catalogSnapshot()).toEqual(beforeCatalog);
    expect((await createCareer()).teams).toHaveLength(8);
  });

  afterAll(async () => {
    try {
      if (isolatedDatabaseVerified && dataSource?.isInitialized) {
        if (accountIds.length) {
          await dataSource
            .getRepository(Account)
            .delete({ id: In(accountIds) });
        }
        const clubIds = [
          ...clubs.map((club) => club.id),
          disabledClub?.id,
        ].filter((id): id is number => typeof id === 'number');
        if (clubIds.length) {
          await dataSource.getRepository(Club).delete({ id: In(clubIds) });
        }
        if (cards.length) {
          await dataSource.getRepository(PlayerCard).delete({
            id: In(cards.map((card) => card.id)),
          });
        }
        if (players.length) {
          await dataSource.getRepository(Player).delete({
            id: In(players.map((player) => player.id)),
          });
        }
        if (themeId) await dataSource.getRepository(Theme).delete(themeId);
      }
    } finally {
      if (app) await app.close();
    }
  });
});
