import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { PlayerInstruction } from '../careers/enums/player-instruction.enum';
import { ChampionArchetype } from '../careers/enums/champion-archetype.enum';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { Position } from '../players/enums/position.enum';
import { SetBonus } from '../set-bonuses/entities/set-bonus.entity';
import {
  findActiveSetBonuses,
  toSetBonusSnapshot,
} from '../set-bonuses/set-bonus.utils';
import { SIMPLE_MATCH_CONFIG } from './config/simple-match.config';
import {
  MatchPlayerStatResponseDto,
  MatchSimulationResponseDto,
  MatchTeamSimulationResponseDto,
} from './dto/match-simulation-response.dto';
import { SimulateMatchDto } from './dto/simulate-match.dto';
import { MatchPlayerStat } from './entities/match-player-stat.entity';
import { Match } from './entities/match.entity';
import { MatchStatsSimulationService } from './simulation/match-stats-simulation.service';
import { MatchStatsSimulationResult } from './simulation/match-stats.types';
import { SimpleMatchSimulationService } from './simulation/simple-match-simulation.service';
import {
  SimpleMatchSimulationResult,
  SimpleMatchTeamInput,
  SimpleMatchTeamResult,
} from './simulation/simple-match.types';

export interface MatchSeriesGameContext {
  series: MatchSeries;
  gameNumber: number;
}

@Injectable()
export class MatchesService {
  constructor(
    @InjectRepository(CareerTeam)
    private readonly careerTeamsRepository: Repository<CareerTeam>,
    @InjectRepository(Match)
    private readonly matchesRepository: Repository<Match>,
    @InjectRepository(SetBonus)
    private readonly setBonusesRepository: Repository<SetBonus>,
    private readonly dataSource: DataSource,
    private readonly simulationService: SimpleMatchSimulationService,
    private readonly matchStatsSimulationService: MatchStatsSimulationService,
  ) {}

  async findOne(
    accountId: number,
    id: number,
  ): Promise<MatchSimulationResponseDto> {
    const match = await this.matchesRepository.findOne({
      where: { id, career: { accountId } },
      relations: {
        career: true,
        teamA: true,
        teamB: true,
        winnerTeam: true,
        playerStats: true,
      },
    });

    if (!match) {
      throw new NotFoundException(`Match ${id} not found`);
    }

    return {
      matchId: match.id,
      careerId: match.careerId,
      seriesId: match.seriesId,
      seriesGameNumber: match.seriesGameNumber,
      currentMeta: match.currentMeta,
      seed: match.seed,
      durationMinutes: match.durationMinutes,
      winnerTeamId: match.winnerTeamId,
      winnerTeamCode: match.winnerTeam.code,
      teams: [
        this.toStoredTeamResponse(match, 'A'),
        this.toStoredTeamResponse(match, 'B'),
      ],
    };
  }

  async simulate(
    accountId: number,
    dto: SimulateMatchDto,
    seriesContext?: MatchSeriesGameContext,
  ): Promise<MatchSimulationResponseDto> {
    if (dto.teamAId === dto.teamBId) {
      throw new BadRequestException('A team cannot play against itself');
    }

    const [careerTeams, setBonuses] = await Promise.all([
      this.careerTeamsRepository.find({
        where: {
          id: In([dto.teamAId, dto.teamBId]),
          careerId: dto.careerId,
          career: { accountId },
        },
        relations: {
          career: true,
          strategyProficiencies: true,
          rosters: {
            careerPlayer: {
              roleProficiencies: true,
            },
          },
        },
      }),
      this.setBonusesRepository.find({
        relations: { requirements: true },
        order: { id: 'ASC' },
      }),
    ]);
    const careerTeamsById = new Map(
      careerTeams.map((careerTeam) => [careerTeam.id, careerTeam]),
    );
    const teamA = careerTeamsById.get(dto.teamAId);
    const teamB = careerTeamsById.get(dto.teamBId);

    if (!teamA || !teamB) {
      const missingTeamIds = [dto.teamAId, dto.teamBId].filter(
        (teamId) => !careerTeamsById.has(teamId),
      );

      throw new NotFoundException(
        `CareerTeams not found in Career ${dto.careerId}: ${missingTeamIds.join(', ')}`,
      );
    }

    const teamAInput = this.toSimulationInput(teamA, setBonuses);
    const teamBInput = this.toSimulationInput(teamB, setBonuses);
    const result = this.simulationService.simulate(
      teamAInput,
      teamBInput,
      dto.seed,
      teamA.career.currentMeta,
    );
    const statsResult = this.matchStatsSimulationService.simulate(
      teamAInput,
      teamBInput,
      result,
      dto.seed,
    );
    const matchId = await this.persistMatch(
      dto,
      result,
      statsResult,
      teamA,
      teamB,
      seriesContext,
    );

    return {
      matchId,
      careerId: dto.careerId,
      seriesId: seriesContext?.series.id ?? null,
      seriesGameNumber: seriesContext?.gameNumber ?? null,
      currentMeta: result.currentMeta,
      seed: result.seed,
      durationMinutes: statsResult.durationMinutes,
      winnerTeamId: result.winnerTeamId,
      winnerTeamCode: result.winnerTeamCode,
      teams: result.teams.map((teamResult) => {
        const teamStats = statsResult.teams.find(
          (candidate) => candidate.teamId === teamResult.teamId,
        )!;

        return {
          ...teamResult,
          teamKills: teamStats.teamKills,
          playerStats: teamStats.playerStats.map((playerStat) => {
            const { careerTeamId, ...response } = playerStat;

            void careerTeamId;
            return response;
          }),
        };
      }),
    };
  }

