import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { Position } from '../players/enums/position.enum';
import { createTrainingRandom } from './config/training-random';
import {
  CreateIndividualTrainingDto,
  CreateTeamTrainingDto,
} from './dto/training.dto';
import { CareerPlayer } from './entities/career-player.entity';
import { TrainingPeriod } from './entities/training-period.entity';
import { PlayerInstruction } from './enums/player-instruction.enum';
import { TrainingType } from './enums/training-type.enum';
import { TrainingService } from './training.service';

interface TestableTrainingService {
  validateTeamTraining(dto: CreateTeamTrainingDto): void;
  validateIndividualTraining(dto: CreateIndividualTrainingDto): void;
  applyIndividualGrowth(
    manager: EntityManager,
    careerPlayer: CareerPlayer,
    dto: CreateIndividualTrainingDto,
    growthRoll: number,
  ): Promise<{ before: number; after: number; succeeded: boolean }>;
  calculateConditionLoss(
    careerPlayer: CareerPlayer,
    type: TrainingType,
    isOverloaded: boolean,
  ): number;
}

describe('TrainingService rules', () => {
  const service = new TrainingService(
    {} as DataSource,
    {} as Repository<TrainingPeriod>,
  );
  const rules = service as unknown as TestableTrainingService;
  const createCareerPlayer = (): CareerPlayer =>
    ({
      id: 1,
      currentAge: 20,
      currentLaning: 70,
      currentChampionPool: 70,
      condition: 100,
      form: 50,
      personality: PlayerPersonality.PROFESSIONAL,
      playerCard: { potential: 80 },
    }) as CareerPlayer;

  it('requires a strategy only for strategy team training', () => {
    expect(() =>
      rules.validateTeamTraining({ type: TrainingType.STRATEGY }),
    ).toThrow(BadRequestException);
    expect(() =>
      rules.validateTeamTraining({
        type: TrainingType.CHEMISTRY,
        strategy: undefined,
      }),
    ).not.toThrow();
  });

  it('validates role and position-specific individual inputs', () => {
    expect(() =>
      rules.validateIndividualTraining({
        type: TrainingType.ROLE,
        careerPlayerId: 1,
        position: Position.ADC,
        instruction: PlayerInstruction.ROAM_TOP,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      rules.validateIndividualTraining({
        type: TrainingType.POSITION,
        careerPlayerId: 1,
        position: Position.TOP,
      }),
    ).not.toThrow();
  });

  it('makes laning growth chance-based and champion pool growth guaranteed', async () => {
    const successfulPlayer = createCareerPlayer();
    const failedPlayer = createCareerPlayer();
    const championPoolPlayer = createCareerPlayer();
    const manager = {} as EntityManager;
    const successfulLaning = await rules.applyIndividualGrowth(
      manager,
      successfulPlayer,
      { type: TrainingType.LANING, careerPlayerId: 1 },
      0,
    );
    const failedLaning = await rules.applyIndividualGrowth(
      manager,
      failedPlayer,
      { type: TrainingType.LANING, careerPlayerId: 1 },
      0.99,
    );
    const championPool = await rules.applyIndividualGrowth(
      manager,
      championPoolPlayer,
      { type: TrainingType.CHAMPION_POOL, careerPlayerId: 1 },
      0.99,
    );

    expect(successfulLaning).toEqual({
      before: 70,
      after: 71,
      succeeded: true,
    });
    expect(failedLaning).toEqual({ before: 70, after: 70, succeeded: false });
    expect(championPool).toEqual({ before: 70, after: 72, succeeded: true });
  });

  it('increases condition cost for age, personality, and repeat training', () => {
    const resilientPlayer = createCareerPlayer();
    const overloadedPlayer = createCareerPlayer();

    overloadedPlayer.currentAge = 35;
    overloadedPlayer.personality = PlayerPersonality.SENSITIVE;

    const normalLoss = rules.calculateConditionLoss(
      resilientPlayer,
      TrainingType.LANING,
      false,
    );
    const overloadLoss = rules.calculateConditionLoss(
      overloadedPlayer,
      TrainingType.LANING,
      true,
    );

    expect(normalLoss).toBe(7);
    expect(overloadLoss).toBe(17);
  });

  it('derives repeatable random rolls without accepting a client seed', () => {
    const first = createTrainingRandom('1:1:1:10:LANING');
    const second = createTrainingRandom('1:1:1:10:LANING');

    expect([first(), first()]).toEqual([second(), second()]);
  });
});
