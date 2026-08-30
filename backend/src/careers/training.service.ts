import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { CAREER_PLAYER_STATE_CONFIG } from './config/player-state.config';
import { POSITION_PROFICIENCY_CONFIG } from './config/position-proficiency.config';
import { createTrainingRandom } from './config/training-random';
import { TRAINING_CONFIG } from './config/training.config';
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
  period: TrainingPeriod;
  managedTeam: CareerTeam;
  categorySequence: number;
}

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
    const period = await this.trainingPeriodsRepository.findOne({
      where: { careerId, career: { accountId } },
      relations: { career: true, sessions: true },
      order: { periodNumber: 'DESC' },
    });

    if (!period) {
      throw new NotFoundException(
        `Current TrainingPeriod was not found in Career ${careerId}`,
      );
    }

    return this.toResponse(period);
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

      if (dto.type === TrainingType.STRATEGY) {
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
        this.assertCanGrow(resultBefore, 'Strategy proficiency');
        resultAfter = this.clamp(
          resultBefore + TRAINING_CONFIG.growth[TrainingType.STRATEGY],
          TEAM_STRATEGY_PROFICIENCY_CONFIG.min,
          TEAM_STRATEGY_PROFICIENCY_CONFIG.max,
        );
        proficiency.proficiency = resultAfter;
        await manager.save(CareerTeamStrategyProficiency, proficiency);
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
        }),
      );

      return this.reloadPeriod(manager, context.period.id);
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
      const isOverloaded = priorPlayerTrainingCount > 0;
      const random = createTrainingRandom(
        `${careerId}:${context.period.periodNumber}:${context.categorySequence}:${careerPlayer.id}:${dto.type}`,
      );
      const growthRoll = random();
      const formRoll = random();
      const growth = await this.applyIndividualGrowth(
        manager,
        careerPlayer,
        dto,
        growthRoll,
      );
      const conditionBefore = careerPlayer.condition;
      const conditionLoss = this.calculateConditionLoss(
        careerPlayer,
        dto.type,
        isOverloaded,
      );
      const conditionAfter = this.clamp(
        conditionBefore - conditionLoss,
        CAREER_PLAYER_STATE_CONFIG.min,
        CAREER_PLAYER_STATE_CONFIG.max,
      );
      const formBefore = careerPlayer.form;
      const shouldDropForm =
        isOverloaded &&
        formRoll <
          this.calculateOverloadFormDropChance(careerPlayer, conditionAfter);
      const formAfter = this.clamp(
        formBefore - (shouldDropForm ? TRAINING_CONFIG.overload.formDrop : 0),
        CAREER_PLAYER_STATE_CONFIG.min,
        CAREER_PLAYER_STATE_CONFIG.max,
      );

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
        }),
      );

      return this.reloadPeriod(manager, context.period.id);
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

    const period = await manager
      .getRepository(TrainingPeriod)
      .createQueryBuilder('period')
      .setLock('pessimistic_write')
      .where('period.careerId = :careerId', { careerId })
      .orderBy('period.periodNumber', 'DESC')
      .getOne();

    if (!period) {
      throw new ConflictException(
        `Career ${careerId} does not have a current TrainingPeriod`,
      );
    }

    const used = await manager.countBy(TrainingSession, {
      trainingPeriodId: period.id,
      category,
    });
    const limit =
      category === TrainingCategory.TEAM
        ? TRAINING_CONFIG.usesPerPeriod.team
        : TRAINING_CONFIG.usesPerPeriod.individual;

    if (used >= limit) {
      throw new ConflictException(
        `${category} training limit of ${limit} has been reached for TrainingPeriod ${period.periodNumber}`,
      );
    }

    return { period, managedTeam, categorySequence: used + 1 };
  }

  private async applyIndividualGrowth(
    manager: EntityManager,
    careerPlayer: CareerPlayer,
    dto: CreateIndividualTrainingDto,
    growthRoll: number,
  ): Promise<{ before: number; after: number; succeeded: boolean }> {
    if (dto.type === TrainingType.LANING) {
      const before = careerPlayer.currentLaning;
      this.assertCanGrow(before, 'Laning');
      const potentialGap = careerPlayer.playerCard.potential - before;
      const chance = this.clamp(
        TRAINING_CONFIG.laningGrowthChance.base +
          Math.max(0, potentialGap) *
            TRAINING_CONFIG.laningGrowthChance.perPotentialGap,
        TRAINING_CONFIG.laningGrowthChance.min,
        TRAINING_CONFIG.laningGrowthChance.max,
      );
      const succeeded = growthRoll < chance;
      const after = succeeded
        ? this.clamp(
            before + TRAINING_CONFIG.growth[TrainingType.LANING],
            0,
            100,
          )
        : before;

      careerPlayer.currentLaning = after;
      return { before, after, succeeded };
    }

    if (dto.type === TrainingType.CHAMPION_POOL) {
      const before = careerPlayer.currentChampionPool;
      this.assertCanGrow(before, 'Champion Pool');
      const potentialGap = careerPlayer.playerCard.potential - before;
      const configuredGrowth =
        TRAINING_CONFIG.growth[TrainingType.CHAMPION_POOL];
      const growth = potentialGap <= 0 ? 1 : configuredGrowth;
      const after = this.clamp(before + growth, 0, 100);

      careerPlayer.currentChampionPool = after;
      return { before, after, succeeded: after > before };
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
        before + TRAINING_CONFIG.growth[TrainingType.ROLE],
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
      before + TRAINING_CONFIG.growth[TrainingType.POSITION],
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
    isOverloaded: boolean,
  ): number {
    const ageAdjustment =
      careerPlayer.currentAge < 30
        ? 0
        : Math.min(3, 1 + Math.floor((careerPlayer.currentAge - 30) / 3));
    const personalityAdjustment =
      TRAINING_CONFIG.personalityConditionAdjustment[careerPlayer.personality];
    const overloadAdjustment = isOverloaded
      ? TRAINING_CONFIG.overload.additionalConditionLoss
      : 0;

    return Math.max(
      1,
      TRAINING_CONFIG.conditionLoss[
        type as keyof typeof TRAINING_CONFIG.conditionLoss
      ] +
        personalityAdjustment +
        ageAdjustment +
        overloadAdjustment,
    );
  }

  private calculateOverloadFormDropChance(
    careerPlayer: CareerPlayer,
    conditionAfter: number,
  ): number {
    return this.clamp(
      TRAINING_CONFIG.overload.baseFormDropChance +
        (careerPlayer.personality === PlayerPersonality.SENSITIVE
          ? TRAINING_CONFIG.overload.sensitiveFormDropChanceBonus
          : 0) +
        (conditionAfter < TRAINING_CONFIG.overload.lowConditionThreshold
          ? TRAINING_CONFIG.overload.lowConditionFormDropChanceBonus
          : 0),
      0,
      1,
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

    if (dto.type === TrainingType.CHEMISTRY && dto.strategy !== undefined) {
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

    if (
      dto.type === TrainingType.LANING ||
      dto.type === TrainingType.CHAMPION_POOL
    ) {
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

  private assertCanGrow(value: number, label: string): void {
    if (value >= 100) {
      throw new BadRequestException(`${label} is already at its maximum`);
    }
  }

  private async reloadPeriod(
    manager: EntityManager,
    trainingPeriodId: number,
  ): Promise<TrainingPeriodResponseDto> {
    const period = await manager.findOneOrFail(TrainingPeriod, {
      where: { id: trainingPeriodId },
      relations: { sessions: true },
    });

    return this.toResponse(period);
  }

  private toResponse(period: TrainingPeriod): TrainingPeriodResponseDto {
    const sessions = [...(period.sessions ?? [])].sort(
      (left, right) => left.id - right.id,
    );
    const teamUsed = sessions.filter(
      (session) => session.category === TrainingCategory.TEAM,
    ).length;
    const individualUsed = sessions.filter(
      (session) => session.category === TrainingCategory.INDIVIDUAL,
    ).length;

    return {
      id: period.id,
      careerId: period.careerId,
      periodNumber: period.periodNumber,
      createdAt: period.createdAt,
      teamTraining: {
        used: teamUsed,
        limit: TRAINING_CONFIG.usesPerPeriod.team,
        remaining: Math.max(0, TRAINING_CONFIG.usesPerPeriod.team - teamUsed),
      },
      individualTraining: {
        used: individualUsed,
        limit: TRAINING_CONFIG.usesPerPeriod.individual,
        remaining: Math.max(
          0,
          TRAINING_CONFIG.usesPerPeriod.individual - individualUsed,
        ),
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
        createdAt: session.createdAt,
      })),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
