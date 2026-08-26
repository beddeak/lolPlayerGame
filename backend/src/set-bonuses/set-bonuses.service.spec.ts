import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PlayerCard } from '../players/entities/player-card.entity';
import { SetBonus } from './entities/set-bonus.entity';
import { SetBonusesService } from './set-bonuses.service';

describe('SetBonusesService', () => {
  const setBonusesRepository = {
    findOneBy: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const playerCardsRepository = {
    findBy: jest.fn(),
  };
  const entityManager = {
    create: jest.fn((_entity: unknown, value: Record<string, unknown>) => ({
      ...value,
    })),
    save: jest.fn((entity: unknown, value: unknown) => {
      if (entity === SetBonus && !Array.isArray(value)) {
        return Promise.resolve({ ...(value as object), id: 1 });
      }

      return Promise.resolve(value);
    }),
  };
  const dataSource = {
    transaction: jest.fn(
      (work: (manager: typeof entityManager) => Promise<unknown>) =>
        work(entityManager),
    ),
  };
  let service: SetBonusesService;

  beforeEach(() => {
    jest.clearAllMocks();
    setBonusesRepository.findOneBy.mockResolvedValue(null);
    playerCardsRepository.findBy.mockResolvedValue([{ id: 11 }, { id: 12 }]);
    service = new SetBonusesService(
      dataSource as unknown as DataSource,
      setBonusesRepository as unknown as Repository<SetBonus>,
      playerCardsRepository as unknown as Repository<PlayerCard>,
    );
  });

  it('creates a data-driven set bonus with player card requirements', async () => {
    const result = await service.create({
      code: 'BOTTOM_DUO',
      name: 'Bottom Duo',
      requiredPlayerCardIds: [11, 12],
      chemistryBonus: 10,
      laningBonus: 4,
      teamPlayBonus: 4,
    });

    expect(result).toEqual({
      id: 1,
      code: 'BOTTOM_DUO',
      name: 'Bottom Duo',
      description: null,
      requiredPlayerCardIds: [11, 12],
      chemistryBonus: 10,
      laningBonus: 4,
      teamFightBonus: 0,
      macroBonus: 0,
      teamPlayBonus: 4,
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate set bonus code', async () => {
    setBonusesRepository.findOneBy.mockResolvedValue({ id: 99 });

    await expect(
      service.create({
        code: 'BOTTOM_DUO',
        name: 'Bottom Duo',
        requiredPlayerCardIds: [11, 12],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects missing required player cards', async () => {
    playerCardsRepository.findBy.mockResolvedValue([{ id: 11 }]);

    await expect(
      service.create({
        code: 'BOTTOM_DUO',
        name: 'Bottom Duo',
        requiredPlayerCardIds: [11, 12],
      }),
    ).rejects.toThrow('PlayerCards not found: 12');
    await expect(
      service.create({
        code: 'BOTTOM_DUO',
        name: 'Bottom Duo',
        requiredPlayerCardIds: [11, 12],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