  private toSimulationInput(
    careerTeam: CareerTeam,
    setBonuses: SetBonus[],
  ): SimpleMatchTeamInput {
    const positionOrder = new Map(
      STARTER_POSITIONS.map((position, index) => [position, index]),
    );
    const starters = careerTeam.rosters
      .filter(
        (roster) =>
          roster.role === RosterRole.STARTER && roster.starterPosition !== null,
      )
      .sort(
        (left, right) =>
          (positionOrder.get(left.starterPosition!) ?? 0) -
          (positionOrder.get(right.starterPosition!) ?? 0),
      );
    const starterPositions = new Set(
      starters.map((starter) => starter.starterPosition),
    );

    if (
      starters.length !== SIMPLE_MATCH_CONFIG.requiredStarterCount ||
      !STARTER_POSITIONS.every((position) => starterPositions.has(position))
    ) {
      throw new ConflictException(
        `CareerTeam ${careerTeam.id} does not have a complete starting roster`,
      );
    }

    const strategyProficiency = (careerTeam.strategyProficiencies ?? []).find(
      (candidate) => candidate.strategy === careerTeam.teamStrategy,
    )?.proficiency;

    if (strategyProficiency === undefined) {
      throw new ConflictException(
        `CareerTeam ${careerTeam.id} is missing ${careerTeam.teamStrategy} strategy proficiency`,
      );
    }

    return {
      teamId: careerTeam.id,
      teamCode: careerTeam.code,
      teamStrategy: careerTeam.teamStrategy,
      strategyProficiency,
      chemistry: careerTeam.chemistry,
      activeSetBonuses: findActiveSetBonuses(
        setBonuses,
        starters.map((starter) => starter.careerPlayer.playerCardId),
      ).map((setBonus) => toSetBonusSnapshot(setBonus)),
      players: starters.map((starter) =>
        this.toPlayerStats(
          starter.careerPlayer,
          starter.starterPosition!,
          starter.playerInstruction,
          starter.championArchetype,
        ),
      ),
    };
  }

  private toPlayerStats(
    careerPlayer: CareerPlayer,
    position: Position,
    playerInstruction: PlayerInstruction | null,
    championArchetype: ChampionArchetype | null,
  ) {
    const roleProficiency = playerInstruction
      ? ((careerPlayer.roleProficiencies ?? []).find(
          (candidate) =>
            candidate.position === position &&
            candidate.instruction === playerInstruction,
        )?.proficiency ?? null)
      : null;

    return {
      careerPlayerId: careerPlayer.id,
      position,
      playerInstruction,
      roleProficiency,
      championArchetype,
      mechanics: careerPlayer.currentMechanics,
      gameSense: careerPlayer.currentGameSense,
      laning: careerPlayer.currentLaning,
      teamFight: careerPlayer.currentTeamFight,
      macro: careerPlayer.currentMacro,
      teamPlay: careerPlayer.currentTeamPlay,
      mental: careerPlayer.currentMental,
      championPool: careerPlayer.currentChampionPool,
    };
  }

