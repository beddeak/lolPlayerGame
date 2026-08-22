import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Position } from '../players/enums/position.enum';
import { CareerTeamsService } from './career-teams.service';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { CareerTeam } from './entities/career-team.entity';
import { Roster } from './entities/roster.entity';
import { PlayerInstruction } from './enums/player-instruction.enum';
import { Region } from './enums/region.enum';
import { RosterRole } from './enums/roster-role.enum';
import { TeamStrategy } from './enums/team-strategy.enum';

describe('CareerTeamsService', () => {
  const careerTeamsRepository = {
    findOneBy: jest.fn(),
    save: jest.fn(),
  };
  const rostersRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const roleProficienciesRepository = {
    create: jest.fn(
      (
        value: Partial<CareerPlayerRoleProficiency>,
      ): CareerPlayerRoleProficiency => value as CareerPlayerRoleProficiency,
    ),
    findOneBy: jest.fn(),
    save: jest.fn(),
  };
  const careerTeam = {
    id: 1,
    careerId: 1,
    code: 'TEAM_A',
    name: 'Team A',
    region: Region.LCK,
    isUserControlled: true,
    teamStrategy: TeamStrategy.BALANCED,
  } as CareerTeam;
  const roster = {
    id: 10,
    careerTeamId: careerTeam.id,
    careerTeam,
    careerPlayerId: 100,
    role: RosterRole.STARTER,
    starterPosition: Position.ADC,
    playerInstruction: null,
  } as Roster;
  const roleProficiency = {
    id: 20,
    careerPlayerId: roster.careerPlayerId,
    position: Position.ADC,
    instruction: PlayerInstruction.HYPER_CARRY,
    proficiency: 50,
  } as CareerPlayerRoleProficiency;

  let service: CareerTeamsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CareerTeamsService,
        {
          provide: getRepositoryToken(CareerTeam),
          useValue: careerTeamsRepository,
        },
        {
          provide: getRepositoryToken(Roster),
          useValue: rostersRepository,
        },
        {
          provide: getRepositoryToken(CareerPlayerRoleProficiency),
          useValue: roleProficienciesRepository,
        },
      ],
    }).compile();

    service = module.get<CareerTeamsService>(CareerTeamsService);
    careerTeam.teamStrategy = TeamStrategy.BALANCED;
    roster.playerInstruction = null;
    careerTeamsRepository.findOneBy.mockResolvedValue(careerTeam);
    careerTeamsRepository.save.mockImplementation((value) =>
      Promise.resolve(value),
    );
    rostersRepository.findOne.mockResolvedValue(roster);
    rostersRepository.save.mockImplementation((value) =>
      Promise.resolve(value),
    );
    roleProficienciesRepository.findOneBy.mockResolvedValue(roleProficiency);
    roleProficienciesRepository.save.mockImplementation((value) =>
      Promise.resolve(value),
    );
  });

  it('updates the selected team strategy', async () => {
    const result = await service.updateStrategy(1, 1, {
      strategy: TeamStrategy.BOT_CARRY,
    });

    expect(result.strategy).toBe(TeamStrategy.BOT_CARRY);
    expect(careerTeamsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ teamStrategy: TeamStrategy.BOT_CARRY }),
    );
  });

  it('rejects a team outside the career', async () => {
    careerTeamsRepository.findOneBy.mockResolvedValue(null);

    await expect(
      service.updateStrategy(1, 99, { strategy: TeamStrategy.BALANCED }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sets a compatible instruction and returns its proficiency', async () => {
    const result = await service.updatePlayerInstruction(
      1,
      careerTeam.id,
      Position.ADC,
      { instruction: PlayerInstruction.HYPER_CARRY },
    );

    expect(result.instruction).toBe(PlayerInstruction.HYPER_CARRY);
    expect(result.roleProficiency).toBe(50);
    expect(rostersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        playerInstruction: PlayerInstruction.HYPER_CARRY,
      }),
    );
  });

  it('rejects an instruction that does not belong to the position', async () => {
    await expect(
      service.updatePlayerInstruction(1, careerTeam.id, Position.ADC, {
        instruction: PlayerInstruction.OBJECTIVE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rostersRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a missing starter slot', async () => {
    rostersRepository.findOne.mockResolvedValue(null);

    await expect(
      service.updatePlayerInstruction(1, careerTeam.id, Position.ADC, {
        instruction: PlayerInstruction.HYPER_CARRY,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
