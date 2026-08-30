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
import { calculateFeedbackPlayerEffect } from './feedback-effect';

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

    try {
      return await this.dataSource.transaction(async (manager) => {
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
        const existingFeedback = await manager.findOneBy(MatchFeedback, {
          seriesId,
          afterGameNumber,
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
        const effects = careerPlayers.map((careerPlayer) => {
          const effect = calculateFeedbackPlayerEffect(
            {
              personality: careerPlayer.personality,
              mental: careerPlayer.currentMental,
              form: careerPlayer.form,
              coachTrust: careerPlayer.coachTrust,
            },
            dto.option,
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
              currentMental: effect.mentalAfter,
              form: effect.formAfter,
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

    if (optionConfig.type !== dto.type) {
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

    return teamAWins >= 2 || teamBWins >= 2;
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
