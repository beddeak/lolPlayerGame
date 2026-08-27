import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PlayerCard } from '../players/entities/player-card.entity';
import { Position } from '../players/enums/position.enum';
import { SetBonus } from '../set-bonuses/entities/set-bonus.entity';
import { CareersService } from './careers.service';
import { CreateCareerDto } from './dto/create-career.dto';
import { CareerPlayer } from './entities/career-player.entity';
import { CareerTeam } from './entities/career-team.entity';
import { CareerTeamStrategyProficiency } from './entities/career-team-strategy-proficiency.entity';
import { Career } from './entities/career.entity';
import { Roster } from './entities/roster.entity';
import { Region } from './enums/region.enum';
import { TeamStrategy } from './enums/team-strategy.enum';

describe('CareersService', () => {
  type SaveableEntity = { id?: number };

  const careersRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
  };
  const setBonusesRepository = {
    find: jest.fn(),
  };
  const entityManager = {
    find: jest.fn(
      (_entity: unknown, _options: unknown): Promise<PlayerCard[]> => {
        void _entity;
        void _options;
        return Promise.resolve([]);
      },
    ),
    create: jest.fn((_entity: unknown, value: Record<string, unknown>) => ({
      ...value,
    })),
    save: jest.fn(
      (
        _entity: unknown,
        value: SaveableEntity | SaveableEntity[],
      ): Promise<SaveableEntity | SaveableEntity[]> => Promise.resolve(value),
    ),
  };
  const dataSource = {
    transaction: jest.fn(
      (
        work: (manager: typeof entityManager) => Promise<unknown>,
      ): Promise<unknown> => work(entityManager),
    ),
  };
  const positions = Object.values(Position);
  const playerCards: PlayerCard[] = Array.from({ length: 10 }, (_, index) => {
    const position = positions[index % positions.length];

    return {
      id: index + 1,
      playerId: index + 101,
      themeId: 1,
      cardYear: 2026,
      startingAge: 18 + index,
      imageUrl: `/player-cards/player-${index + 1}.svg`,
      mainPosition: position,
      mechanics: 80 + index,
      gameSense: 81,
      laning: 82,
      teamFight: 83,
      macro: 84,
      teamPlay: 85,
      mental: 86,
      championPool: 87,
      potential: 99,
      player: {
        id: index + 101,
        nickname: `Player ${index + 1}`,
        nationality: 'KR',
        playerCards: [],
      },
      theme: {
        id: 1,
        code: 'CURRENT_2026',
        name: '2026 Current',
        description: null,
        playerCards: [],
      },
    };
  });

  let service: CareersService;
  let dto: CreateCareerDto;

  beforeEach(async () => {
    jest.clearAllMocks();
    careersRepository.save.mockImplementation((career: Career) =>
      Promise.resolve(career),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CareersService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(Career),
          useValue: careersRepository,
        },
        {
          provide: getRepositoryToken(SetBonus),
          useValue: setBonusesRepository,
        },
      ],
    }).compile();

    service = module.get<CareersService>(CareersService);
    dto = {
      startYear: 2026,
      managedTeamCode: 'TEAM_A',
      teams: [
        {
          code: 'TEAM_A',
          name: 'Team A',
          region: Region.LCK,
          starters: positions.map((position, index) => ({
            playerCardId: index + 1,
            position,
          })),
        },
        {
          code: 'TEAM_B',
          name: 'Team B',
          region: Region.LPL,
          starters: positions.map((position, index) => ({
            playerCardId: index + 6,
            position,
          })),
        },
      ],
    };

    entityManager.find.mockResolvedValue(playerCards);
    setBonusesRepository.find.mockResolvedValue([]);
    entityManager.save.mockImplementation((entity, value) => {
      const values = Array.isArray(value) ? value : [value];
      const firstId =
        entity === Career
          ? 1
          : entity === CareerTeam
            ? 11
            : entity === CareerPlayer
              ? 101
              : entity === Roster
                ? 201
                : entity === CareerTeamStrategyProficiency
                  ? 301
                  : 401;

      values.forEach((item, index) => {
        item.id = firstId + index;
      });

      return Promise.resolve(Array.isArray(value) ? values : values[0]);
    });
  });

  it('creates a 2026 career with two complete starting rosters', async () => {
    const result = await service.create(7, dto);

    expect(result.startYear).toBe(2026);
    expect(result.currentYear).toBe(2026);
    expect(result.currentMeta).toBe(TeamStrategy.BALANCED);
    expect(entityManager.create).toHaveBeenCalledWith(
      Career,
      expect.objectContaining({ accountId: 7 }),
    );
    expect(result.teams).toHaveLength(2);
    expect(result.teams[0].isUserControlled).toBe(true);
    expect(result.teams[1].isUserControlled).toBe(false);
    expect(result.teams[0].chemistry).toBe(50);
    expect(result.teams[0].activeSetBonuses).toEqual([]);
    expect(
      result.teams[0].starters.map((starter) => starter.starterPosition),
    ).toEqual(positions);
    expect(result.teams[0].starters[0].careerPlayer.currentMechanics).toBe(
      playerCards[0].mechanics,
    );
    expect(result.teams[0].starters[0].careerPlayer.form).toBe(50);
    expect(result.teams[0].starters[0].careerPlayer.condition).toBe(100);
    expect(
      result.teams[0].starters[0].careerPlayer.roleProficiencies,
    ).toHaveLength(4);
    expect(result.teams[0].strategyProficiencies).toHaveLength(8);
    expect(
      result.teams[0].strategyProficiencies.every(
        ({ proficiency }) => proficiency === 50,
      ),
    ).toBe(true);
    expect(
      result.teams[0].starters[0].careerPlayer.playerCard,
    ).not.toHaveProperty('potential');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('reports a set bonus only when every required card is on the team', async () => {
    setBonusesRepository.find.mockResolvedValue([
      {
        id: 1,
        code: 'TEAM_A_DUO',
        name: 'Team A Duo',
        description: null,
        chemistryBonus: 10,
        laningBonus: 4,
        teamFightBonus: 2,
        macroBonus: 0,
        teamPlayBonus: 4,
        requirements: [{ playerCardId: 1 }, { playerCardId: 2 }],
      },
    ]);

    const result = await service.create(7, dto);

    expect(result.teams[0].activeSetBonuses).toEqual([
      expect.objectContaining({ code: 'TEAM_A_DUO' }),
    ]);
    expect(result.teams[1].activeSetBonuses).toEqual([]);
  });

  it('rejects a PlayerCard used by more than one team', async () => {
    dto.teams[1].starters[0].playerCardId =
      dto.teams[0].starters[0].playerCardId;

    await expect(service.create(7, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a team without exactly one starter per position', async () => {
    dto.teams[0].starters[4].position = Position.ADC;

    await expect(service.create(7, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown managed team', async () => {
    dto.managedTeamCode = 'UNKNOWN';

    await expect(service.create(7, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rolls back creation when a requested PlayerCard does not exist', async () => {
    entityManager.find.mockResolvedValue(playerCards.slice(0, -1));

    await expect(service.create(7, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(entityManager.save).not.toHaveBeenCalled();
  });

  it('updates the current career meta', async () => {
    careersRepository.findOneBy.mockResolvedValue({
      id: 1,
      startYear: 2026,
      currentYear: 2026,
      currentMeta: TeamStrategy.BALANCED,
    });

    const result = await service.updateMeta(1, 7, {
      meta: TeamStrategy.BOT_CARRY,
    });

    expect(result).toEqual({
      careerId: 1,
      currentMeta: TeamStrategy.BOT_CARRY,
    });
    expect(careersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ currentMeta: TeamStrategy.BOT_CARRY }),
    );
  });

  it('rejects a meta update for an unknown career', async () => {
    careersRepository.findOneBy.mockResolvedValue(null);

    await expect(
      service.updateMeta(999, 7, { meta: TeamStrategy.BOT_CARRY }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(careersRepository.save).not.toHaveBeenCalled();
  });

  it('lists only the account career save summaries', async () => {
    careersRepository.find.mockResolvedValue([
      {
        id: 3,
        accountId: 7,
        startYear: 2026,
        currentYear: 2028,
        currentMeta: TeamStrategy.BOT_CARRY,
        careerTeams: [
          {
            id: 31,
            code: 'TEAM_A',
            name: 'Team A',
            isUserControlled: true,
          },
        ],
      },
    ]);

    const result = await service.findAll(7);

    expect(careersRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: 7 } }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 3,
        currentYear: 2028,
        managedTeamCode: 'TEAM_A',
      }),
    ]);
  });
});
