import { DataSource, EntityManager, Repository } from 'typeorm';
import { AiClubBudgetService } from '../ai-clubs/ai-club-budget.service';
import { CareersService } from '../careers/careers.service';
import { Career } from '../careers/entities/career.entity';
import { TrainingPeriod } from '../careers/entities/training-period.entity';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { TrainingType } from '../careers/enums/training-type.enum';
import { TrainingService } from '../careers/training.service';
import {
  ContractDecisionAction,
  ContractExpectedRole,
} from '../contracts/contract.types';
import { ContractsService } from '../contracts/contracts.service';
import { SetBonus } from '../set-bonuses/entities/set-bonus.entity';
import { TransfersService } from '../transfers/transfers.service';
import { ManagerCareerState } from './entities/manager-career-state.entity';

describe('Dismissed manager service mutation gates', () => {
  function setup() {
    const career = { id: 1, accountId: 7, currentDate: '2026-11-20' };
    const query = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(career),
    };
    const manager = {
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === ManagerCareerState ? { status: 'DISMISSED' } : career,
        ),
      ),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 3, careerId: 1, isUserControlled: true }),
      getRepository: jest.fn(() => ({ createQueryBuilder: () => query })),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const dataSource = {
      transaction: (work: (value: EntityManager) => Promise<unknown>) =>
        work(manager as unknown as EntityManager),
      manager,
    } as unknown as DataSource;
    const transfers = new TransfersService(dataSource);
    return {
      manager,
      query,
      careers: new CareersService(
        dataSource,
        {} as Repository<Career>,
        {} as Repository<SetBonus>,
      ),
      training: new TrainingService(
        dataSource,
        {} as Repository<TrainingPeriod>,
      ),
      contracts: new ContractsService(
        dataSource,
        transfers,
        {} as AiClubBudgetService,
      ),
      transfers,
    };
  }

  it.each([
    'meta',
    'team training',
    'individual training',
    'contract offer',
    'contract decision',
    'transfer agreement',
    'release',
  ])('blocks %s before any write', async (action) => {
    const context = setup();
    let operation: Promise<unknown>;
    switch (action) {
      case 'meta':
        operation = context.careers.updateMeta(1, 7, {
          meta: TeamStrategy.BOT_CARRY,
        });
        break;
      case 'team training':
        operation = context.training.trainTeam(7, 1, {
          type: TrainingType.CHEMISTRY,
        });
        break;
      case 'individual training':
        operation = context.training.trainIndividual(7, 1, {
          type: TrainingType.LANING,
          careerPlayerId: 11,
        });
        break;
      case 'contract offer':
        operation = context.contracts.createOffer(7, 1, {
          careerPlayerId: 11,
          terms: {
            annualSalary: 10000,
            years: 2,
            starterGuarantee: false,
            expectedRole: ContractExpectedRole.ROTATION,
            promises: [],
          },
        });
        break;
      case 'contract decision':
        operation = context.contracts.respond(7, 1, 21, {
          action: ContractDecisionAction.ACCEPT,
        });
        break;
      case 'transfer agreement':
        operation = context.transfers.createAgreement(7, 1, {
          careerPlayerId: 11,
          offeredFee: 10000,
        });
        break;
      default:
        operation = context.transfers.releasePlayer(7, 1, 11);
    }
    await expect(operation).rejects.toThrow('경질된 감독');
    expect(context.manager.save).not.toHaveBeenCalled();
    expect(context.manager.update).not.toHaveBeenCalled();
    expect(context.manager.delete).not.toHaveBeenCalled();
    if (action.includes('training')) {
      expect(context.query.setLock).toHaveBeenCalledWith('pessimistic_write');
    } else {
      expect(context.manager.findOne).toHaveBeenNthCalledWith(1, Career, {
        where: { id: 1, accountId: 7 },
        lock: { mode: 'pessimistic_write' },
      });
    }
  });

  it('keeps contract and transfer history readable after dismissal', async () => {
    const context = setup();
    await expect(context.contracts.findContracts(7, 1)).resolves.toEqual([]);
    await expect(context.contracts.findOffers(7, 1)).resolves.toEqual([]);
    await expect(context.transfers.findHistory(7, 1)).resolves.toEqual([]);
    expect(context.manager.findOne).not.toHaveBeenCalledWith(
      ManagerCareerState,
      expect.anything(),
    );
  });
});
