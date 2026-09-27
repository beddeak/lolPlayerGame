import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { PlayerInstruction } from '../careers/enums/player-instruction.enum';
import { ChampionArchetype } from '../careers/enums/champion-archetype.enum';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { Roster } from '../careers/entities/roster.entity';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { lockActiveManagerCareer } from '../manager-career/manager-access';
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
import { selectPlayerOfGame } from './match-awards';
import type { DraftState } from '../drafts/draft-state';
import { applyVariantDraft } from '../drafts/variant-match';
import { MatchFeedback } from '../match-series/entities/match-feedback.entity';
import { applyNextSetFeedback } from '../match-series/next-set-feedback';
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
  draft?: DraftState;
  feedbackIds?: number[];
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
        series: true,
      },
    });

    if (!match) {
      throw new NotFoundException(`Match ${id} not found`);
    }

    const response: MatchSimulationResponseDto = {
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
      draft: match.series?.drafts?.[String(match.seriesGameNumber)] ?? null,
    };
    return { ...response, pog: selectPlayerOfGame(response) };
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
              positionProficiencies: true,
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

    const draft = seriesContext?.draft;
    const feedbacks =
      seriesContext && seriesContext.gameNumber > 1
        ? await this.dataSource.manager.find(MatchFeedback, {
            where: {
              seriesId: seriesContext.series.id,
              afterGameNumber: seriesContext.gameNumber - 1,
            },
            relations: { effects: true },
            order: { id: 'ASC' },
          })
        : [];
    if (seriesContext) seriesContext.feedbackIds = feedbacks.map((f) => f.id);
    const teamAInput = applyNextSetFeedback(
      draft
        ? applyVariantDraft(this.toSimulationInput(teamA, setBonuses), draft)
        : this.toSimulationInput(teamA, setBonuses),
      feedbacks,
      seriesContext?.gameNumber ?? 1,
    );
    const teamBInput = applyNextSetFeedback(
      draft
        ? applyVariantDraft(this.toSimulationInput(teamB, setBonuses), draft)
        : this.toSimulationInput(teamB, setBonuses),
      feedbacks,
      seriesContext?.gameNumber ?? 1,
    );
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
      accountId,
      dto,
      result,
      statsResult,
      teamA,
      teamB,
      seriesContext,
    );

    const response: MatchSimulationResponseDto = {
      matchId,
      draft: draft ?? null,
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
    return { ...response, pog: selectPlayerOfGame(response) };
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
    const positionProficiency = (careerPlayer.positionProficiencies ?? []).find(
      (candidate) => candidate.position === position,
    )?.proficiency;

    if (positionProficiency === undefined) {
      throw new ConflictException(
        `CareerPlayer ${careerPlayer.id} is missing ${position} position proficiency`,
      );
    }

    return {
      careerPlayerId: careerPlayer.id,
      position,
      playerInstruction,
      roleProficiency,
      positionProficiency,
      championArchetype,
      mechanics: careerPlayer.currentMechanics,
      gameSense: careerPlayer.currentGameSense,
      laning: careerPlayer.currentLaning,
      teamFight: careerPlayer.currentTeamFight,
      macro: careerPlayer.currentMacro,
      teamPlay: careerPlayer.currentTeamPlay,
      mental: careerPlayer.currentMental,
      championPool: careerPlayer.currentChampionPool,
      form: careerPlayer.form,
      condition: careerPlayer.condition,
    };
  }

  private persistMatch(
    accountId: number,
    dto: SimulateMatchDto,
    result: SimpleMatchSimulationResult,
    statsResult: MatchStatsSimulationResult,
    teamA: CareerTeam,
    teamB: CareerTeam,
    seriesContext?: MatchSeriesGameContext,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // Recheck at the actual write boundary, not only against the earlier snapshot.
      await lockActiveManagerCareer(manager, accountId, dto.careerId);
      if (seriesContext && seriesContext.gameNumber > 1) {
        const feedbacks = await manager.find(MatchFeedback, {
          where: {
            seriesId: seriesContext.series.id,
            afterGameNumber: seriesContext.gameNumber - 1,
          },
          order: { id: 'ASC' },
        });
        if (
          !isDeepStrictEqual(
            feedbacks.map((f) => f.id),
            seriesContext.feedbackIds ?? [],
          )
        ) {
          throw new ConflictException(
            '세트 사이 피드백이 변경되었습니다. 경기를 다시 시작해 주세요.',
          );
        }
      }
      if (seriesContext?.draft) {
        const stored = await manager.findOneByOrFail(MatchSeries, {
          id: seriesContext.series.id,
        });
        const lockedDraft = stored.drafts?.[String(seriesContext.gameNumber)];
        if (
          !lockedDraft?.completed ||
          !isDeepStrictEqual(lockedDraft.actions, seriesContext.draft.actions)
        )
          throw new ConflictException(
            '밴픽 상태가 변경되었습니다. 경기를 다시 불러와 주세요.',
          );
        const currentRosters = await manager.find(Roster, {
          where: {
            careerTeamId: In([lockedDraft.blue.id, lockedDraft.red.id]),
            role: RosterRole.STARTER,
          },
        });
        for (const team of [lockedDraft.blue, lockedDraft.red]) {
          if (
            team.players.some(
              (player) =>
                !currentRosters.some(
                  (slot) =>
                    slot.careerTeamId === team.id &&
                    slot.careerPlayerId === player.id &&
                    slot.starterPosition === player.position,
                ),
            )
          )
            throw new ConflictException(
              '밴픽 도중 선발 선수가 변경되었습니다. 원래 선수단으로 복구해 주세요.',
            );
        }
      }
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
        teamAStateModifier: teamAResult.stateModifier,
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
        teamBStateModifier: teamBResult.stateModifier,
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
      await Promise.all(
        statsResult.teams.flatMap((teamStats) =>
          teamStats.playerStats.map((playerStat) =>
            manager.update(CareerPlayer, playerStat.careerPlayerId, {
              form: playerStat.formAfter,
              condition: playerStat.conditionAfter,
              currentMental: playerStat.mentalAfter,
            }),
          ),
        ),
      );

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
      stateModifier:
        side === 'A' ? match.teamAStateModifier : match.teamBStateModifier,
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
      feedback: playerStat.feedback ?? null,
      careerPlayerId: playerStat.careerPlayerId,
      position: playerStat.position,
      playerInstruction: playerStat.playerInstruction,
      roleProficiency: playerStat.roleProficiency,
      positionProficiency: playerStat.positionProficiency,
      championArchetype: playerStat.championArchetype,
      form: playerStat.form,
      condition: playerStat.condition,
      mental: playerStat.mental,
      formModifier: playerStat.formModifier,
      conditionModifier: playerStat.conditionModifier,
      mentalModifier: playerStat.mentalModifier,
      stateModifier: playerStat.stateModifier,
      formAfter: playerStat.formAfter,
      conditionAfter: playerStat.conditionAfter,
      mentalAfter: playerStat.mentalAfter,
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
