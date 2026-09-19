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

  it('makes individual stat growth chance-based in the 0 to 2 range', async () => {
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
      after: 72,
      succeeded: true,
    });
    expect(failedLaning).toEqual({ before: 70, after: 70, succeeded: false });
    expect(championPool).toEqual({ before: 70, after: 70, succeeded: false });
  });

  it('adjusts condition cost for age and personality', () => {
    const resilientPlayer = createCareerPlayer();
    const overloadedPlayer = createCareerPlayer();

    overloadedPlayer.currentAge = 35;
    overloadedPlayer.personality = PlayerPersonality.SENSITIVE;

    const normalLoss = rules.calculateConditionLoss(
      resilientPlayer,
      TrainingType.LANING,
    );
    const overloadLoss = rules.calculateConditionLoss(
      overloadedPlayer,
      TrainingType.LANING,
    );

    expect(normalLoss).toBe(7);
    expect(overloadLoss).toBe(12);
  });

  it.each([
    [TrainingType.LANING, 'currentLaning'],
    [TrainingType.CHAMPION_POOL, 'currentChampionPool'],
  ] as const)('grows %s past 100 but never past 119', async (type, field) => {
    const player = createCareerPlayer();
    player.playerCard.potential = 119;
    player[field] = 100;
    const manager = {} as EntityManager;
    const initialGrowth = await rules.applyIndividualGrowth(
      manager,
      player,
      { type, careerPlayerId: 1 },
      0,
    );
    expect(initialGrowth.after).toBeGreaterThan(100);

    player[field] = 118;
    expect(
      await rules.applyIndividualGrowth(
        manager,
        player,
        { type, careerPlayerId: 1 },
        0,
      ),
    ).toEqual({ before: 118, after: 119, succeeded: true });
    expect(player[field]).toBe(119);

    await expect(
      rules.applyIndividualGrowth(
        manager,
        player,
        { type, careerPlayerId: 1 },
        0,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(player[field]).toBe(119);
  });

  it('keeps role and position proficiency capped at 100', async () => {
    const player = createCareerPlayer();
    const query = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ proficiency: 100 }),
    };
    const save = jest.fn();
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(query),
      }),
      save,
    } as unknown as EntityManager;
    for (const type of [TrainingType.ROLE, TrainingType.POSITION]) {
      await expect(
        rules.applyIndividualGrowth(
          manager,
          player,
          { type, careerPlayerId: 1, position: Position.MID },
          0,
        ),
      ).rejects.toThrow(BadRequestException);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it('derives repeatable random rolls without accepting a client seed', () => {
    const first = createTrainingRandom('1:1:1:10:LANING');
    const second = createTrainingRandom('1:1:1:10:LANING');

    expect([first(), first()]).toEqual([second(), second()]);
  });
});
