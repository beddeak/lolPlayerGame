import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import { Career } from '../src/careers/entities/career.entity';
import { CareerResponseDto } from '../src/careers/dto/career-response.dto';
import { Player } from '../src/players/entities/player.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { Position } from '../src/players/enums/position.enum';
import { LeaguesService } from '../src/leagues/leagues.service';
import { LeagueSplitResponseDto } from '../src/leagues/dto/league-split-response.dto';
import { LeagueSplitStatus } from '../src/leagues/enums/league-split-status.enum';
import { InternationalTournament } from '../src/internationals/entities/international-tournament.entity';
import { InternationalsService } from '../src/internationals/internationals.service';
import {
  InternationalKind,
  INTERNATIONAL_REGIONS,
} from '../src/internationals/tournament.types';
import { CalendarEvent } from '../src/event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../src/event-queue/enums/calendar-event-status.enum';

type View = Awaited<ReturnType<InternationalsService['findAll']>>;
describe('international season persistence (isolated MySQL, actual match simulation)', () => {
  jest.setTimeout(300_000);
  let app: INestApplication<App>,
    db: DataSource,
    token: string,
    otherToken: string;
  let career: CareerResponseDto, theme: Theme;
  let qualification: jest.SpyInstance;
  const accountIds: number[] = [],
    playerIds: number[] = [],
    cardIds: number[] = [];
  const tag = `intl_${Date.now()}_${process.pid}`;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const url = () => `/careers/${career.id}/internationals`;
  const view = async () =>
    (await api().get(url()).set(auth()).expect(200)).body as View;
  const setDate = (currentDate: string) =>
    db.manager.update(Career, career.id, { currentDate });

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
    for (const name of ['owner', 'other']) {
      const response = await api()
        .post('/auth/register')
        .send({
          email: `${tag}_${name}@example.com`,
          password: 'international-test-password',
          displayName: name,
        })
        .expect(201);
      const body = response.body as {
        account: { id: number };
        accessToken: string;
      };
      accountIds.push(body.account.id);
      if (name === 'owner') token = body.accessToken;
      else otherToken = body.accessToken;
    }
    app.get(ConfigService).set('CATALOG_ADMIN_ACCOUNT_IDS', [accountIds[0]]);
    theme = await db.manager.save(
      Theme,
      db.manager.create(Theme, { code: tag.toUpperCase(), name: tag }),
    );
    const teams: Array<{
      code: string;
      name: string;
      region: string;
      starters: Array<{ position: Position; playerCardId: number }>;
    }> = [];
    for (const region of INTERNATIONAL_REGIONS)
      for (
        let seed = 1;
        seed <= (['LCP', 'CBLOL'].includes(region) ? 8 : 5);
        seed++
      ) {
        const starters: Array<{ position: Position; playerCardId: number }> =
          [];
        for (const position of Object.values(Position)) {
          const player = await db.manager.save(
            Player,
            db.manager.create(Player, {
              nickname: `${tag}_${region}_${seed}_${position}`,
              nationality: 'KR',
            }),
          );
          playerIds.push(player.id);
          const card = await db.manager.save(
            PlayerCard,
            db.manager.create(PlayerCard, {
              playerId: player.id,
              themeId: theme.id,
              cardYear: 2026,
              startingAge: 20,
              mainPosition: position,
              mechanics: 80,
              gameSense: 80,
              laning: 80,
              teamFight: 80,
              macro: 80,
              teamPlay: 80,
              mental: 80,
              championPool: 80,
              potential: 100,
            }),
          );
          cardIds.push(card.id);
          starters.push({ position, playerCardId: card.id });
        }
        teams.push({
          code: `${region}_${seed}`,
          name: `${region} ${seed}`,
          region,
          starters,
        });
      }
    career = (
      await api()
        .post('/careers')
        .set(auth())
        .send({ startYear: 2026, managedTeamCode: 'LCK_1', teams })
        .expect(201)
    ).body as CareerResponseDto;
  });
  afterAll(async () => {
    qualification?.mockRestore();
    if (accountIds.length)
      await db.manager.delete(Account, { id: In(accountIds) });
    if (cardIds.length)
      await db.manager.delete(PlayerCard, { id: In(cardIds) });
    if (playerIds.length)
      await db.manager.delete(Player, { id: In(playerIds) });
    if (theme) await db.manager.delete(Theme, theme.id);
    await app?.close();
  });

  it('is read-only, refuses foreign ownership, and never fabricates qualifiers', async () => {
    await api().get(url()).expect(401);
    await api()
      .get(url())
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    const before = await db.manager.countBy(InternationalTournament, {
      careerId: career.id,
    });
    expect((await view()).readiness.every((item) => !item.ready)).toBe(true);
    await setDate('2026-03-09');
    await api().post(`${url()}/FIRST_STAND`).set(auth()).expect(409);
    expect(
      await db.manager.countBy(InternationalTournament, {
        careerId: career.id,
      }),
    ).toBe(before);
  });

  it.each([
    InternationalKind.FIRST_STAND,
    InternationalKind.MSI,
    InternationalKind.WORLDS,
  ])(
    '%s persists every real BO series through the final and rejects replay/bypass',
    async (kind) => {
      // Qualification history is a fixture; tournament, calendar and match writes are real.
      qualification ??= jest.spyOn(
        app.get(LeaguesService),
        'qualificationSplits',
      );
      qualification.mockResolvedValue(
        INTERNATIONAL_REGIONS.flatMap((region) =>
          [1, 2, 3].map((splitNumber) => {
            const members = career.teams.filter(
              (team) => String(team.region) === region,
            );
            const standings = members.map((team, index) => ({
              rank: index + 1,
              teamId: team.id,
              seriesWins: index < 4 ? 3 : 1,
              seriesLosses: index < 4 ? 1 : 3,
              gameDifference: 8 - index,
            }));
            return {
              region,
              splitNumber,
              status: LeagueSplitStatus.COMPLETED,
              standings,
              stages: [
                { code: 'REGULAR', standings, fixtures: [] },
                {
                  code: 'PLAYOFFS',
                  standings,
                  participants: members.map((team) => ({ teamId: team.id })),
                },
              ],
            } as unknown as LeagueSplitResponseDto;
          }),
        ),
      );
      const preparation = {
        FIRST_STAND: '03-09',
        MSI: '06-22',
        WORLDS: '10-08',
      }[kind];
      await setDate(`2026-${preparation}`);
      const created = (
        await api().post(`${url()}/${kind}`).set(auth()).expect(201)
      ).body as View;
      let tournament = created.tournaments.find(
        (value) => value.kind === kind,
      )!;
      expect(tournament).toBeDefined();
      const id = tournament.id;
      const repeated = (
        await api().post(`${url()}/${kind}`).set(auth()).expect(201)
      ).body as View;
      expect(
        repeated.tournaments.filter((value) => value.kind === kind),
      ).toHaveLength(1);
      const initial = tournament.fixtures.find((fixture) => fixture.id)!;
      await api()
        .post(`${url()}/${id}/fixtures/${initial.id}/simulate`)
        .set(auth())
        .expect(409);
      await api()
        .post(`${url()}/${id}/roster`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await api().post(`${url()}/${id}/roster`).set(auth()).expect(201);
      await api()
        .post(`${url()}/${id}/fixtures/${initial.id}/simulate`)
        .set(auth())
        .expect(409);
      let count = 0;
      while (!tournament.championTeamId) {
        const next = tournament.fixtures
          .filter((game) => game.id && !game.winnerTeamId)
          .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
        expect(next).toBeDefined();
        await setDate(next.scheduledDate);
        if (count === 0) {
          const event = await db.manager.findOneByOrFail(CalendarEvent, {
            careerId: career.id,
            status: CalendarEventStatus.SCHEDULED,
          });
          await api()
            .post(`/careers/${career.id}/events/${event.id}/resolve`)
            .set(auth())
            .expect(409);
          const advance = await api()
            .post(`/careers/${career.id}/calendar/advance`)
            .set(auth())
            .send({ mode: 'ONE_DAY' })
            .expect(201);
          expect((advance.body as { currentDate: string }).currentDate).toBe(
            next.scheduledDate,
          );
        }
        const response = await api()
          .post(`${url()}/${id}/fixtures/${next.id}/simulate`)
          .set(auth())
          .expect(201);
        tournament = (response.body as View).tournaments.find(
          (value) => value.id === id,
        )!;
        const completed = tournament.fixtures.find(
          (game) => game.id === next.id,
        )!;
        expect(completed.winnerTeamId).not.toBeNull();
        expect(Math.max(completed.teamAWins, completed.teamBWins)).toBe(
          Math.floor(completed.bestOf / 2) + 1,
        );
        if (count++ === 0) {
          await api()
            .post(`/match-series/${completed.seriesId}/games/simulate`)
            .set(auth())
            .expect(409);
          const retry = (
            await api()
              .post(`${url()}/${id}/fixtures/${next.id}/simulate`)
              .set(auth())
              .expect(201)
          ).body as View;
          expect(
            retry.tournaments.find((value) => value.id === id)!.fixtures,
          ).toEqual(tournament.fixtures);
        }
        expect(count).toBeLessThan(65);
      }
      expect(count).toBe(
        kind === InternationalKind.FIRST_STAND
          ? 13
          : kind === InternationalKind.MSI
            ? 20
            : 46,
      );
      expect(
        (await view()).tournaments.find((value) => value.id === id)!
          .championTeamId,
      ).toBe(tournament.championTeamId);
    },
  );
});
