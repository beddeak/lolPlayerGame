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
import { TrainingCategory } from '../src/careers/enums/training-category.enum';
import { TrainingType } from '../src/careers/enums/training-type.enum';
import { LeagueSplit } from '../src/leagues/entities/league-split.entity';
import { LeagueFixtureStatus } from '../src/leagues/enums/league-fixture-status.enum';
import { LeagueSplitStatus } from '../src/leagues/enums/league-split-status.enum';
import { LeagueStageStatus } from '../src/leagues/enums/league-stage-status.enum';
import { MatchSeries } from '../src/match-series/entities/match-series.entity';
import { MatchFeedbackPlayerEffect } from '../src/match-series/entities/match-feedback-player-effect.entity';
import { MatchFeedback } from '../src/match-series/entities/match-feedback.entity';
import { FeedbackOption } from '../src/match-series/enums/feedback-option.enum';
import { FeedbackType } from '../src/match-series/enums/feedback-type.enum';
import { MatchSeriesStatus } from '../src/match-series/enums/match-series-status.enum';
import { MatchPlayerStat } from '../src/matches/entities/match-player-stat.entity';
import { Match } from '../src/matches/entities/match.entity';
import { PlayerCard } from '../src/players/entities/player-card.entity';
import { Player } from '../src/players/entities/player.entity';
import { Theme } from '../src/players/entities/theme.entity';
import { Position } from '../src/players/enums/position.enum';
import { PlayerPersonality } from '../src/players/enums/player-personality.enum';
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

interface CareerRosterResponse {
  id: number;
  starterPosition: Position | null;
  championArchetype: ChampionArchetype | null;
  careerPlayer: {
    id: number;
    currentMental: number;
    form: number;
    condition: number;
    personality: PlayerPersonality;
    coachTrust: number;
    positionProficiencies: Array<{
      position: Position;
      proficiency: number;
    }>;
  };
}

