import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { MatchSimulationResponseDto } from '../matches/dto/match-simulation-response.dto';
import { MatchesService } from '../matches/matches.service';
import { BO3_SERIES_CONFIG } from './config/bo3-series.config';
import { CreateMatchSeriesDto } from './dto/create-match-series.dto';
import {
  MatchSeriesAnalysisResponseDto,
  MatchSeriesResponseDto,
  MatchSeriesTeamAnalysisDto,
  MatchSeriesTeamResponseDto,
} from './dto/match-series-response.dto';
import { MatchSeries } from './entities/match-series.entity';
import { MatchSeriesStatus } from './enums/match-series-status.enum';
import { deriveSeriesGameSeed } from './match-series.utils';

@Injectable()
export class MatchSeriesService {
  constructor(
    @InjectRepository(MatchSeries)
    private readonly matchSeriesRepository: Repository<MatchSeries>,
    @InjectRepository(CareerTeam)
    private readonly careerTeamsRepository: Repository<CareerTeam>,
    private readonly matchesService: MatchesService,
  ) {}

  async create(
    accountId: number,
    dto: CreateMatchSeriesDto,
  ): Promise<MatchSeriesResponseDto> {
    if (dto.teamAId === dto.teamBId) {
      throw new BadRequestException('A team cannot play against itself');
    }

    const careerTeams = await this.careerTeamsRepository.find({
      where: {
        id: In([dto.teamAId, dto.teamBId]),
        careerId: dto.careerId,
        career: { accountId },
      },
      relations: { career: true },
    });
    const teamsById = new Map(careerTeams.map((team) => [team.id, team]));
    const teamA = teamsById.get(dto.teamAId);
    const teamB = teamsById.get(dto.teamBId);

    if (!teamA || !teamB) {
      const missingTeamIds = [dto.teamAId, dto.teamBId].filter(
        (teamId) => !teamsById.has(teamId),
      );

      throw new NotFoundException(
        `CareerTeams not found in Career ${dto.careerId}: ${missingTeamIds.join(', ')}`,
      );
    }

    const series = await this.matchSeriesRepository.save(
      this.matchSeriesRepository.create({
        careerId: dto.careerId,
        career: teamA.career,
        teamAId: teamA.id,
        teamA,
        teamBId: teamB.id,
        teamB,
        seed: dto.seed,
        games: [],
      }),
    );

    return this.toResponse(accountId, series);
  }

  async findOne(
    accountId: number,
    id: number,
  ): Promise<MatchSeriesResponseDto> {
    const series = await this.findOwnedSeries(accountId, id);

    return this.toResponse(accountId, series);
  }

  async simulateNextGame(
    accountId: number,
    id: number,
  ): Promise<MatchSeriesResponseDto> {
    const series = await this.findOwnedSeries(accountId, id);
    const state = this.calculateState(series);

    if (state.status === MatchSeriesStatus.COMPLETED) {
      throw new ConflictException(`MatchSeries ${id} is already completed`);
    }

    const gameNumber = state.nextGameNumber!;
    const seed = deriveSeriesGameSeed(series.seed, gameNumber);

    try {
      await this.matchesService.simulate(
        accountId,
        {
          careerId: series.careerId,
          teamAId: series.teamAId,
          teamBId: series.teamBId,
          seed,
        },
        { series, gameNumber },
      );
    } catch (error) {
      if (this.isDuplicateEntryError(error)) {
        throw new ConflictException(
          `Game ${gameNumber} has already been created for MatchSeries ${id}`,
        );
      }

      throw error;
    }

    return this.findOne(accountId, id);
  }

  async analyze(
    accountId: number,
    id: number,
  ): Promise<MatchSeriesAnalysisResponseDto> {
    const series = await this.findOne(accountId, id);
    const lastGame = series.games.at(-1) ?? null;

    if (!lastGame) {
      return {
        seriesId: series.seriesId,
        status: series.status,
        score: series.teams,
        analyzedGameNumber: null,
        adjustmentsAllowed: true,
        teams: null,
      };
    }

    const [teamA, teamB] = lastGame.teams;

    return {
      seriesId: series.seriesId,
      status: series.status,
      score: series.teams,
      analyzedGameNumber: lastGame.seriesGameNumber,
      adjustmentsAllowed: series.status === MatchSeriesStatus.IN_PROGRESS,
      teams: [
        this.toTeamAnalysis(lastGame, teamA, teamB),
        this.toTeamAnalysis(lastGame, teamB, teamA),
      ],
    };
  }

