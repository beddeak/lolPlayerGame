import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { lockActiveManagerCareer } from '../manager-career/manager-access';
import { FEEDBACK_OPTION_CONFIG } from './config/feedback.config';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import {
  FeedbackPlayerEffectResponseDto,
  FeedbackResponseDto,
} from './dto/feedback-response.dto';
import { MatchFeedbackPlayerEffect } from './entities/match-feedback-player-effect.entity';
import { MatchFeedback } from './entities/match-feedback.entity';
import { MatchSeries } from './entities/match-series.entity';
import { FeedbackType } from './enums/feedback-type.enum';
import { calculateFeedbackReaction } from './feedback-reaction';
import {
  getSeriesWinsRequired,
  MATCH_SERIES_CONFIG,
} from './config/bo3-series.config';

@Injectable()
export class MatchFeedbackService {
  constructor(
    @InjectRepository(MatchSeries)
    private readonly matchSeriesRepository: Repository<MatchSeries>,
    @InjectRepository(MatchFeedback)
    private readonly feedbackRepository: Repository<MatchFeedback>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    accountId: number,
    seriesId: number,
    dto: CreateFeedbackDto,
  ): Promise<FeedbackResponseDto> {
    this.validateDto(dto);

    const ownedSeries = await this.matchSeriesRepository.findOne({
      where: { id: seriesId, career: { accountId } },
      relations: { career: true },
    });
    if (!ownedSeries) {
      throw new NotFoundException(`MatchSeries ${seriesId} not found`);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        await lockActiveManagerCareer(manager, accountId, ownedSeries.careerId);
        const series = await manager.findOne(MatchSeries, {
          where: { id: seriesId, career: { accountId } },
          relations: {
            career: true,
            teamA: true,
            teamB: true,
            games: { playerStats: true },
          },
        });

        if (!series) {
          throw new NotFoundException(`MatchSeries ${seriesId} not found`);
        }

        const latestGame = this.findLatestGame(series);

        if (this.isSeriesCompleted(series)) {
          throw new ConflictException(
            `MatchSeries ${seriesId} is already completed`,
          );
        }

        const managedTeam = this.findManagedTeam(series);
        const afterGameNumber = latestGame.seriesGameNumber!;
        if (
          dto.afterGameNumber !== undefined &&
          dto.afterGameNumber !== afterGameNumber
        ) {
          throw new ConflictException(
            '피드백 대상 세트가 변경되었습니다. 경기 결과를 다시 불러와 주세요.',
          );
        }
        if (series.drafts?.[String(afterGameNumber + 1)]) {
          throw new ConflictException(
            '다음 세트 밴픽이 시작되어 피드백을 변경할 수 없습니다.',
          );
        }
        const existingFeedback = await manager.findOneBy(MatchFeedback, {
          seriesId,
          afterGameNumber,
          type: dto.type,
        });

        if (existingFeedback) {
          throw new ConflictException(
            `Feedback was already given after Game ${afterGameNumber}`,
          );
        }

        const lineupPlayerIds = latestGame.playerStats
          .filter((playerStat) => playerStat.careerTeamId === managedTeam.id)
          .map((playerStat) => playerStat.careerPlayerId);

        if (lineupPlayerIds.length !== STARTER_POSITIONS.length) {
          throw new ConflictException(
            `Game ${afterGameNumber} does not have a complete managed-team lineup`,
          );
        }

        const targetPlayerIds = this.selectTargetPlayerIds(
          dto,
          lineupPlayerIds,
        );
        const careerPlayers = await manager.find(CareerPlayer, {
          where: { id: In(targetPlayerIds), currentTeamId: managedTeam.id },
          order: { id: 'ASC' },
        });

        if (careerPlayers.length !== targetPlayerIds.length) {
          throw new BadRequestException(
            'Every feedback target must still belong to the managed team',
          );
        }

        const feedback = manager.create(MatchFeedback, {
          seriesId: series.id,
          series,
          afterGameId: latestGame.id,
          afterGame: latestGame,
          afterGameNumber,
          type: dto.type,
          option: dto.option,
          targetTeamId: managedTeam.id,
          targetTeam: managedTeam,
          targetCareerPlayerId:
            dto.type === FeedbackType.INDIVIDUAL ? dto.careerPlayerId! : null,
          targetCareerPlayer:
            dto.type === FeedbackType.INDIVIDUAL ? careerPlayers[0] : null,
        });
        const savedFeedback = await manager.save(MatchFeedback, feedback);
        const teamStats = latestGame.playerStats.filter(
          (stat) => stat.careerTeamId === managedTeam.id,
        );
        const teamAverageRating =
          teamStats.reduce((sum, stat) => sum + (stat.rating ?? 6), 0) /
          teamStats.length;
        const effects = careerPlayers.map((careerPlayer) => {
          const effect = calculateFeedbackReaction(
            {
              personality: careerPlayer.personality,
              mental: careerPlayer.currentMental,
              form: careerPlayer.form,
              coachTrust: careerPlayer.coachTrust,
            },
            dto.option,
            {
              won: latestGame.winnerTeamId === managedTeam.id,
              rating:
                teamStats.find(
                  (stat) => stat.careerPlayerId === careerPlayer.id,
                )?.rating ?? 6,
              teamAverageRating,
            },
          );

          return manager.create(MatchFeedbackPlayerEffect, {
            feedbackId: savedFeedback.id,
            feedback: savedFeedback,
            careerPlayerId: careerPlayer.id,
            careerPlayer,
            ...effect,
          });
        });

        await manager.save(MatchFeedbackPlayerEffect, effects);
        await Promise.all(
          effects.map((effect) =>
            manager.update(CareerPlayer, effect.careerPlayerId, {
              // Trust is persistent; match-state reactions expire after the next set.
              coachTrust: effect.coachTrustAfter,
            }),
          ),
        );
        savedFeedback.effects = effects;

        return this.toResponse(savedFeedback);
      });
    } catch (error) {
      if (this.isDuplicateEntryError(error)) {
        throw new ConflictException(
          'Feedback was already given after the latest game',
        );
      }

      throw error;
    }
  }

  async findAll(
    accountId: number,
    seriesId: number,
  ): Promise<FeedbackResponseDto[]> {
    const series = await this.matchSeriesRepository.findOne({
      where: { id: seriesId, career: { accountId } },
      relations: { career: true },
    });

    if (!series) {
      throw new NotFoundException(`MatchSeries ${seriesId} not found`);
    }

    const feedbacks = await this.feedbackRepository.find({
      where: { seriesId },
      relations: { effects: true },
      order: { afterGameNumber: 'ASC', id: 'ASC' },
    });

    return feedbacks.map((feedback) => this.toResponse(feedback));
  }

  private validateDto(dto: CreateFeedbackDto): void {
    const optionConfig = FEEDBACK_OPTION_CONFIG[dto.option];

    if (!optionConfig || optionConfig.type !== dto.type) {
      throw new BadRequestException(
        `${dto.option} is not a ${dto.type} feedback option`,
      );
    }

    if (
      dto.type === FeedbackType.INDIVIDUAL &&
      dto.careerPlayerId === undefined
    ) {
      throw new BadRequestException(
        'careerPlayerId is required for individual feedback',
      );
    }

    if (dto.type === FeedbackType.TEAM && dto.careerPlayerId !== undefined) {
      throw new BadRequestException(
        'careerPlayerId is not allowed for team feedback',
      );
    }
  }

  private findLatestGame(series: MatchSeries) {
    const latestGame = [...series.games].sort(
      (left, right) =>
        (right.seriesGameNumber ?? 0) - (left.seriesGameNumber ?? 0),
    )[0];

    if (!latestGame) {
      throw new ConflictException(
        `MatchSeries ${series.id} has not played a game yet`,
      );
    }

    if (latestGame.seriesGameNumber === null) {
      throw new ConflictException(
        `Match ${latestGame.id} is missing its series game number`,
      );
    }

    return latestGame;
  }

  private isSeriesCompleted(series: MatchSeries): boolean {
    const teamAWins = series.games.filter(
      (game) => game.winnerTeamId === series.teamAId,
    ).length;
    const teamBWins = series.games.filter(
      (game) => game.winnerTeamId === series.teamBId,
    ).length;

    const winsRequired = getSeriesWinsRequired(
      series.bestOf ?? MATCH_SERIES_CONFIG.defaultBestOf,
    );

    return teamAWins >= winsRequired || teamBWins >= winsRequired;
  }

  private findManagedTeam(series: MatchSeries): CareerTeam {
    const managedTeams = [series.teamA, series.teamB].filter(
      (team) => team.isUserControlled,
    );

    if (managedTeams.length !== 1) {
      throw new ConflictException(
        `MatchSeries ${series.id} must contain exactly one managed team for feedback`,
      );
    }

    return managedTeams[0];
  }

  private selectTargetPlayerIds(
    dto: CreateFeedbackDto,
    lineupPlayerIds: number[],
  ): number[] {
    if (dto.type === FeedbackType.TEAM) {
      return lineupPlayerIds;
    }

    if (!lineupPlayerIds.includes(dto.careerPlayerId!)) {
      throw new BadRequestException(
        `CareerPlayer ${dto.careerPlayerId} did not play for the managed team in the latest game`,
      );
    }

    return [dto.careerPlayerId!];
  }

  private toResponse(feedback: MatchFeedback): FeedbackResponseDto {
    return {
      id: feedback.id,
      seriesId: feedback.seriesId,
      afterGameId: feedback.afterGameId,
      afterGameNumber: feedback.afterGameNumber,
      type: feedback.type,
      option: feedback.option,
      targetTeamId: feedback.targetTeamId,
      targetCareerPlayerId: feedback.targetCareerPlayerId,
      effects: [...(feedback.effects ?? [])]
        .sort((left, right) => left.careerPlayerId - right.careerPlayerId)
        .map((effect) => this.toEffectResponse(effect)),
      createdAt: feedback.createdAt,
    };
  }

  private toEffectResponse(
    effect: MatchFeedbackPlayerEffect,
  ): FeedbackPlayerEffectResponseDto {
    return {
      reaction: effect.reaction ?? null,
      careerPlayerId: effect.careerPlayerId,
      personality: effect.personality,
      mentalBefore: effect.mentalBefore,
      mentalDelta: effect.mentalDelta,
      mentalAfter: effect.mentalAfter,
      formBefore: effect.formBefore,
      formDelta: effect.formDelta,
      formAfter: effect.formAfter,
      coachTrustBefore: effect.coachTrustBefore,
      coachTrustDelta: effect.coachTrustDelta,
      coachTrustAfter: effect.coachTrustAfter,
    };
  }

  private isDuplicateEntryError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { code?: string } | undefined;

    return driverError?.code === 'ER_DUP_ENTRY';
  }
}