interface CareerResponse {
  id: number;
  currentMeta: TeamStrategy;
  teams: Array<{
    id: number;
    chemistry: number;
    activeSetBonuses: Array<{ code: string }>;
    strategyProficiencies: Array<{
      strategy: TeamStrategy;
      proficiency: number;
    }>;
    starters: CareerRosterResponse[];
    benches: CareerRosterResponse[];
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
      positionProficiency: number;
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

interface FeedbackResponse {
  id: number;
  seriesId: number;
  afterGameId: number;
  afterGameNumber: number;
  type: FeedbackType;
  option: FeedbackOption;
  targetTeamId: number;
  targetCareerPlayerId: number | null;
  effects: Array<{
    careerPlayerId: number;
    personality: PlayerPersonality;
    mentalBefore: number;
    mentalDelta: number;
    mentalAfter: number;
    formBefore: number;
    formDelta: number;
    formAfter: number;
    coachTrustBefore: number;
    coachTrustDelta: number;
    coachTrustAfter: number;
  }>;
}

interface TrainingPeriodResponse {
  id: number;
  careerId: number;
  periodNumber: number;
  teamTraining: { used: number; limit: number; remaining: number };
  individualTraining: { used: number; limit: number; remaining: number };
  sessions: Array<{
    id: number;
    category: TrainingCategory;
    type: TrainingType;
    categorySequence: number;
    careerTeamId: number;
    careerPlayerId: number | null;
    strategy: TeamStrategy | null;
    position: Position | null;
    instruction: PlayerInstruction | null;
    growthSucceeded: boolean | null;
    resultBefore: number;
    resultDelta: number;
    resultAfter: number;
    conditionBefore: number | null;
    conditionDelta: number | null;
    conditionAfter: number | null;
    formBefore: number | null;
    formDelta: number | null;
    formAfter: number | null;
  }>;
}

interface LeagueSplitResponse {
  id: number;
  careerId: number;
  year: number;
  region: Region;
  splitNumber: number;
  status: LeagueSplitStatus;
  activeStageCode: string | null;
  stages: Array<{
    code: string;
    status: LeagueStageStatus;
    bestOf: number;
    currentRound: number;
    fixtures: LeagueFixtureResponse[];
  }>;
  fixtures: LeagueFixtureResponse[];
  standings: Array<{
    rank: number;
    teamId: number;
    played: number;
    seriesWins: number;
    seriesLosses: number;
    gameWins: number;
    gameLosses: number;
    gameDifference: number;
  }>;
}

interface LeagueFixtureResponse {
  id: number;
  leagueStageId: number;
  fixtureNumber: number;
  stageFixtureNumber: number;
  roundNumber: number;
  bestOf: number;
  status: LeagueFixtureStatus;
  seriesId: number | null;
  teamA: { id: number; code: string; name: string };
  teamB: { id: number; code: string; name: string };
  teamAWins: number;
  teamBWins: number;
  winnerTeamId: number | null;
}

interface LeagueFixtureGameResponse {
  fixtureId: number;
  series: MatchSeriesResponse;
  split: LeagueSplitResponse;
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
  const personalities = Object.values(PlayerPersonality);
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let themeId: number | undefined;
  let careerId: number | undefined;
  let matchId: number | undefined;
  let matchSeriesId: number | undefined;
  let setBonusId: number | undefined;
  let feedbackId: number | undefined;
  let leagueSplitId: number | undefined;

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

    for (let index = 0; index < 12; index += 1) {
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
          personality: personalities[index % personalities.length],
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
            region: Region.LEC,
            starters: positions.map((position, index) => ({
              playerCardId: playerCardIds[index],
              position,
            })),
            benches: [{ playerCardId: playerCardIds[10] }],
          },
          {
            code: 'E2E_RED',
            name: 'E2E Red',
            region: Region.LEC,
            starters: positions.map((position, index) => ({
              playerCardId: playerCardIds[index + positions.length],
              position,
            })),
            benches: [{ playerCardId: playerCardIds[11] }],
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
    expect(teamA.benches).toHaveLength(1);
    expect(teamB.benches).toHaveLength(1);
    expect(
      [...teamA.starters, ...teamB.starters].every(
        (starter) =>
          starter.careerPlayer.form === 50 &&
          starter.careerPlayer.condition === 100 &&
          starter.careerPlayer.currentMental === 70 &&
          starter.careerPlayer.coachTrust === 50,
      ),
    ).toBe(true);
    expect(
      [...teamA.starters, ...teamB.starters].every(
        (starter) => starter.championArchetype === null,
      ),
    ).toBe(true);
    expect(
      [...teamA.starters, ...teamB.starters].every((starter) => {
        const proficiencies = starter.careerPlayer.positionProficiencies;

        return (
          proficiencies.length === positions.length &&
          proficiencies.find(
            (proficiency) => proficiency.position === starter.starterPosition,
          )?.proficiency === 100 &&
          proficiencies
            .filter(
              (proficiency) => proficiency.position !== starter.starterPosition,
            )
            .every((proficiency) => proficiency.proficiency === 20)
        );
      }),
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
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.TOP}/swap`,
      )
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ benchCareerPlayerId: teamA.benches[0].careerPlayer.id })
      .expect(404);
    await api
      .patch(
        `/careers/${career.id}/teams/${teamB.id}/starters/${Position.TOP}/swap`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ benchCareerPlayerId: teamB.benches[0].careerPlayer.id })
      .expect(404);

    const originalTopStarterId = teamA.starters.find(
      (starter) => starter.starterPosition === Position.TOP,
    )!.careerPlayer.id;
    const promotedTopStarterId = teamA.benches[0].careerPlayer.id;
    await api
      .patch(
        `/careers/${career.id}/teams/${teamA.id}/starters/${Position.TOP}/swap`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ benchCareerPlayerId: promotedTopStarterId })
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(
          expect.objectContaining({
            careerId: career.id,
            careerTeamId: teamA.id,
            position: Position.TOP,
            promotedStarter: expect.objectContaining({
              careerPlayerId: promotedTopStarterId,
              role: 'STARTER',
              starterPosition: Position.TOP,
            }),
            demotedBench: expect.objectContaining({
              careerPlayerId: originalTopStarterId,
              role: 'BENCH',
              starterPosition: null,
            }),
          }),
        );
      });

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

    expect(updatedTeamA.starters).toHaveLength(5);
    expect(updatedTeamA.benches).toHaveLength(1);
    expect(
      updatedTeamA.starters.find(
        (starter) => starter.starterPosition === Position.TOP,
      )?.careerPlayer.id,
    ).toBe(promotedTopStarterId);
    expect(updatedTeamA.benches[0].careerPlayer.id).toBe(originalTopStarterId);

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
      match.teams[0].playerStats.some(
        (playerStat) => playerStat.careerPlayerId === promotedTopStarterId,
      ),
    ).toBe(true);
    expect(
      match.teams[0].playerStats.some(
        (playerStat) => playerStat.careerPlayerId === originalTopStarterId,
      ),
    ).toBe(false);
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
      .post(`/match-series/${matchSeriesId}/feedback`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        type: FeedbackType.TEAM,
        option: FeedbackOption.REFOCUS_TEAM,
      })
      .expect(404);
    await api
      .post(`/match-series/${matchSeriesId}/feedback`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: FeedbackType.TEAM,
        option: FeedbackOption.TRUST_PLAYER,
      })
      .expect(400);

    const feedbackResponse = await api
      .post(`/match-series/${matchSeriesId}/feedback`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: FeedbackType.TEAM,
        option: FeedbackOption.REFOCUS_TEAM,
      })
      .expect(201);
    const feedback = feedbackResponse.body as unknown as FeedbackResponse;
    const feedbackEffectsByPlayerId = new Map(
      feedback.effects.map((effect) => [effect.careerPlayerId, effect]),
    );

    feedbackId = feedback.id;
    expect(feedback).toEqual(
      expect.objectContaining({
        seriesId: matchSeriesId,
        afterGameId: game1.matchId,
        afterGameNumber: 1,
        type: FeedbackType.TEAM,
        option: FeedbackOption.REFOCUS_TEAM,
        targetTeamId: teamA.id,
        targetCareerPlayerId: null,
      }),
    );
    expect(feedback.effects).toHaveLength(5);
    expect(
      new Set(feedback.effects.map((effect) => effect.personality)).size,
    ).toBeGreaterThan(1);
    expect(
      feedback.effects.every(
        (effect) =>
          effect.formAfter === effect.formBefore + effect.formDelta &&
          effect.mentalAfter === effect.mentalBefore + effect.mentalDelta &&
          effect.coachTrustAfter ===
            effect.coachTrustBefore + effect.coachTrustDelta,
      ),
    ).toBe(true);

    await api
      .post(`/match-series/${matchSeriesId}/feedback`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: FeedbackType.TEAM,
        option: FeedbackOption.REFOCUS_TEAM,
      })
      .expect(409);

    const feedbackHistoryResponse = await api
      .get(`/match-series/${matchSeriesId}/feedbacks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(feedbackHistoryResponse.body).toEqual([feedback]);

    const postFeedbackCareerResponse = await api
      .get(`/careers/${career.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const postFeedbackCareer =
      postFeedbackCareerResponse.body as unknown as CareerResponse;
    const postFeedbackPlayersById = new Map(
      postFeedbackCareer.teams.flatMap((team) =>
        team.starters.map(
          (starter) => [starter.careerPlayer.id, starter.careerPlayer] as const,
        ),
      ),
    );

    for (const effect of feedback.effects) {
      expect(postFeedbackPlayersById.get(effect.careerPlayerId)).toEqual(
        expect.objectContaining({
          form: effect.formAfter,
          currentMental: effect.mentalAfter,
          coachTrust: effect.coachTrustAfter,
        }),
      );
    }

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
      const feedbackEffect = feedbackEffectsByPlayerId.get(
        playerStat.careerPlayerId,
      );

      expect(playerStat.form).toBe(
        feedbackEffect?.formAfter ?? previousGame.formAfter,
      );
      expect(playerStat.condition).toBe(previousGame.conditionAfter);
      expect(playerStat.mental).toBe(
        feedbackEffect?.mentalAfter ?? previousGame.mentalAfter,
      );
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

    await api
      .get(`/careers/${career.id}/training-periods/current`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
    const initialTrainingPeriodResponse = await api
      .get(`/careers/${career.id}/training-periods/current`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const initialTrainingPeriod =
      initialTrainingPeriodResponse.body as unknown as TrainingPeriodResponse;

    expect(initialTrainingPeriod).toEqual(
      expect.objectContaining({
        careerId: career.id,
        periodNumber: 1,
        teamTraining: { used: 0, limit: 2, remaining: 2 },
        individualTraining: { used: 0, limit: 2, remaining: 2 },
        sessions: [],
      }),
    );

    await api
      .post(`/careers/${career.id}/training-periods/current/team`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: TrainingType.STRATEGY })
      .expect(400);
    const strategyTrainingResponse = await api
      .post(`/careers/${career.id}/training-periods/current/team`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: TrainingType.STRATEGY,
        strategy: TeamStrategy.TOP_CARRY,
      })
      .expect(201);
    const strategyTraining =
      strategyTrainingResponse.body as unknown as TrainingPeriodResponse;

    expect(strategyTraining.teamTraining).toEqual({
      used: 1,
      limit: 2,
      remaining: 1,
    });
    expect(strategyTraining.sessions[0]).toEqual(
      expect.objectContaining({
        category: TrainingCategory.TEAM,
        type: TrainingType.STRATEGY,
        strategy: TeamStrategy.TOP_CARRY,
        resultBefore: 50,
        resultDelta: 4,
        resultAfter: 54,
      }),
    );

    const chemistryTrainingResponse = await api
      .post(`/careers/${career.id}/training-periods/current/team`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: TrainingType.CHEMISTRY })
      .expect(201);
    const chemistryTraining =
      chemistryTrainingResponse.body as unknown as TrainingPeriodResponse;

    expect(chemistryTraining.teamTraining).toEqual({
      used: 2,
      limit: 2,
      remaining: 0,
    });
    expect(chemistryTraining.sessions[1]).toEqual(
      expect.objectContaining({
        category: TrainingCategory.TEAM,
        type: TrainingType.CHEMISTRY,
        resultBefore: 50,
        resultDelta: 3,
        resultAfter: 53,
      }),
    );
    await api
      .post(`/careers/${career.id}/training-periods/current/team`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: TrainingType.CHEMISTRY })
      .expect(409);

    const adcPlayer = teamA.starters.find(
      (starter) => starter.starterPosition === Position.ADC,
    )!.careerPlayer;

    await api
      .post(`/careers/${career.id}/training-periods/current/individual`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: TrainingType.ROLE,
        careerPlayerId: adcPlayer.id,
        position: Position.ADC,
        instruction: PlayerInstruction.ROAM_TOP,
      })
      .expect(400);
    const positionTrainingResponse = await api
      .post(`/careers/${career.id}/training-periods/current/individual`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: TrainingType.POSITION,
        careerPlayerId: adcPlayer.id,
        position: Position.TOP,
      })
      .expect(201);
    const positionTraining =
      positionTrainingResponse.body as unknown as TrainingPeriodResponse;
    const positionSession = positionTraining.sessions[2];

    expect(positionSession).toEqual(
      expect.objectContaining({
        category: TrainingCategory.INDIVIDUAL,
        type: TrainingType.POSITION,
        careerPlayerId: adcPlayer.id,
        position: Position.TOP,
        resultBefore: 20,
        resultDelta: 5,
        resultAfter: 25,
        growthSucceeded: true,
      }),
    );
    expect(positionSession.conditionDelta).toBeLessThan(0);

    const roleTrainingResponse = await api
      .post(`/careers/${career.id}/training-periods/current/individual`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: TrainingType.ROLE,
        careerPlayerId: adcPlayer.id,
        position: Position.ADC,
        instruction: PlayerInstruction.HYPER_CARRY,
      })
      .expect(201);
    const roleTraining =
      roleTrainingResponse.body as unknown as TrainingPeriodResponse;
    const roleSession = roleTraining.sessions[3];

    expect(roleTraining.individualTraining).toEqual({
      used: 2,
      limit: 2,
      remaining: 0,
    });
    expect(roleSession).toEqual(
      expect.objectContaining({
        category: TrainingCategory.INDIVIDUAL,
        type: TrainingType.ROLE,
        careerPlayerId: adcPlayer.id,
        position: Position.ADC,
        instruction: PlayerInstruction.HYPER_CARRY,
        resultBefore: 50,
        resultDelta: 4,
        resultAfter: 54,
        growthSucceeded: true,
      }),
    );
    expect(Math.abs(roleSession.conditionDelta!)).toBeGreaterThan(
      Math.abs(positionSession.conditionDelta!),
    );
    expect(roleSession.formAfter).toBeLessThanOrEqual(roleSession.formBefore!);
    await api
      .post(`/careers/${career.id}/training-periods/current/individual`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: TrainingType.CHAMPION_POOL,
        careerPlayerId: adcPlayer.id,
      })
      .expect(409);

    const trainedCareerResponse = await api
      .get(`/careers/${career.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const trainedCareer =
      trainedCareerResponse.body as unknown as CareerResponse;
    const trainedTeam = trainedCareer.teams.find(
      (team) => team.id === teamA.id,
    )!;
    const trainedAdc = trainedTeam.starters.find(
      (starter) => starter.starterPosition === Position.ADC,
    )!.careerPlayer;

    expect(trainedTeam.chemistry).toBe(53);
    expect(
      trainedTeam.strategyProficiencies.find(
        (proficiency) => proficiency.strategy === TeamStrategy.TOP_CARRY,
      )?.proficiency,
    ).toBe(54);
    expect(
      trainedAdc.positionProficiencies.find(
        (proficiency) => proficiency.position === Position.TOP,
      )?.proficiency,
    ).toBe(25);
    expect(trainedAdc.condition).toBe(roleSession.conditionAfter);
    expect(trainedAdc.form).toBe(roleSession.formAfter);

    const leagueFormatsResponse = await api
      .get(`/careers/${career.id}/league-splits/formats`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(leagueFormatsResponse.body).toHaveLength(12);
    expect(leagueFormatsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ region: Region.LCK, splitNumber: 1 }),
        expect.objectContaining({ region: Region.LPL, splitNumber: 2 }),
        expect.objectContaining({ region: Region.LEC, splitNumber: 3 }),
        expect.objectContaining({ region: Region.LCS, splitNumber: 1 }),
      ]),
    );

    await api
      .post(`/careers/${career.id}/league-splits`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ region: Region.LEC, splitNumber: 2 })
      .expect(404);
    await api
      .post(`/careers/${career.id}/league-splits`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ region: Region.LEC, splitNumber: 4 })
      .expect(400);