  private async findOwnedSeries(
    accountId: number,
    id: number,
  ): Promise<MatchSeries> {
    const series = await this.matchSeriesRepository.findOne({
      where: { id, career: { accountId } },
      relations: {
        career: true,
        teamA: true,
        teamB: true,
        games: true,
      },
    });

    if (!series) {
      throw new NotFoundException(`MatchSeries ${id} not found`);
    }

    series.games.sort(
      (left, right) =>
        (left.seriesGameNumber ?? 0) - (right.seriesGameNumber ?? 0),
    );

    return series;
  }

  private async toResponse(
    accountId: number,
    series: MatchSeries,
  ): Promise<MatchSeriesResponseDto> {
    const state = this.calculateState(series);
    const games = await Promise.all(
      series.games.map((game) =>
        this.matchesService.findOne(accountId, game.id),
      ),
    );

    return {
      seriesId: series.id,
      careerId: series.careerId,
      bestOf: BO3_SERIES_CONFIG.bestOf,
      winsRequired: BO3_SERIES_CONFIG.winsRequired,
      status: state.status,
      winnerTeamId: state.winnerTeamId,
      nextGameNumber: state.nextGameNumber,
      seed: series.seed,
      teams: [
        this.toSeriesTeam(series.teamA, state.teamAWins),
        this.toSeriesTeam(series.teamB, state.teamBWins),
      ],
      games,
    };
  }

  private calculateState(series: MatchSeries): {
    teamAWins: number;
    teamBWins: number;
    status: MatchSeriesStatus;
    winnerTeamId: number | null;
    nextGameNumber: number | null;
  } {
    const teamAWins = series.games.filter(
      (game) => game.winnerTeamId === series.teamAId,
    ).length;
    const teamBWins = series.games.filter(
      (game) => game.winnerTeamId === series.teamBId,
    ).length;
    const winnerTeamId =
      teamAWins >= BO3_SERIES_CONFIG.winsRequired
        ? series.teamAId
        : teamBWins >= BO3_SERIES_CONFIG.winsRequired
          ? series.teamBId
          : null;
    const status =
      winnerTeamId === null
        ? MatchSeriesStatus.IN_PROGRESS
        : MatchSeriesStatus.COMPLETED;

    if (
      status === MatchSeriesStatus.IN_PROGRESS &&
      series.games.length >= BO3_SERIES_CONFIG.maxGames
    ) {
      throw new ConflictException(
        `MatchSeries ${series.id} has an invalid BO3 score`,
      );
    }

    return {
      teamAWins,
      teamBWins,
      status,
      winnerTeamId,
      nextGameNumber:
        status === MatchSeriesStatus.IN_PROGRESS
          ? series.games.length + BO3_SERIES_CONFIG.firstGameNumber
          : null,
    };
  }

  private toSeriesTeam(
    team: CareerTeam,
    wins: number,
  ): MatchSeriesTeamResponseDto {
    return {
      teamId: team.id,
      teamCode: team.code,
      wins,
    };
  }

  private toTeamAnalysis(
    match: MatchSimulationResponseDto,
    team: MatchSimulationResponseDto['teams'][number],
    opponent: MatchSimulationResponseDto['teams'][number],
  ): MatchSeriesTeamAnalysisDto {
    const totalGold = team.playerStats.reduce(
      (total, player) => total + player.gold,
      0,
    );
    const opponentGold = opponent.playerStats.reduce(
      (total, player) => total + player.gold,
      0,
    );
    const gdAt15 = team.playerStats.reduce(
      (total, player) => total + player.gdAt15,
      0,
    );
    const averageRating =
      team.playerStats.reduce((total, player) => total + player.rating, 0) /
      team.playerStats.length;

    return {
      teamId: team.teamId,
      teamCode: team.teamCode,
      won: match.winnerTeamId === team.teamId,
      teamStrategy: team.teamStrategy,
      performance: team.performance,
      performanceGap: this.round(team.performance - opponent.performance),
      teamKills: team.teamKills,
      killGap: team.teamKills - opponent.teamKills,
      totalGold,
      goldGap: totalGold - opponentGold,
      gdAt15,
      averageRating: this.round(averageRating),
      playerPlans: team.playerStats.map((player) => ({
        careerPlayerId: player.careerPlayerId,
        position: player.position,
        playerInstruction: player.playerInstruction,
        championArchetype: player.championArchetype,
      })),
    };
  }

  private round(value: number): number {
    return Number(value.toFixed(BO3_SERIES_CONFIG.analysisDecimalPlaces));
  }

  private isDuplicateEntryError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { code?: string } | undefined;

    return driverError?.code === 'ER_DUP_ENTRY';
  }
}
