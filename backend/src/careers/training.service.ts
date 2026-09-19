import { assertManagerActive } from '../manager-career/manager-access';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  PLAYER_CARD_STAT_MAX,
  PLAYER_CARD_STAT_MIN,
} from '../players/constants/player-card.constants';
import { CAREER_PLAYER_STATE_CONFIG } from './config/player-state.config';
import { formRecovery } from './config/form-recovery';
import { TrainingPlayerEffect } from './training-player-effect';
import { POSITION_PROFICIENCY_CONFIG } from './config/position-proficiency.config';
import { createTrainingRandom } from './config/training-random';
import { TRAINING_CONFIG } from './config/training.config';
import { getTrainingWeek } from './config/training-week';
import {
  PLAYER_INSTRUCTIONS_BY_POSITION,
  ROLE_PROFICIENCY_CONFIG,
} from './config/player-instruction.config';
import { TEAM_CHEMISTRY_CONFIG } from './config/team-chemistry.config';
import { TEAM_STRATEGY_PROFICIENCY_CONFIG } from './config/team-strategy-proficiency.config';
import {
  CreateIndividualTrainingDto,
  CreateTeamTrainingDto,
  TrainingPeriodResponseDto,
} from './dto/training.dto';
import { CareerPlayerPositionProficiency } from './entities/career-player-position-proficiency.entity';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { CareerPlayer } from './entities/career-player.entity';
import { CareerTeamStrategyProficiency } from './entities/career-team-strategy-proficiency.entity';
import { CareerTeam } from './entities/career-team.entity';
import { Career } from './entities/career.entity';
import { TrainingPeriod } from './entities/training-period.entity';
import { TrainingSession } from './entities/training-session.entity';
import { TrainingCategory } from './enums/training-category.enum';
import {
  INDIVIDUAL_TRAINING_TYPES,
  TEAM_TRAINING_TYPES,
  TrainingType,
} from './enums/training-type.enum';

interface LockedTrainingContext {
  career: Career;
  period: TrainingPeriod;
  managedTeam: CareerTeam;
  categorySequence: number;
}

const STAT_FIELDS = {
  [TrainingType.MECHANICS]: 'currentMechanics',
  [TrainingType.GAME_SENSE]: 'currentGameSense',
  [TrainingType.LANING]: 'currentLaning',
  [TrainingType.TEAM_FIGHT]: 'currentTeamFight',
  [TrainingType.MACRO]: 'currentMacro',
  [TrainingType.TEAM_PLAY]: 'currentTeamPlay',
  [TrainingType.MENTAL]: 'currentMental',
  [TrainingType.CHAMPION_POOL]: 'currentChampionPool',
} as const;