    const leagueSplitResponse = await api
      .post(`/careers/${career.id}/league-splits`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ region: Region.LEC, splitNumber: 2 })
      .expect(201);
    const leagueSplit =
      leagueSplitResponse.body as unknown as LeagueSplitResponse;

    leagueSplitId = leagueSplit.id;
    expect(leagueSplit).toEqual(
      expect.objectContaining({
        careerId: career.id,
        year: 2026,
        region: Region.LEC,
        splitNumber: 2,
        status: LeagueSplitStatus.SCHEDULED,
        activeStageCode: 'REGULAR_SEASON',
      }),
    );
    expect(leagueSplit.stages.map((stage) => stage.code)).toEqual([
      'REGULAR_SEASON',
      'PLAYOFFS',
    ]);
    expect(leagueSplit.fixtures).toHaveLength(1);
    expect(leagueSplit.fixtures[0].roundNumber).toBe(1);
    expect(leagueSplit.fixtures[0]).toEqual(
      expect.objectContaining({
        status: LeagueFixtureStatus.SCHEDULED,
        seriesId: null,
        teamA: expect.objectContaining({ id: teamA.id }),
        teamB: expect.objectContaining({ id: teamB.id }),
      }),
    );
    expect(
      leagueSplit.standings.every(
        (standing) =>
          standing.played === 0 &&
          standing.seriesWins === 0 &&
          standing.seriesLosses === 0,
      ),
    ).toBe(true);

    await api
      .post(`/careers/${career.id}/league-splits`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ region: Region.LEC, splitNumber: 2 })
      .expect(409);
    await api
      .get(`/careers/${career.id}/league-splits/${leagueSplit.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
    await api
      .post(
        `/careers/${career.id}/league-splits/${leagueSplit.id}/fixtures/${leagueSplit.fixtures[0].id}/games/simulate`,
      )
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const playLeagueFixture = async (
      fixtureId: number,
    ): Promise<LeagueFixtureGameResponse> => {
      let advance: LeagueFixtureGameResponse;

      do {
        const response = await api
          .post(
            `/careers/${career.id}/league-splits/${leagueSplit.id}/fixtures/${fixtureId}/games/simulate`,
          )
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(201);

        advance = response.body as unknown as LeagueFixtureGameResponse;
      } while (advance.series.status !== MatchSeriesStatus.COMPLETED);

      return advance;
    };

    const firstLeagueSeries = await playLeagueFixture(
      leagueSplit.fixtures[0].id,
    );
    const firstCompletedSplit = firstLeagueSeries.split;
    const firstWinnerStanding = firstCompletedSplit.standings.find(
      (standing) => standing.teamId === firstLeagueSeries.series.winnerTeamId,
    )!;

    expect(firstCompletedSplit.status).toBe(LeagueSplitStatus.IN_PROGRESS);
    expect(firstWinnerStanding).toEqual(
      expect.objectContaining({ played: 1, seriesWins: 1 }),
    );
    expect(
      firstCompletedSplit.standings.reduce(
        (total, standing) => total + standing.gameWins,
        0,
      ),
    ).toBe(firstLeagueSeries.series.games.length);
    await api
      .post(
        `/careers/${career.id}/league-splits/${leagueSplit.id}/fixtures/${leagueSplit.fixtures[0].id}/games/simulate`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(409);

    expect(firstCompletedSplit.activeStageCode).toBe('PLAYOFFS');
    expect(firstCompletedSplit.stages[0].status).toBe(
      LeagueStageStatus.COMPLETED,
    );
    expect(firstCompletedSplit.stages[1].status).toBe(LeagueStageStatus.ACTIVE);

    let completedLeagueSplit = firstCompletedSplit;
    let playoffSeriesCount = 0;

    while (completedLeagueSplit.status !== LeagueSplitStatus.COMPLETED) {
      const activeStage = completedLeagueSplit.stages.find(
        (stage) => stage.status === LeagueStageStatus.ACTIVE,
      )!;
      const activeFixture = activeStage.fixtures.find(
        (fixture) =>
          fixture.roundNumber === activeStage.currentRound &&
          fixture.status !== LeagueFixtureStatus.COMPLETED,
      )!;

      expect(activeFixture.bestOf).toBe(5);
      completedLeagueSplit = (await playLeagueFixture(activeFixture.id)).split;
      playoffSeriesCount += 1;
      expect(playoffSeriesCount).toBeLessThanOrEqual(3);
    }

    expect(completedLeagueSplit.status).toBe(LeagueSplitStatus.COMPLETED);
    expect(completedLeagueSplit.activeStageCode).toBeNull();
    expect(playoffSeriesCount).toBeGreaterThanOrEqual(2);
    expect(
      completedLeagueSplit.fixtures.every(
        (fixture) => fixture.status === LeagueFixtureStatus.COMPLETED,
      ),
    ).toBe(true);
    expect(
      completedLeagueSplit.standings.every((standing) => standing.played === 1),
    ).toBe(true);
    expect(
      completedLeagueSplit.standings.reduce(
        (total, standing) => total + standing.seriesWins,
        0,
      ),
    ).toBe(1);
    expect(
      completedLeagueSplit.standings.reduce(
        (total, standing) => total + standing.gameWins,
        0,
      ),
    ).toBe(firstLeagueSeries.series.games.length);

    const leagueSplitListResponse = await api
      .get(`/careers/${career.id}/league-splits`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(leagueSplitListResponse.body).toEqual([completedLeagueSplit]);

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

      if (leagueSplitId !== undefined) {
        expect(
          await dataSource
            .getRepository(LeagueSplit)
            .countBy({ id: leagueSplitId }),
        ).toBe(0);
      }

      if (feedbackId !== undefined) {
        expect(
          await dataSource
            .getRepository(MatchFeedback)
            .countBy({ id: feedbackId }),
        ).toBe(0);
        expect(
          await dataSource
            .getRepository(MatchFeedbackPlayerEffect)
            .countBy({ feedbackId }),
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
