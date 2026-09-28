import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { MatchSimulationResponseDto } from '../matches/dto/match-simulation-response.dto';
import { SimulateMatchDto } from '../matches/dto/simulate-match.dto';
import { Match } from '../matches/entities/match.entity';
import {
  MatchesService,
  MatchSeriesGameContext,
} from '../matches/matches.service';
import { Position } from '../players/enums/position.enum';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { updateSeriesDraft } from '../drafts/series-draft.store';
import { MatchSeries } from './entities/match-series.entity';
import { MatchSeriesStatus } from './enums/match-series-status.enum';
import { MatchSeriesService } from './match-series.service';
import * as seriesDraftStore from '../drafts/series-draft.store';

jest.spyOn(seriesDraftStore, 'updateSeriesDraft');

describe('MatchSeriesService', () => {
  const career = { id: 1, accountId: 7, currentMeta: TeamStrategy.BALANCED };
  const teamA = {
    id: 1,
    careerId: 1,
    career,
    code: 'TEAM_A',
  } as CareerTeam;
  const teamB = {
    id: 2,
    careerId: 1,
    career,
    code: 'TEAM_B',
  } as CareerTeam;
  const series = {
    id: 10,
    careerId: 1,
    career,
    teamAId: teamA.id,
    teamA,
    teamBId: teamB.id,
    teamB,
    seed: 100,
    bestOf: 3,
    games: [],
  } as unknown as MatchSeries;
  const matchSeriesRepository = {
    create: jest.fn((value: Partial<MatchSeries>) => value as MatchSeries),
    save: jest.fn((value: MatchSeries) => {
      value.id ??= series.id;
      return Promise.resolve(value);
    }),
    findOne: jest.fn(),
  };
  const careerTeamsRepository = {
    find: jest.fn(),
  };
  const matchesService = {
    simulate: jest.fn(),
    findOne: jest.fn(),
  };
  const leagueFixturesRepository = { findOneBy: jest.fn() };
  const manager = {
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    getRepository: (entity: unknown) =>
      entity === CareerTeam ? careerTeamsRepository : matchSeriesRepository,
  };
  const dataSource = {
    manager: { existsBy: jest.fn().mockResolvedValue(false) },
    transaction: (
      isolationOrWork: string | ((value: typeof manager) => Promise<unknown>),
      isolatedWork?: (value: typeof manager) => Promise<unknown>,
    ) =>
      (typeof isolationOrWork === 'function' ? isolationOrWork : isolatedWork!)(
        manager,
      ),
  };

  let service: MatchSeriesService;
  let winners: number[];
  let simulatedSeeds: number[];

  beforeEach(() => {
    jest.clearAllMocks();
    series.games = [];
    series.drafts = null;
    series.bestOf = 3;
    for (const team of [teamA, teamB]) {
      team.isUserControlled = false;
      team.teamStrategy = TeamStrategy.BALANCED;
      team.rosters = Object.values(Position).map((position, index) => ({
        role: RosterRole.STARTER,
        starterPosition: position,
        playerInstruction: null,
        careerPlayerId: team.id * 100 + index,
        careerPlayer: {
          id: team.id * 100 + index,
          currentMechanics: 70,
          currentGameSense: 70,
          currentLaning: 70,
          currentTeamFight: 70,
          playerCard: { player: { nickname: `${team.code}-${position}` } },
        },
      })) as CareerTeam['rosters'];
    }
    winners = [teamA.id, teamB.id, teamA.id];
    simulatedSeeds = [];
    leagueFixturesRepository.findOneBy.mockResolvedValue(null);
    careerTeamsRepository.find.mockResolvedValue([teamA, teamB]);
    manager.findOne.mockImplementation((entity: unknown) =>
      Promise.resolve(
        entity === Career ? career : entity === MatchSeries ? series : null,
      ),
    );
    manager.find.mockImplementation((entity: unknown) =>
      Promise.resolve(entity === CareerTeam ? [teamA, teamB] : []),
    );
    manager.update.mockImplementation(
      (entity: unknown, id: number, values: Partial<MatchSeries>) => {
        if (entity !== MatchSeries || id !== series.id)
          throw new Error('Unexpected update');
        Object.assign(series, values);
        return Promise.resolve({ affected: 1 });
      },
    );
    matchSeriesRepository.findOne.mockResolvedValue(series);
    matchesService.findOne.mockImplementation(
      (_accountId: number, matchId: number) => {
        const game = series.games.find(
          (candidate) => candidate.id === matchId,
        )!;

        return Promise.resolve(
          createMatchResponse(game.seriesGameNumber!, game.winnerTeamId),
        );
      },
    );
    matchesService.simulate.mockImplementation(
      (
        _accountId: number,
        dto: SimulateMatchDto,
        context: MatchSeriesGameContext,
      ) => {
        const game = {
          id: 100 + context.gameNumber,
          seriesId: context.series.id,
          seriesGameNumber: context.gameNumber,
          winnerTeamId: winners[context.gameNumber - 1],
        } as Match;

        series.games.push(game);
        simulatedSeeds.push(dto.seed);
        return Promise.resolve(
          createMatchResponse(context.gameNumber, game.winnerTeamId),
        );
      },
    );
    service = new MatchSeriesService(
      matchSeriesRepository as unknown as Repository<MatchSeries>,
      careerTeamsRepository as unknown as Repository<CareerTeam>,
      matchesService as unknown as MatchesService,
      leagueFixturesRepository as unknown as Repository<LeagueFixture>,
      dataSource as unknown as DataSource,
    );
  });

  it('keeps the public simulation route available for standalone series', async () => {
    const result = await service.simulateStandaloneNextGame(7, series.id);

    expect(result.games).toHaveLength(1);
    expect(matchesService.simulate).toHaveBeenCalledTimes(1);
    const draft = series.drafts?.['1'];
    expect(draft).toEqual(
      expect.objectContaining({
        version: 3,
        completed: true,
        assignmentsConfirmed: true,
      }),
    );
    expect(matchesService.simulate.mock.calls[0][2].draft).toEqual(
      expect.objectContaining(draft!),
    );
  });

  it('prevents direct series simulation from bypassing league progression', async () => {
    leagueFixturesRepository.findOneBy.mockResolvedValue({ id: 501 });

    await expect(
      service.simulateStandaloneNextGame(7, series.id),
    ).rejects.toThrow('use the league fixture simulation endpoint');
    expect(matchesService.simulate).not.toHaveBeenCalled();
    expect(series.games).toHaveLength(0);
  });

  it('does not reveal linked fixtures before verifying series ownership', async () => {
    matchSeriesRepository.findOne.mockResolvedValue(null);

    await expect(
      service.simulateStandaloneNextGame(8, series.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leagueFixturesRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('creates an owned BO3 series before Game 1', async () => {
    const result = await service.create(7, {
      careerId: 1,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 100,
    });

    expect(result.status).toBe(MatchSeriesStatus.IN_PROGRESS);
    expect(result.bestOf).toBe(3);
    expect(result.winsRequired).toBe(2);
    expect(result.nextGameNumber).toBe(1);
    expect(result.games).toEqual([]);
  });

  it('does not create a series for a dismissed manager', async () => {
    manager.findOne.mockImplementation((entity: unknown) =>
      Promise.resolve(entity === Career ? career : { status: 'DISMISSED' }),
    );
    await expect(
      service.create(7, {
        careerId: 1,
        teamAId: teamA.id,
        teamBId: teamB.id,
        seed: 100,
      }),
    ).rejects.toThrow('경질된 감독');
    expect(matchSeriesRepository.save).not.toHaveBeenCalled();
  });

  it('plays Game 1, adjustment break, Game 2 and Game 3 until two wins', async () => {
    const game1 = await service.simulateNextGame(7, series.id);
    const game2 = await service.simulateNextGame(7, series.id);
    const game3 = await service.simulateNextGame(7, series.id);

    expect(game1.teams.map((team) => team.wins)).toEqual([1, 0]);
    expect(game1.nextGameNumber).toBe(2);
    expect(game2.teams.map((team) => team.wins)).toEqual([1, 1]);
    expect(game2.nextGameNumber).toBe(3);
    expect(game3.status).toBe(MatchSeriesStatus.COMPLETED);
    expect(game3.winnerTeamId).toBe(teamA.id);
    expect(game3.nextGameNumber).toBeNull();
    expect(game3.games).toHaveLength(3);
    expect(simulatedSeeds).toEqual([100, 101, 102]);
    expect(updateSeriesDraft).toHaveBeenNthCalledWith(
      1,
      dataSource,
      7,
      series.id,
      1,
      undefined,
      true,
      true,
    );
    expect(updateSeriesDraft).toHaveBeenNthCalledWith(
      2,
      dataSource,
      7,
      series.id,
      2,
      undefined,
      true,
      true,
    );
    await expect(service.simulateNextGame(7, series.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('plays a BO5 until one team reaches three wins', async () => {
    series.bestOf = 5;
    winners = [teamA.id, teamB.id, teamA.id, teamB.id, teamA.id];

    let result = await service.simulateNextGame(7, series.id);
    result = await service.simulateNextGame(7, series.id);
    result = await service.simulateNextGame(7, series.id);
    result = await service.simulateNextGame(7, series.id);
    result = await service.simulateNextGame(7, series.id);

    expect(result.bestOf).toBe(5);
    expect(result.winsRequired).toBe(3);
    expect(result.status).toBe(MatchSeriesStatus.COMPLETED);
    expect(result.winnerTeamId).toBe(teamA.id);
    expect(result.games).toHaveLength(5);
    const drafts = Object.values(series.drafts!);
    const picks = drafts.flatMap((draft) =>
      draft.actions
        .filter((action) => action.kind === 'PICK')
        .map((action) => action.variantId),
    );
    expect(drafts).toHaveLength(5);
    expect(
      drafts.every((draft) => draft.completed && draft.assignmentsConfirmed),
    ).toBe(true);
    expect(picks).toHaveLength(50);
    expect(new Set(picks).size).toBe(50);
  });

  it('completes a BO1 after one game', async () => {
    series.bestOf = 1;

    const result = await service.simulateNextGame(7, series.id);

    expect(result.bestOf).toBe(1);
    expect(result.winsRequired).toBe(1);
    expect(result.status).toBe(MatchSeriesStatus.COMPLETED);
    expect(result.games).toHaveLength(1);
  });

  it('keeps direct draft choices outside automatic delegation', async () => {
    await service.simulateNextGame(7, series.id, {
      requireDraft: true,
      expectedGameNumber: 1,
    });
    expect(updateSeriesDraft).toHaveBeenCalledWith(
      dataSource,
      7,
      series.id,
      1,
      undefined,
      true,
      false,
    );
  });

  it('reconnecting with an already committed set does not advance another set or draft', async () => {
    await service.simulateNextGame(7, series.id);
    jest.mocked(updateSeriesDraft).mockClear();
    matchesService.simulate.mockClear();
    const result = await service.simulateNextGame(7, series.id, {
      requireDraft: true,
      expectedGameNumber: 1,
    });
    expect(result.games).toHaveLength(1);
    expect(updateSeriesDraft).not.toHaveBeenCalled();
    expect(matchesService.simulate).not.toHaveBeenCalled();
  });

  it('returns a structured analysis of the latest game', async () => {
    await service.simulateNextGame(7, series.id);

    const analysis = await service.analyze(7, series.id);

    expect(analysis.analyzedGameNumber).toBe(1);
    expect(analysis.adjustmentsAllowed).toBe(true);
    expect(analysis.teams?.[0]).toEqual(
      expect.objectContaining({
        teamId: teamA.id,
        won: true,
        performanceGap: 4,
        killGap: 2,
        goldGap: 1000,
        gdAt15: 500,
        averageRating: 7,
      }),
    );
    expect(analysis.teams?.[0].playerPlans).toHaveLength(5);
  });

  it('returns an already committed requested set without starting the next draft', async () => {
    await service.simulateNextGame(7, series.id, {
      requireDraft: false,
      expectedGameNumber: 1,
    });
    const savedDrafts = JSON.stringify(series.drafts);
    manager.update.mockClear();

    const retry = await service.simulateNextGame(7, series.id, {
      requireDraft: false,
      expectedGameNumber: 1,
    });

    expect(retry.games).toHaveLength(1);
    expect(retry.nextGameNumber).toBe(2);
    expect(matchesService.simulate).toHaveBeenCalledTimes(1);
    expect(manager.update).not.toHaveBeenCalled();
    expect(JSON.stringify(series.drafts)).toBe(savedDrafts);
    expect(series.drafts?.['2']).toBeUndefined();
  });

  it('rejects a future requested set before drafting or simulation', async () => {
    await expect(
      service.simulateNextGame(7, series.id, {
        requireDraft: false,
        expectedGameNumber: 2,
      }),
    ).rejects.toThrow('현재 세트 번호가 달라졌습니다');
    expect(manager.update).not.toHaveBeenCalled();
    expect(matchesService.simulate).not.toHaveBeenCalled();
  });

  it('keeps mandatory human draft decisions pending for direct play', async () => {
    teamA.isUserControlled = true;

    await expect(
      service.simulateNextGame(7, series.id, {
        requireDraft: true,
        expectedGameNumber: 1,
      }),
    ).rejects.toThrow('밴픽을 먼저 완료');

    expect(series.drafts).toBeNull();
    expect(manager.update).not.toHaveBeenCalled();
    expect(matchesService.simulate).not.toHaveBeenCalled();
  });

  it('requires the explicit set number after a human draft is complete and preserves the decisions', async () => {
    teamA.isUserControlled = true;
    // Complete a legal stored draft; direct simulation must consume this exact snapshot.
    await updateSeriesDraft(
      dataSource as unknown as DataSource,
      7,
      series.id,
      1,
      undefined,
      true,
      true,
    );
    const decisions = JSON.stringify(series.drafts?.['1']);

    await expect(
      service.simulateNextGame(7, series.id, { requireDraft: true }),
    ).rejects.toThrow('세트 번호를 지정');
    expect(matchesService.simulate).not.toHaveBeenCalled();
    await service.simulateNextGame(7, series.id, {
      requireDraft: true,
      expectedGameNumber: 1,
    });

    expect(JSON.stringify(series.drafts?.['1'])).toBe(decisions);
    expect(matchesService.simulate).toHaveBeenCalledTimes(1);
    expect(matchesService.simulate.mock.calls[0][2].draft).toEqual(
      expect.objectContaining(JSON.parse(decisions!)),
    );
    expect(series.drafts?.['2']).toBeUndefined();
  });

  it.each([true, false])(
    'keeps unavailable 15-minute aggregate null (all missing: %s)',
    async (allMissing) => {
      await service.simulateNextGame(7, series.id);
      const response = createMatchResponse(1, teamA.id);
      for (const team of response.teams)
        team.playerStats.forEach((player, index) => {
          if (allMissing || index === 0) player.gdAt15 = null;
        });
      matchesService.findOne.mockResolvedValue(response);

      const analysis = await service.analyze(7, series.id);

      expect(analysis.teams?.map((team) => team.gdAt15)).toEqual([null, null]);
    },
  );

  it('rejects a series where both ids point to the same team', async () => {
    await expect(
      service.create(7, {
        careerId: 1,
        teamAId: teamA.id,
        teamBId: teamA.id,
        seed: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(careerTeamsRepository.find).not.toHaveBeenCalled();
  });

  it('hides a series outside the account', async () => {
    matchSeriesRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne(8, series.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function createMatchResponse(
  gameNumber: number,
  winnerTeamId: number,
): MatchSimulationResponseDto {
  const createTeam = (
    teamId: number,
    teamCode: string,
    performance: number,
    teamKills: number,
    gold: number,
    gdAt15: number,
    rating: number,
  ) => ({
    teamId,
    teamCode,
    teamStrategy: TeamStrategy.BALANCED,
    strategyProficiency: 50,
    strategyProficiencyModifier: 0,
    metaModifier: 0,
    chemistry: 50,
    effectiveChemistry: 50,
    chemistryModifier: 0,
    activeSetBonuses: [],
    setBonusModifier: 0,
    archetypeModifier: 0,
    stateModifier: 0,
    baseAbility: 70,
    rngModifier: 0,
    performance,
    teamKills,
    playerStats: Object.values(Position).map((position, index) => ({
      careerPlayerId: teamId * 100 + index,
      position,
      playerInstruction: null,
      roleProficiency: null,
      positionProficiency: 100,
      championArchetype: null,
      form: 50,
      condition: 100,
      mental: 70,
      formModifier: 0,
      conditionModifier: 0,
      mentalModifier: 1.6,
      stateModifier: 1.6,
      formAfter: 50,
      conditionAfter: 95,
      mentalAfter: 70,
      kills: index === 0 ? teamKills : 0,
      deaths: 0,
      assists: 0,
      kda: 0,
      dpm: 0,
      damageShare: 20,
      gold: index === 0 ? gold - 4 * 10000 : 10000,
      goldShare: 20,
      gdAt15: index === 0 ? gdAt15 : 0,
      csdAt15: 0,
      kp: 0,
      rating,
    })),
  });

  return {
    matchId: 100 + gameNumber,
    careerId: 1,
    seriesId: 10,
    seriesGameNumber: gameNumber,
    currentMeta: TeamStrategy.BALANCED,
    seed: 99 + gameNumber,
    durationMinutes: 30,
    winnerTeamId,
    winnerTeamCode: winnerTeamId === 1 ? 'TEAM_A' : 'TEAM_B',
    teams: [
      createTeam(1, 'TEAM_A', 72, 12, 52000, 500, 7),
      createTeam(2, 'TEAM_B', 68, 10, 51000, -500, 6),
    ],
  };
}
