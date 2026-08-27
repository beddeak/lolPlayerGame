import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { configureApplication } from '../src/application.setup';
import { AppModule } from '../src/app.module';
import { Account } from '../src/auth/entities/account.entity';
import { Career } from '../src/careers/entities/career.entity';
import { PlayerInstruction } from '../src/careers/enums/player-instruction.enum';
import { Region } from '../src/careers/enums/region.enum';
import { TeamStrategy } from '../src/careers/enums/team-strategy.enum';
import { ChampionArchetype } from '../src/careers/enums/champion-archetype.enum';
import { MatchSeries } from '../src/match-series/entities/match-series.entity';
import { MatchSeriesStatus } from '../src/match-series/enums/match-series-status.enum';
import { MatchPlayerStat } from '../src/matches/entities/match-player-stat.entity';
import { Match } from '../src/matches/entities/match.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { Position } from '../src/players/enums/position.enum';
import { SetBonus } from '../src/set-bonuses/entities/set-bonus.entity';

interface IdResponse {
  id: number;
}

interface AuthResponse {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  account: {
    id: number;
    chemistry: number;
    activeSetBonuses: Array<{ code: string }>;
    email: string;
    displayName: string;
  };
}

interface CareerResponse {
  id: number;
  currentMeta: TeamStrategy;
  teams: Array<{
    id: number;
    strategyProficiencies: Array<{
      strategy: TeamStrategy;
      proficiency: number;
    }>;
    starters: Array<{
      starterPosition: Position;
      championArchetype: ChampionArchetype | null;
      careerPlayer: {
        id: number;
        currentMental: number;
        form: number;
        condition: number;
      };
    }>;
  }>;
}

interface MatchResponse {
  matchId: number;
  careerId: number;
  seriesId: number | null;
  seriesGameNumber: number | null;
  seed: number;
  currentMeta: TeamStrategy;
  teams: Array<{
    teamId: number;
    teamStrategy: TeamStrategy;
    chemistry: number;
    effectiveChemistry: number;
    chemistryModifier: number;
    activeSetBonuses: Array<{ code: string }>;
    setBonusModifier: number;
    archetypeModifier: number;
    stateModifier: number;
    playerStats: Array<{
      careerPlayerId: number;
      position: Position;
      playerInstruction: PlayerInstruction | null;
      championArchetype: ChampionArchetype | null;
      form: number;
      condition: number;
      mental: number;
      formModifier: number;
      conditionModifier: number;
      mentalModifier: number;
      stateModifier: number;
      formAfter: number;
      conditionAfter: number;
      mentalAfter: number;
    }>;
  }>;
}

interface MatchSeriesResponse {
  seriesId: number;
  careerId: number;
  bestOf: number;
  winsRequired: number;
  status: MatchSeriesStatus;
  winnerTeamId: number | null;
  nextGameNumber: number | null;
  seed: number;
  teams: Array<{
    teamId: number;
    teamCode: string;
    wins: number;
  }>;
  games: MatchResponse[];
}

interface MatchSeriesAnalysisResponse {
  seriesId: number;
  status: MatchSeriesStatus;
  analyzedGameNumber: number | null;
  adjustmentsAllowed: boolean;
  teams: Array<{
    teamId: number;
    won: boolean;
    performanceGap: number;
    teamKills: number;
    totalGold: number;
    gdAt15: number;
    averageRating: number;
    playerPlans: Array<{
      position: Position;
      playerInstruction: PlayerInstruction | null;
      championArchetype: ChampionArchetype | null;
    }>;
  }> | null;
}