@Injectable()
export class TrainingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TrainingPeriod)
    private readonly trainingPeriodsRepository: Repository<TrainingPeriod>,
  ) {}

  async findCurrent(
    accountId: number,
    careerId: number,
  ): Promise<TrainingPeriodResponseDto> {
    const career = await this.dataSource.manager.findOneBy(Career, {
      id: careerId,
      accountId,
    });
    if (!career)
      throw new NotFoundException(`Career ${careerId} was not found`);
    const period = await this.trainingPeriodsRepository.findOne({
      where: {
        careerId,
        weekStartsAt: getTrainingWeek(career.currentDate).weekStartsAt,
      },
      relations: { sessions: true },
    });
    return this.toResponse(period, career, this.dataSource.manager);
  }

  trainTeam(
    accountId: number,
    careerId: number,
    dto: CreateTeamTrainingDto,
  ): Promise<TrainingPeriodResponseDto> {
    this.validateTeamTraining(dto);

    return this.dataSource.transaction(async (manager) => {
      const context = await this.lockContext(
        manager,
        accountId,
        careerId,
        TrainingCategory.TEAM,
      );
      let resultBefore: number;
      let resultAfter: number;

      if (dto.type === TrainingType.REST) {
        const trained = await manager.countBy(TrainingSession, {
          trainingPeriodId: context.period.id,
          category: TrainingCategory.INDIVIDUAL,
        });
        if (trained)
          throw new ConflictException(
            '개인 훈련을 진행한 주에는 팀 전체 휴식을 선택할 수 없습니다.',
          );
        resultBefore = 0;
        resultAfter = 0;
      } else if (dto.type === TrainingType.STRATEGY) {
        const proficiency = await manager
          .getRepository(CareerTeamStrategyProficiency)
          .createQueryBuilder('proficiency')
          .setLock('pessimistic_write')
          .where('proficiency.careerTeamId = :careerTeamId', {
            careerTeamId: context.managedTeam.id,
          })
          .andWhere('proficiency.strategy = :strategy', {
            strategy: dto.strategy,
          })
          .getOne();

        if (!proficiency) {
          throw new ConflictException(
            `${dto.strategy} strategy proficiency is missing from CareerTeam ${context.managedTeam.id}`,
          );
        }

        resultBefore = proficiency.proficiency;
        if (
          resultBefore >= TEAM_STRATEGY_PROFICIENCY_CONFIG.max &&
          context.managedTeam.chemistry >= TEAM_CHEMISTRY_CONFIG.max
        ) {
          throw new BadRequestException(
            '전술 숙련도와 팀 케미가 이미 최대입니다.',
          );
        }
        resultAfter = this.clamp(
          resultBefore + TRAINING_CONFIG.growth[TrainingType.STRATEGY],
          TEAM_STRATEGY_PROFICIENCY_CONFIG.min,
          TEAM_STRATEGY_PROFICIENCY_CONFIG.max,
        );
        proficiency.proficiency = resultAfter;
        await manager.save(CareerTeamStrategyProficiency, proficiency);
        context.managedTeam.chemistry = this.clamp(
          context.managedTeam.chemistry +
            TRAINING_CONFIG.growth[TrainingType.CHEMISTRY],
          TEAM_CHEMISTRY_CONFIG.min,
          TEAM_CHEMISTRY_CONFIG.max,
        );
        await manager.save(CareerTeam, context.managedTeam);
      } else {
        resultBefore = context.managedTeam.chemistry;
        this.assertCanGrow(resultBefore, 'Team chemistry');
        resultAfter = this.clamp(
          resultBefore + TRAINING_CONFIG.growth[TrainingType.CHEMISTRY],
          TEAM_CHEMISTRY_CONFIG.min,
          TEAM_CHEMISTRY_CONFIG.max,
        );
        context.managedTeam.chemistry = resultAfter;
        await manager.save(CareerTeam, context.managedTeam);
      }

      const playerEffects = await this.applyTeamActivity(
        manager,
        context,
        dto.type === TrainingType.REST,
      );
      await manager.save(
        TrainingSession,
        manager.create(TrainingSession, {
          trainingPeriodId: context.period.id,
          trainingPeriod: context.period,
          careerTeamId: context.managedTeam.id,
          careerTeam: context.managedTeam,
          careerPlayerId: null,
          careerPlayer: null,
          category: TrainingCategory.TEAM,
          type: dto.type,
          categorySequence: context.categorySequence,
          strategy: dto.strategy ?? null,
          position: null,
          instruction: null,
          growthSucceeded: true,
          resultBefore,
          resultDelta: resultAfter - resultBefore,
          resultAfter,
          conditionBefore: null,
          conditionDelta: null,
          conditionAfter: null,
          formBefore: null,
          formDelta: null,
          formAfter: null,
          playerEffects,
        }),
      );

      return this.reloadPeriod(manager, context.period.id, context.career);
    });
  }

  trainIndividual(
    accountId: number,
    careerId: number,
    dto: CreateIndividualTrainingDto,
  ): Promise<TrainingPeriodResponseDto> {
    this.validateIndividualTraining(dto);

    return this.dataSource.transaction(async (manager) => {
      const context = await this.lockContext(
        manager,
        accountId,
        careerId,
        TrainingCategory.INDIVIDUAL,
      );
      const careerPlayer = await manager
        .getRepository(CareerPlayer)
        .createQueryBuilder('careerPlayer')
        .innerJoinAndSelect('careerPlayer.playerCard', 'playerCard')
        .setLock('pessimistic_write')
        .where('careerPlayer.id = :careerPlayerId', {
          careerPlayerId: dto.careerPlayerId,
        })
        .andWhere('careerPlayer.careerId = :careerId', { careerId })
        .andWhere('careerPlayer.currentTeamId = :careerTeamId', {
          careerTeamId: context.managedTeam.id,
        })
        .getOne();

      if (!careerPlayer) {
        throw new NotFoundException(
          `CareerPlayer ${dto.careerPlayerId} was not found on the managed team in Career ${careerId}`,
        );
      }

      if (careerPlayer.condition <= CAREER_PLAYER_STATE_CONFIG.min) {
        throw new BadRequestException(
          `CareerPlayer ${careerPlayer.id} cannot train at 0 Condition`,
        );
      }

      const priorPlayerTrainingCount = await manager.countBy(TrainingSession, {
        trainingPeriodId: context.period.id,
        category: TrainingCategory.INDIVIDUAL,
        careerPlayerId: careerPlayer.id,
      });
      if (
        priorPlayerTrainingCount >= TRAINING_CONFIG.usesPerPeriod.individual
      ) {
        throw new ConflictException(
          '이 선수는 이번 주 개인 훈련을 이미 사용했습니다.',
        );
      }
      const random = createTrainingRandom(
        `${careerId}:${context.period.weekStartsAt}:${careerPlayer.id}:${dto.type}`,
      );
      const growthRoll = random();
      const growth = await this.applyIndividualGrowth(
        manager,
        careerPlayer,
        dto,
        growthRoll,
      );
      const conditionBefore = careerPlayer.condition;
      const conditionLoss = this.calculateConditionLoss(careerPlayer, dto.type);
      const conditionAfter = this.clamp(
        conditionBefore - conditionLoss,
        CAREER_PLAYER_STATE_CONFIG.min,
        CAREER_PLAYER_STATE_CONFIG.max,
      );
      const formBefore = careerPlayer.form;
      const formAfter = formBefore;

      careerPlayer.condition = conditionAfter;
      careerPlayer.form = formAfter;
      await manager.save(CareerPlayer, careerPlayer);
      await manager.save(
        TrainingSession,
        manager.create(TrainingSession, {
          trainingPeriodId: context.period.id,
          trainingPeriod: context.period,
          careerTeamId: context.managedTeam.id,
          careerTeam: context.managedTeam,
          careerPlayerId: careerPlayer.id,
          careerPlayer,
          category: TrainingCategory.INDIVIDUAL,
          type: dto.type,
          categorySequence: context.categorySequence,
          strategy: null,
          position: dto.position ?? null,
          instruction: dto.instruction ?? null,
          growthSucceeded: growth.succeeded,
          resultBefore: growth.before,
          resultDelta: growth.after - growth.before,
          resultAfter: growth.after,
          conditionBefore,
          conditionDelta: conditionAfter - conditionBefore,
          conditionAfter,
          formBefore,
          formDelta: formAfter - formBefore,
          formAfter,
          playerEffects: null,
        }),
      );

      return this.reloadPeriod(manager, context.period.id, context.career);
    });
  }

  private async lockContext(
    manager: EntityManager,
    accountId: number,
    careerId: number,
    category: TrainingCategory,
  ): Promise<LockedTrainingContext> {
    const career = await manager
      .getRepository(Career)
      .createQueryBuilder('career')
      .setLock('pessimistic_write')
      .where('career.id = :careerId', { careerId })
      .andWhere('career.accountId = :accountId', { accountId })
      .getOne();

    if (!career) {
      throw new NotFoundException(`Career ${careerId} was not found`);
    }
    await assertManagerActive(manager, careerId);
    const week = getTrainingWeek(career.currentDate);
    if (category === TrainingCategory.INDIVIDUAL && !week.available)
      throw new ConflictException(week.unavailableReason!);

    const managedTeam = await manager
      .getRepository(CareerTeam)
      .createQueryBuilder('careerTeam')
      .setLock('pessimistic_write')
      .where('careerTeam.careerId = :careerId', { careerId })
      .andWhere('careerTeam.isUserControlled = :isUserControlled', {
        isUserControlled: true,
      })
      .getOne();

    if (!managedTeam) {
      throw new ConflictException(
        `Career ${careerId} does not have a user-controlled team`,
      );
    }

    let period = await manager
      .getRepository(TrainingPeriod)
      .createQueryBuilder('period')
      .setLock('pessimistic_write')
      .where('period.careerId = :careerId', { careerId })
      .andWhere('period.weekStartsAt = :weekStartsAt', {
        weekStartsAt: week.weekStartsAt,
      })
      .getOne();

    if (!period) {
      const previous = await manager.findOne(TrainingPeriod, {
        where: { careerId },
        order: { periodNumber: 'DESC' },
      });
      period = await manager.save(
        TrainingPeriod,
        manager.create(TrainingPeriod, {
          careerId,
          periodNumber: (previous?.periodNumber ?? 0) + 1,
          weekStartsAt: week.weekStartsAt,
        }),
      );
    }

    if (
      category === TrainingCategory.INDIVIDUAL &&
      (await manager.existsBy(TrainingSession, {
        trainingPeriodId: period.id,
        category: TrainingCategory.TEAM,
        type: TrainingType.REST,
      }))
    )
      throw new ConflictException(
        '팀 전체 휴식을 선택한 주에는 개인 훈련을 진행할 수 없습니다.',
      );

    const used = await manager.countBy(TrainingSession, {
      trainingPeriodId: period.id,
      category,
    });
    const limit =
      category === TrainingCategory.TEAM
        ? TRAINING_CONFIG.usesPerPeriod.team
        : TRAINING_CONFIG.usesPerPeriod.individual;

    if (category === TrainingCategory.TEAM && used >= limit) {
      throw new ConflictException(
        `${category} training limit of ${limit} has been reached for TrainingPeriod ${period.periodNumber}`,
      );
    }

    return { career, period, managedTeam, categorySequence: used + 1 };
  }

  private async applyTeamActivity(
    manager: EntityManager,
    context: LockedTrainingContext,
    rest: boolean,
  ): Promise<TrainingPlayerEffect[]> {
    const state = CAREER_PLAYER_STATE_CONFIG;
    const players = await manager.find(CareerPlayer, {
      where: {
        careerId: context.career.id,
        currentTeamId: context.managedTeam.id,
      },
      select: { id: true, form: true, condition: true, currentMental: true },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!players.length)
      throw new ConflictException('팀 활동에 참가할 선수가 없습니다.');
    if (
      rest &&
      players.every(
        (player) => player.condition >= state.max && player.form >= state.max,
      )
    ) {
      throw new BadRequestException(
        '모든 선수의 컨디션과 폼이 이미 최대입니다.',
      );
    }
    if (!rest && players.every((player) => player.condition <= state.min)) {
      throw new BadRequestException(
        '스크림에 참가할 수 있는 선수가 없습니다. 팀 휴식이 필요합니다.',
      );
    }
    const effects = players.map((player) => {
      const conditionBefore = player.condition;
      const formBefore = player.form;
      const participates = rest || conditionBefore > state.min;
      const conditionAfter = this.clamp(
        conditionBefore +
          (rest
            ? TRAINING_CONFIG.restConditionRecovery
            : -TRAINING_CONFIG.scrimConditionLoss),
        state.min,
        state.max,
      );
      const formAfter = this.clamp(
        formBefore +
          (participates
            ? formRecovery(player.currentMental, rest ? 'rest' : 'scrim')
            : 0),
        state.min,
        state.max,
      );
      return {
        careerPlayerId: player.id,
        conditionBefore,
        conditionAfter,
        conditionDelta: conditionAfter - conditionBefore,
        formBefore,
        formAfter,
        formDelta: formAfter - formBefore,
      };
    });
    await manager.save(
      CareerPlayer,
      effects.map((effect) => ({
        id: effect.careerPlayerId,
        condition: effect.conditionAfter,
        form: effect.formAfter,
      })),
    );
    return effects;
  }

  private async applyIndividualGrowth(
    manager: EntityManager,
    careerPlayer: CareerPlayer,
    dto: CreateIndividualTrainingDto,
    growthRoll: number,
  ): Promise<{ before: number; after: number; succeeded: boolean }> {
    if (dto.type in STAT_FIELDS) {
      const field = STAT_FIELDS[dto.type as keyof typeof STAT_FIELDS];
      const before = careerPlayer[field];
      this.assertCanGrow(before, dto.type, PLAYER_CARD_STAT_MAX);
      const potentialGap = careerPlayer.playerCard.potential - before;
      const chance = this.clamp(
        TRAINING_CONFIG.statGrowthChance.base +
          Math.max(0, potentialGap) *
            TRAINING_CONFIG.statGrowthChance.perPotentialGap,
        TRAINING_CONFIG.statGrowthChance.min,
        TRAINING_CONFIG.statGrowthChance.max,
      );
      const succeeded = growthRoll < chance;
      const after = succeeded
        ? this.clamp(
            before + (growthRoll < chance / 2 ? 2 : 1),
            PLAYER_CARD_STAT_MIN,
            PLAYER_CARD_STAT_MAX,
          )
        : before;

      careerPlayer[field] = after;
      return { before, after, succeeded };
    }

    if (dto.type === TrainingType.ROLE) {
      let proficiency = await manager
        .getRepository(CareerPlayerRoleProficiency)
        .createQueryBuilder('proficiency')
        .setLock('pessimistic_write')
        .where('proficiency.careerPlayerId = :careerPlayerId', {
          careerPlayerId: careerPlayer.id,
        })
        .andWhere('proficiency.position = :position', {
          position: dto.position,
        })
        .andWhere('proficiency.instruction = :instruction', {
          instruction: dto.instruction,
        })
        .getOne();

      if (!proficiency) {
        proficiency = manager.create(CareerPlayerRoleProficiency, {
          careerPlayerId: careerPlayer.id,
          careerPlayer,
          position: dto.position!,
          instruction: dto.instruction!,
          proficiency: ROLE_PROFICIENCY_CONFIG.initial,
        });
      }

      const before = proficiency.proficiency;
      this.assertCanGrow(before, 'Role proficiency');
      const after = this.clamp(
        before + Math.floor(growthRoll * 3),
        ROLE_PROFICIENCY_CONFIG.min,
        ROLE_PROFICIENCY_CONFIG.max,
      );

      proficiency.proficiency = after;
      await manager.save(CareerPlayerRoleProficiency, proficiency);
      return { before, after, succeeded: after > before };
    }

    const proficiency = await manager
      .getRepository(CareerPlayerPositionProficiency)
      .createQueryBuilder('proficiency')
      .setLock('pessimistic_write')
      .where('proficiency.careerPlayerId = :careerPlayerId', {
        careerPlayerId: careerPlayer.id,
      })
      .andWhere('proficiency.position = :position', {
        position: dto.position,
      })
      .getOne();

    if (!proficiency) {
      throw new ConflictException(
        `${dto.position} position proficiency is missing from CareerPlayer ${careerPlayer.id}`,
      );
    }

    const before = proficiency.proficiency;
    this.assertCanGrow(before, 'Position proficiency');
    const after = this.clamp(
      before + Math.floor(growthRoll * 3),
      POSITION_PROFICIENCY_CONFIG.min,
      POSITION_PROFICIENCY_CONFIG.max,
    );

    proficiency.proficiency = after;
    await manager.save(CareerPlayerPositionProficiency, proficiency);
    return { before, after, succeeded: after > before };
  }

  private calculateConditionLoss(
    careerPlayer: CareerPlayer,
    type: TrainingType,
  ): number {
    const ageAdjustment =
      careerPlayer.currentAge < 30
        ? 0
        : Math.min(3, 1 + Math.floor((careerPlayer.currentAge - 30) / 3));
    const personalityAdjustment =
      TRAINING_CONFIG.personalityConditionAdjustment[careerPlayer.personality];

    return Math.max(
      1,
      TRAINING_CONFIG.conditionLoss[
        type as keyof typeof TRAINING_CONFIG.conditionLoss
      ] +
        personalityAdjustment +
        ageAdjustment,
    );
  }

  private validateTeamTraining(dto: CreateTeamTrainingDto): void {
    if (!TEAM_TRAINING_TYPES.includes(dto.type)) {
      throw new BadRequestException(`${dto.type} is not a team training type`);
    }

    if (dto.type === TrainingType.STRATEGY && dto.strategy === undefined) {
      throw new BadRequestException(
        'strategy is required for STRATEGY training',
      );
    }

    if (dto.type !== TrainingType.STRATEGY && dto.strategy !== undefined) {
      throw new BadRequestException(
        'strategy is only valid for STRATEGY training',
      );
    }
  }

  private validateIndividualTraining(dto: CreateIndividualTrainingDto): void {
    if (!INDIVIDUAL_TRAINING_TYPES.includes(dto.type)) {
      throw new BadRequestException(
        `${dto.type} is not an individual training type`,
      );
    }

    if (dto.type in STAT_FIELDS) {
      if (dto.position !== undefined || dto.instruction !== undefined) {
        throw new BadRequestException(
          'position and instruction are not valid for this training type',
        );
      }

      return;
    }

    if (dto.position === undefined) {
      throw new BadRequestException(
        `position is required for ${dto.type} training`,
      );
    }

    if (dto.type === TrainingType.POSITION) {
      if (dto.instruction !== undefined) {
        throw new BadRequestException(
          'instruction is only valid for ROLE training',
        );
      }

      return;
    }

    if (dto.instruction === undefined) {
      throw new BadRequestException(
        'instruction is required for ROLE training',
      );
    }

    if (
      !PLAYER_INSTRUCTIONS_BY_POSITION[dto.position].includes(dto.instruction)
    ) {
      throw new BadRequestException(
        `${dto.instruction} is not valid for ${dto.position}`,
      );
    }
  }

  private assertCanGrow(value: number, label: string, max = 100): void {
    if (value >= max) {
      throw new BadRequestException(`${label} is already at its maximum`);
    }
  }

  private async reloadPeriod(
    manager: EntityManager,
    trainingPeriodId: number,
    career: Career,
  ): Promise<TrainingPeriodResponseDto> {
    const period = await manager.findOneOrFail(TrainingPeriod, {
      where: { id: trainingPeriodId },
      relations: { sessions: true },
    });

    return this.toResponse(period, career, manager);
  }

  private async toResponse(
    period: TrainingPeriod | null,
    career: Career,
    manager: EntityManager,
  ): Promise<TrainingPeriodResponseDto> {
    const sessions = [...(period?.sessions ?? [])].sort(
      (left, right) => left.id - right.id,
    );
    const teamUsed = sessions.filter(
      (session) => session.category === TrainingCategory.TEAM,
    ).length;
    const currentPlayers = await manager.find(CareerPlayer, {
      where: { careerId: career.id, currentTeam: { isUserControlled: true } },
      select: { id: true },
    });
    const currentIds = new Set(currentPlayers.map((player) => player.id));
    const playerCount = currentPlayers.length;
    const individualUsed = sessions.filter(
      (session) =>
        session.careerPlayerId !== null &&
        currentIds.has(session.careerPlayerId),
    ).length;

    return {
      id: period?.id ?? 0,
      careerId: career.id,
      periodNumber: period?.periodNumber ?? 0,
      createdAt:
        period?.createdAt ?? new Date(`${career.currentDate}T00:00:00Z`),
      ...getTrainingWeek(career.currentDate),
      teamRested: sessions.some(
        (session) =>
          session.category === TrainingCategory.TEAM &&
          session.type === TrainingType.REST,
      ),
      playerUsesPerWeek: TRAINING_CONFIG.usesPerPeriod.individual,
      usedPlayerIds: sessions.flatMap((session) =>
        session.careerPlayerId === null ? [] : [session.careerPlayerId],
      ),
      teamTraining: {
        used: teamUsed,
        limit: TRAINING_CONFIG.usesPerPeriod.team,
        remaining: Math.max(0, TRAINING_CONFIG.usesPerPeriod.team - teamUsed),
      },
      individualTraining: {
        used: individualUsed,
        limit: playerCount,
        remaining: Math.max(0, playerCount - individualUsed),
      },
      sessions: sessions.map((session) => ({
        id: session.id,
        category: session.category,
        type: session.type,
        categorySequence: session.categorySequence,
        careerTeamId: session.careerTeamId,
        careerPlayerId: session.careerPlayerId,
        strategy: session.strategy,
        position: session.position,
        instruction: session.instruction,
        growthSucceeded: session.growthSucceeded,
        resultBefore: session.resultBefore,
        resultDelta: session.resultDelta,
        resultAfter: session.resultAfter,
        conditionBefore: session.conditionBefore,
        conditionDelta: session.conditionDelta,
        conditionAfter: session.conditionAfter,
        formBefore: session.formBefore,
        formDelta: session.formDelta,
        formAfter: session.formAfter,
        playerEffects: session.playerEffects ?? [],
        createdAt: session.createdAt,
      })),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