  private persistMatch(
    dto: SimulateMatchDto,
    result: SimpleMatchSimulationResult,
    statsResult: MatchStatsSimulationResult,
    teamA: CareerTeam,
    teamB: CareerTeam,
    seriesContext?: MatchSeriesGameContext,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const teamAResult = this.findTeamResult(result, teamA.id);
      const teamBResult = this.findTeamResult(result, teamB.id);
      const match = manager.create(Match, {
        careerId: dto.careerId,
        seriesId: seriesContext?.series.id ?? null,
        series: seriesContext?.series ?? null,
        seriesGameNumber: seriesContext?.gameNumber ?? null,
        teamAId: teamA.id,
        teamA,
        teamBId: teamB.id,
        teamB,
        winnerTeamId: result.winnerTeamId,
        winnerTeam: result.winnerTeamId === teamA.id ? teamA : teamB,
        seed: dto.seed,
        durationMinutes: statsResult.durationMinutes,
        teamABaseAbility: teamAResult.baseAbility,
        teamARngModifier: teamAResult.rngModifier,
        teamAPerformance: teamAResult.performance,
        teamAStrategy: teamAResult.teamStrategy,
        teamAStrategyProficiency: teamAResult.strategyProficiency,
        teamAStrategyProficiencyModifier:
          teamAResult.strategyProficiencyModifier,
        teamAMetaModifier: teamAResult.metaModifier,
        teamAChemistry: teamAResult.chemistry,
        teamAEffectiveChemistry: teamAResult.effectiveChemistry,
        teamAChemistryModifier: teamAResult.chemistryModifier,
        teamASetBonusModifier: teamAResult.setBonusModifier,
        teamAActiveSetBonuses: teamAResult.activeSetBonuses,
        teamAArchetypeModifier: teamAResult.archetypeModifier,
        teamBBaseAbility: teamBResult.baseAbility,
        teamBRngModifier: teamBResult.rngModifier,
        teamBPerformance: teamBResult.performance,
        teamBStrategy: teamBResult.teamStrategy,
        teamBStrategyProficiency: teamBResult.strategyProficiency,
        teamBStrategyProficiencyModifier:
          teamBResult.strategyProficiencyModifier,
        teamBMetaModifier: teamBResult.metaModifier,
        teamBChemistry: teamBResult.chemistry,
        teamBEffectiveChemistry: teamBResult.effectiveChemistry,
        teamBChemistryModifier: teamBResult.chemistryModifier,
        teamBSetBonusModifier: teamBResult.setBonusModifier,
        teamBActiveSetBonuses: teamBResult.activeSetBonuses,
        teamBArchetypeModifier: teamBResult.archetypeModifier,
        currentMeta: result.currentMeta,
      });
      const savedMatch = await manager.save(Match, match);
      const playerStats = statsResult.teams.flatMap((teamStats) =>
        teamStats.playerStats.map((playerStat) =>
          manager.create(MatchPlayerStat, {
            ...playerStat,
            matchId: savedMatch.id,
            match: savedMatch,
          }),
        ),
      );

      await manager.save(MatchPlayerStat, playerStats);

      return savedMatch.id;
    });
  }

  private findTeamResult(
    result: SimpleMatchSimulationResult,
    teamId: number,
  ): SimpleMatchTeamResult {
    return result.teams.find((teamResult) => teamResult.teamId === teamId)!;
  }

  private toStoredTeamResponse(
    match: Match,
    side: 'A' | 'B',
  ): MatchTeamSimulationResponseDto {
    const team = side === 'A' ? match.teamA : match.teamB;
    const playerStats = match.playerStats
      .filter((playerStat) => playerStat.careerTeamId === team.id)
      .sort(
        (left, right) =>
          STARTER_POSITIONS.indexOf(left.position) -
          STARTER_POSITIONS.indexOf(right.position),
      );

    return {
      teamId: team.id,
      teamCode: team.code,
      teamStrategy: side === 'A' ? match.teamAStrategy : match.teamBStrategy,
      strategyProficiency:
        side === 'A'
          ? match.teamAStrategyProficiency
          : match.teamBStrategyProficiency,
      strategyProficiencyModifier:
        side === 'A'
          ? match.teamAStrategyProficiencyModifier
          : match.teamBStrategyProficiencyModifier,
      metaModifier:
        side === 'A' ? match.teamAMetaModifier : match.teamBMetaModifier,
      chemistry: side === 'A' ? match.teamAChemistry : match.teamBChemistry,
      effectiveChemistry:
        side === 'A'
          ? match.teamAEffectiveChemistry
          : match.teamBEffectiveChemistry,
      chemistryModifier:
        side === 'A'
          ? match.teamAChemistryModifier
          : match.teamBChemistryModifier,
      activeSetBonuses:
        (side === 'A'
          ? match.teamAActiveSetBonuses
          : match.teamBActiveSetBonuses) ?? [],
      setBonusModifier:
        side === 'A'
          ? match.teamASetBonusModifier
          : match.teamBSetBonusModifier,
      archetypeModifier:
        side === 'A'
          ? match.teamAArchetypeModifier
          : match.teamBArchetypeModifier,
      baseAbility:
        side === 'A' ? match.teamABaseAbility : match.teamBBaseAbility,
      rngModifier:
        side === 'A' ? match.teamARngModifier : match.teamBRngModifier,
      performance:
        side === 'A' ? match.teamAPerformance : match.teamBPerformance,
      teamKills: playerStats.reduce(
        (total, playerStat) => total + playerStat.kills,
        0,
      ),
      playerStats: playerStats.map((playerStat) =>
        this.toStoredPlayerStatResponse(playerStat),
      ),
    };
  }

  private toStoredPlayerStatResponse(
    playerStat: MatchPlayerStat,
  ): MatchPlayerStatResponseDto {
    return {
      careerPlayerId: playerStat.careerPlayerId,
      position: playerStat.position,
      playerInstruction: playerStat.playerInstruction,
      roleProficiency: playerStat.roleProficiency,
      championArchetype: playerStat.championArchetype,
      kills: playerStat.kills,
      deaths: playerStat.deaths,
      assists: playerStat.assists,
      kda: playerStat.kda,
      dpm: playerStat.dpm,
      damageShare: playerStat.damageShare,
      gold: playerStat.gold,
      goldShare: playerStat.goldShare,
      gdAt15: playerStat.gdAt15,
      csdAt15: playerStat.csdAt15,
      kp: playerStat.kp,
      rating: playerStat.rating,
    };
  }
}