describe('Application authentication and career ownership (e2e)', () => {
  const fixtureKey = `${Date.now()}_${process.pid}`;
  const accountIds: number[] = [];
  const playerIds: number[] = [];
  const playerCardIds: number[] = [];
  const positions = [
    Position.TOP,
    Position.JUNGLE,
    Position.MID,
    Position.ADC,
    Position.SUPPORT,
  ];
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let themeId: number | undefined;
  let careerId: number | undefined;
  let matchId: number | undefined;
  let matchSeriesId: number | undefined;
  let setBonusId: number | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    dataSource = app.get(DataSource);
  });

  it('serves the application root', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('rejects protected routes without an access token', () => {
    return request(app.getHttpServer()).get('/careers').expect(401);
  });

  it('validates the complete account, save, match, and ownership flow', async () => {
    const api = request(app.getHttpServer());
    const accountAEmail = `coach-a-${fixtureKey}@example.com`;
    const accountBEmail = `coach-b-${fixtureKey}@example.com`;
    const passwordA = 'secure-password-a';
    const passwordB = 'secure-password-b';
    const registerAResponse = await api
      .post('/auth/register')
      .send({
        email: `  ${accountAEmail.toUpperCase()}  `,
        password: passwordA,
        displayName: 'Coach A',
      })
      .expect(201);
    const registerA = registerAResponse.body as unknown as AuthResponse;

    accountIds.push(registerA.account.id);
    expect(registerA.tokenType).toBe('Bearer');
    expect(registerA.expiresInSeconds).toBeGreaterThan(0);
    expect(registerA.account.email).toBe(accountAEmail);
    expect(registerA.account).not.toHaveProperty('passwordHash');

    await api
      .post('/auth/register')
      .send({
        email: accountAEmail,
        password: passwordA,
        displayName: 'Duplicate Coach',
      })
      .expect(409);
    await api
      .post('/auth/login')
      .send({ email: accountAEmail, password: 'wrong-password' })
      .expect(401);

    const loginAResponse = await api
      .post('/auth/login')
      .send({ email: accountAEmail, password: passwordA })
      .expect(200);
    const loginA = loginAResponse.body as unknown as AuthResponse;
    const tokenA = loginA.accessToken;

    await api
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(registerA.account);
      });

    const registerBResponse = await api
      .post('/auth/register')
      .send({
        email: accountBEmail,
        password: passwordB,
        displayName: 'Coach B',
      })
      .expect(201);
    const registerB = registerBResponse.body as unknown as AuthResponse;
    const tokenB = registerB.accessToken;

    accountIds.push(registerB.account.id);

    const themeResponse = await api
      .post('/themes')
      .send({
        code: `E2E_${fixtureKey}`,
        name: 'E2E Theme',
        description: 'Temporary full-flow e2e fixture',
      })
      .expect(201);
    themeId = (themeResponse.body as unknown as IdResponse).id;

    for (let index = 0; index < 10; index += 1) {
      const position = positions[index % positions.length];
      const playerResponse = await api
        .post('/players')
        .send({
          nickname: `E2E_${fixtureKey}_${index}`,
          nationality: index < 5 ? 'KR' : 'CN',
        })
        .expect(201);
      const playerId = (playerResponse.body as unknown as IdResponse).id;

      playerIds.push(playerId);

      const playerCardResponse = await api
        .post('/player-cards')
        .send({
          playerId,
          themeId,
          cardYear: 2026,
          startingAge: 20,
          imageUrl: `/e2e/${fixtureKey}/${index}.svg`,
          mainPosition: position,
          mechanics: 70,
          gameSense: 70,
          laning: 70,
          teamFight: 70,
          macro: 70,
          teamPlay: 70,
          mental: 70,
          championPool: 70,
          potential: 80,
        })
        .expect(201);

      playerCardIds.push((playerCardResponse.body as unknown as IdResponse).id);
    }

    await api
      .post('/set-bonuses')
      .send({
        code: `E2E_DUPLICATE_REQUIREMENT_${fixtureKey}`,
        name: 'Invalid duplicate requirement',
        requiredPlayerCardIds: [playerCardIds[0], playerCardIds[0]],
      })
      .expect(400);
    await api
      .post('/set-bonuses')
      .send({
        code: `E2E_MISSING_CARD_${fixtureKey}`,
        name: 'Invalid missing card',
        requiredPlayerCardIds: [playerCardIds[0], 2147483647],
      })
      .expect(404);

    const setBonusResponse = await api
      .post('/set-bonuses')
      .send({
        code: `E2E_BOTTOM_DUO_${fixtureKey}`,
        name: 'E2E Bottom Duo',
        description: 'Temporary full-flow e2e set bonus',
        requiredPlayerCardIds: [playerCardIds[3], playerCardIds[4]],
        chemistryBonus: 10,
        laningBonus: 4,
        teamFightBonus: 2,
        teamPlayBonus: 4,
      })
      .expect(201);

    setBonusId = (setBonusResponse.body as unknown as IdResponse).id;
    await api
      .post('/set-bonuses')
      .send({
        code: `E2E_BOTTOM_DUO_${fixtureKey}`,
        name: 'Duplicate E2E Bottom Duo',
        requiredPlayerCardIds: [playerCardIds[3], playerCardIds[4]],
      })
      .expect(409);
    await api.get(`/set-bonuses/${setBonusId}`).expect(200);

    const careerResponse = await api
      .post('/careers')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        startYear: 2026,
        managedTeamCode: 'E2E_BLUE',
        teams: [
          {
            code: 'E2E_BLUE',
            name: 'E2E Blue',
            region: Region.LCK,
            starters: positions.map((position, index) => ({
              playerCardId: playerCardIds[index],
              position,
            })),
          },
          {
            code: 'E2E_RED',
            name: 'E2E Red',
            region: Region.LPL,
            starters: positions.map((position, index) => ({
              playerCardId: playerCardIds[index + positions.length],
              position,
            })),
          },
        ],
      })
      .expect(201);
    const career = careerResponse.body as unknown as CareerResponse;
    const [teamA, teamB] = career.teams;

    careerId = career.id;
    expect(career.currentMeta).toBe(TeamStrategy.BALANCED);
    expect(career.teams).toHaveLength(2);
    expect(teamA.strategyProficiencies).toHaveLength(8);
    expect(teamB.strategyProficiencies).toHaveLength(8);
    expect(teamA.chemistry).toBe(50);
    expect(teamB.chemistry).toBe(50);
    expect(teamA.activeSetBonuses).toEqual([
      expect.objectContaining({ code: `E2E_BOTTOM_DUO_${fixtureKey}` }),
    ]);
    expect(teamB.activeSetBonuses).toEqual([]);
    expect(teamA.starters).toHaveLength(5);
    expect(teamB.starters).toHaveLength(5);
    expect(
      [...teamA.starters, ...teamB.starters].every(
        (starter) =>
          starter.careerPlayer.form === 50 &&
          starter.careerPlayer.condition === 100 &&
          starter.careerPlayer.currentMental === 70,
      ),
    ).toBe(true);
    expect(
      [...teamA.starters, ...teamB.starters].every(
        (starter) => starter.championArchetype === null,
      ),
    ).toBe(true);

    const accountACareerList = await api
      .get('/careers')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const accountBCareerList = await api
      .get('/careers')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(accountACareerList.body).toHaveLength(1);
    expect(accountBCareerList.body).toEqual([]);

    await api
      .get(`/careers/${career.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
    await api
      .patch(`/careers/${career.id}/meta`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ meta: TeamStrategy.BOT_CARRY })
      .expect(404);
    await api
      .patch(`/careers/${career.id}/teams/${teamA.id}/strategy`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ strategy: TeamStrategy.BOT_CARRY })
      .expect(404);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.ADC}/instruction`,
      )
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ instruction: PlayerInstruction.HYPER_CARRY })
      .expect(404);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.ADC}/archetype`,
      )
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ archetype: ChampionArchetype.HYPER_CARRY })
      .expect(404);

    await api
      .patch(`/careers/${career.id}/meta`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ meta: TeamStrategy.BOT_CARRY })
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual({
          careerId: career.id,
          currentMeta: TeamStrategy.BOT_CARRY,
        });
      });
    await api
      .patch(`/careers/${career.id}/teams/${teamA.id}/strategy`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ strategy: TeamStrategy.BOT_CARRY })
      .expect(200);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.ADC}/instruction`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ instruction: PlayerInstruction.HYPER_CARRY })
      .expect(200);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.TOP}/archetype`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ archetype: ChampionArchetype.LANE_BULLY })
      .expect(400);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.ADC}/archetype`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ archetype: ChampionArchetype.UTILITY })
      .expect(400);
    const selectedArchetypes: Array<[Position, ChampionArchetype]> = [
      [Position.TOP, ChampionArchetype.TOP_SIDE_LANE],
      [Position.JUNGLE, ChampionArchetype.JUNGLE_EARLY_SNOWBALL],
      [Position.MID, ChampionArchetype.MID_STANDING_MAGE],
      [Position.ADC, ChampionArchetype.HYPER_CARRY],
      [Position.SUPPORT, ChampionArchetype.UTILITY],
    ];

    for (const [position, archetype] of selectedArchetypes) {
      await api
        .patch(
          `/careers/${career.id}/teams/${teamA.id}/starters/${position}/archetype`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ archetype })
        .expect(200);
    }

    const updatedCareerResponse = await api
      .get(`/careers/${career.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const updatedCareer =
      updatedCareerResponse.body as unknown as CareerResponse;
    const updatedTeamA = updatedCareer.teams.find(
      (team) => team.id === teamA.id,
    )!;

    for (const [position, archetype] of selectedArchetypes) {
      expect(
        updatedTeamA.starters.find(
          (starter) => starter.starterPosition === position,
        )?.championArchetype,
      ).toBe(archetype);
    }

    const simulateBody = {
      careerId: career.id,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 20260826,
    };

    await api
      .post('/matches/simulate')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(simulateBody)
      .expect(404);

    const matchResponse = await api
      .post('/matches/simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(simulateBody)
      .expect(201);
    const match = matchResponse.body as unknown as MatchResponse;

    matchId = match.matchId;
    expect(match.careerId).toBe(career.id);
    expect(match.seriesId).toBeNull();
    expect(match.seriesGameNumber).toBeNull();
    expect(match.currentMeta).toBe(TeamStrategy.BOT_CARRY);
    expect(match.teams).toHaveLength(2);
    expect(match.teams[0].chemistry).toBe(50);
    expect(match.teams[0].effectiveChemistry).toBe(60);
    expect(match.teams[0].chemistryModifier).toBe(0.8);
    expect(match.teams[0].setBonusModifier).toBeGreaterThan(0);
    expect(match.teams[0].archetypeModifier).not.toBe(0);
    expect(
      match.teams.every((team) => Number.isFinite(team.stateModifier)),
    ).toBe(true);
    expect(match.teams[0].activeSetBonuses).toEqual([
      expect.objectContaining({ code: `E2E_BOTTOM_DUO_${fixtureKey}` }),
    ]);
    expect(match.teams[1].activeSetBonuses).toEqual([]);
    for (const [position, archetype] of selectedArchetypes) {
      expect(
        match.teams[0].playerStats.find(
          (playerStat) => playerStat.position === position,
        )?.championArchetype,
      ).toBe(archetype);
    }
    expect(
      match.teams.reduce((total, team) => total + team.playerStats.length, 0),
    ).toBe(10);
    expect(
      match.teams
        .flatMap((team) => team.playerStats)
        .every(
          (playerStat) =>
            playerStat.form === 50 &&
            playerStat.condition === 100 &&
            playerStat.mental === 70 &&
            playerStat.conditionAfter < playerStat.condition &&
            Number.isFinite(playerStat.stateModifier),
        ),
    ).toBe(true);

    const storedMatchResponse = await api
      .get(`/matches/${match.matchId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const storedMatch = storedMatchResponse.body as unknown as MatchResponse;

    expect(storedMatch).toEqual(match);

    const postMatchCareerResponse = await api
      .get(`/careers/${career.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const postMatchCareer =
      postMatchCareerResponse.body as unknown as CareerResponse;
    const currentPlayersById = new Map(
      postMatchCareer.teams.flatMap((team) =>
        team.starters.map(
          (starter) => [starter.careerPlayer.id, starter.careerPlayer] as const,
        ),
      ),
    );

    for (const playerStat of match.teams.flatMap((team) => team.playerStats)) {
      expect(currentPlayersById.get(playerStat.careerPlayerId)).toEqual(
        expect.objectContaining({
          form: playerStat.formAfter,
          condition: playerStat.conditionAfter,
          currentMental: playerStat.mentalAfter,
        }),
      );
    }
    await api
      .get(`/matches/${match.matchId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const seriesBody = {
      careerId: career.id,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 20260827,
    };

    await api
      .post('/match-series')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...seriesBody, teamBId: teamA.id })
      .expect(400);
    await api
      .post('/match-series')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(seriesBody)
      .expect(404);

    const createdSeriesResponse = await api
      .post('/match-series')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(seriesBody)
      .expect(201);
    const createdSeries =
      createdSeriesResponse.body as unknown as MatchSeriesResponse;

    matchSeriesId = createdSeries.seriesId;
    expect(createdSeries).toEqual(
      expect.objectContaining({
        careerId: career.id,
        bestOf: 3,
        winsRequired: 2,
        status: MatchSeriesStatus.IN_PROGRESS,
        winnerTeamId: null,
        nextGameNumber: 1,
        seed: seriesBody.seed,
        games: [],
      }),
    );
    await api
      .get(`/match-series/${matchSeriesId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
    await api
      .post(`/match-series/${matchSeriesId}/games/simulate`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const pregameAnalysisResponse = await api
      .get(`/match-series/${matchSeriesId}/analysis`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const pregameAnalysis =
      pregameAnalysisResponse.body as unknown as MatchSeriesAnalysisResponse;

    expect(pregameAnalysis.analyzedGameNumber).toBeNull();
    expect(pregameAnalysis.adjustmentsAllowed).toBe(true);
    expect(pregameAnalysis.teams).toBeNull();

    const game1Response = await api
      .post(`/match-series/${matchSeriesId}/games/simulate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const afterGame1 = game1Response.body as unknown as MatchSeriesResponse;
    const game1 = afterGame1.games[0];

    expect(afterGame1.status).toBe(MatchSeriesStatus.IN_PROGRESS);
    expect(afterGame1.nextGameNumber).toBe(2);
    expect(afterGame1.games).toHaveLength(1);
    expect(game1.seriesId).toBe(matchSeriesId);
    expect(game1.seriesGameNumber).toBe(1);
    expect(game1.seed).toBe(seriesBody.seed);
    expect(game1.teams[0].teamStrategy).toBe(TeamStrategy.BOT_CARRY);

    const game1AnalysisResponse = await api
      .get(`/match-series/${matchSeriesId}/analysis`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const game1Analysis =
      game1AnalysisResponse.body as unknown as MatchSeriesAnalysisResponse;

    expect(game1Analysis.analyzedGameNumber).toBe(1);
    expect(game1Analysis.adjustmentsAllowed).toBe(true);
    expect(game1Analysis.teams).toHaveLength(2);
    expect(game1Analysis.teams?.[0].playerPlans).toHaveLength(5);
    expect(
      game1Analysis.teams?.every(
        (teamAnalysis) =>
          Number.isFinite(teamAnalysis.performanceGap) &&
          Number.isFinite(teamAnalysis.totalGold) &&
          Number.isFinite(teamAnalysis.gdAt15) &&
          Number.isFinite(teamAnalysis.averageRating),
      ),
    ).toBe(true);

    await api
      .patch(`/careers/${career.id}/teams/${teamA.id}/strategy`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ strategy: TeamStrategy.TOP_CARRY })
      .expect(200);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.MID}/instruction`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ instruction: PlayerInstruction.ROAM_TOP })
      .expect(200);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.TOP}/archetype`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ archetype: ChampionArchetype.TOP_TANK })
      .expect(200);

    const game2Response = await api
      .post(`/match-series/${matchSeriesId}/games/simulate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    let completedSeries = game2Response.body as unknown as MatchSeriesResponse;
    const game2 = completedSeries.games[1];
    const game2TeamA = game2.teams.find(
      (gameTeam) => gameTeam.teamId === teamA.id,
    )!;

    expect(game2.seriesGameNumber).toBe(2);
    expect(game2.seed).toBe(seriesBody.seed + 1);
    expect(game2TeamA.teamStrategy).toBe(TeamStrategy.TOP_CARRY);
    const game1StateByPlayerId = new Map(
      game1.teams.flatMap((gameTeam) =>
        gameTeam.playerStats.map(
          (playerStat) => [playerStat.careerPlayerId, playerStat] as const,
        ),
      ),
    );

    for (const playerStat of game2.teams.flatMap(
      (gameTeam) => gameTeam.playerStats,
    )) {
      const previousGame = game1StateByPlayerId.get(playerStat.careerPlayerId)!;

      expect(playerStat.form).toBe(previousGame.formAfter);
      expect(playerStat.condition).toBe(previousGame.conditionAfter);
      expect(playerStat.mental).toBe(previousGame.mentalAfter);
    }
    expect(
      game2TeamA.playerStats.find(
        (playerStat) => playerStat.position === Position.MID,
      )?.playerInstruction,
    ).toBe(PlayerInstruction.ROAM_TOP);
    expect(
      game2TeamA.playerStats.find(
        (playerStat) => playerStat.position === Position.TOP,
      )?.championArchetype,
    ).toBe(ChampionArchetype.TOP_TANK);
    expect(
      game1.teams
        .find((gameTeam) => gameTeam.teamId === teamA.id)!
        .playerStats.find((playerStat) => playerStat.position === Position.TOP)
        ?.championArchetype,
    ).toBe(ChampionArchetype.TOP_SIDE_LANE);

    if (completedSeries.status === MatchSeriesStatus.IN_PROGRESS) {
      const game3Response = await api
        .post(`/match-series/${matchSeriesId}/games/simulate`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(201);
      const game3Series = game3Response.body as unknown as MatchSeriesResponse;

      completedSeries = game3Series;
      expect(completedSeries.games[2].seriesGameNumber).toBe(3);
      expect(completedSeries.games[2].seed).toBe(seriesBody.seed + 2);
    }

    expect(completedSeries.status).toBe(MatchSeriesStatus.COMPLETED);
    expect(completedSeries.winnerTeamId).not.toBeNull();
    expect(completedSeries.nextGameNumber).toBeNull();
    expect(completedSeries.games.length).toBeGreaterThanOrEqual(2);
    expect(completedSeries.games.length).toBeLessThanOrEqual(3);
    expect(
      completedSeries.teams.find(
        (seriesTeam) => seriesTeam.teamId === completedSeries.winnerTeamId,
      )?.wins,
    ).toBe(2);
    await api
      .post(`/match-series/${matchSeriesId}/games/simulate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(409);

    const completedAnalysisResponse = await api
      .get(`/match-series/${matchSeriesId}/analysis`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const completedAnalysis =
      completedAnalysisResponse.body as unknown as MatchSeriesAnalysisResponse;

    expect(completedAnalysis.status).toBe(MatchSeriesStatus.COMPLETED);
    expect(completedAnalysis.adjustmentsAllowed).toBe(false);
    expect(completedAnalysis.analyzedGameNumber).toBe(
      completedSeries.games.length,
    );

    const storedSeriesResponse = await api
      .get(`/match-series/${matchSeriesId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(storedSeriesResponse.body).toEqual(completedSeries);

    const storedAccount = await dataSource
      .getRepository(Account)
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .where('account.id = :id', { id: registerA.account.id })
      .getOneOrFail();
    const storedCareer = await dataSource
      .getRepository(Career)
      .findOneByOrFail({ id: career.id });

    expect(storedAccount.passwordHash).toMatch(/^scrypt\$/);
    expect(storedAccount.passwordHash).not.toContain(passwordA);
    expect(storedCareer.accountId).toBe(registerA.account.id);

    await api
      .post('/auth/logout')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (accountIds.length > 0) {
        await dataSource.getRepository(Account).delete({
          id: In(accountIds),
        });
      }

      if (careerId !== undefined) {
        expect(
          await dataSource.getRepository(Career).countBy({ id: careerId }),
        ).toBe(0);
      }

      if (matchSeriesId !== undefined) {
        expect(
          await dataSource
            .getRepository(MatchSeries)
            .countBy({ id: matchSeriesId }),
        ).toBe(0);
      }

      if (matchId !== undefined) {
        expect(
          await dataSource.getRepository(Match).countBy({ id: matchId }),
        ).toBe(0);
        expect(
          await dataSource.getRepository(MatchPlayerStat).countBy({ matchId }),
        ).toBe(0);
      }

      if (playerCardIds.length > 0) {
        if (setBonusId !== undefined) {
          await dataSource.getRepository(SetBonus).delete({ id: setBonusId });
        }

        await dataSource.getRepository(PlayerCard).delete({
          id: In(playerCardIds),
        });
      }

      if (playerIds.length > 0) {
        await dataSource.getRepository(Player).delete({ id: In(playerIds) });
      }

      if (themeId !== undefined) {
        await dataSource.getRepository(Theme).delete({ id: themeId });
      }

      if (accountIds.length > 0) {
        expect(
          await dataSource.getRepository(Account).countBy({
            id: In(accountIds),
          }),
        ).toBe(0);
      }
    }

    await app?.close();
  });
});
