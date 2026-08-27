import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { MatchSimulationResponseDto } from '../matches/dto/match-simulation-response.dto';
import { SimulateMatchDto } from '../matches/dto/simulate-match.dto';
import { Match } from '../matches/entities/match.entity';
import {
  MatchesService,
  MatchSeriesGameContext,
} from '../matches/matches.service';
import { Position } from '../players/enums/position.enum';
import { MatchSeries } from './entities/match-series.entity';
import { MatchSeriesStatus } from './enums/match-series-status.enum';
import { MatchSeriesService } from './match-series.service';

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

  let service: MatchSeriesService;
  let winners: number[];
  let simulatedSeeds: number[];

  beforeEach(() => {
    jest.clearAllMocks();
    series.games = [];
    winners = [teamA.id, teamB.id, teamA.id];
    simulatedSeeds = [];
    careerTeamsRepository.find.mockResolvedValue([teamA, teamB]);
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
    );
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
    await expect(service.simulateNextGame(7, series.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
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
