import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { PlayerInstruction } from '../careers/enums/player-instruction.enum';
import { Region } from '../careers/enums/region.enum';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { Position } from '../players/enums/position.enum';
import { Match } from './entities/match.entity';
import { MatchesService } from './matches.service';
import { MatchStatsSimulationService } from './simulation/match-stats-simulation.service';
import { SimpleMatchSimulationService } from './simulation/simple-match-simulation.service';

describe('MatchesService', () => {
  type SaveableEntity = { id?: number };

  const careerTeamsRepository = {
    find: jest.fn(),
  };
  const matchesRepository = {
    findOne: jest.fn(),
  };
  const entityManager = {
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
        work: (manager: typeof entityManager) => Promise<number>,
      ): Promise<number> => work(entityManager),
    ),
  };

  const createCareerPlayer = (id: number): CareerPlayer =>
    ({
      id,
      currentMechanics: 70,
      currentGameSense: 70,
      currentLaning: 70,
      currentTeamFight: 70,
      currentMacro: 70,
      currentTeamPlay: 70,
      currentMental: 70,
      currentChampionPool: 70,
      roleProficiencies: [],
    }) as CareerPlayer;
  const createCareerTeam = (id: number, code: string): CareerTeam => {
    const careerTeam = {
      id,
      careerId: 1,
      code,
      name: code,
      region: Region.LCK,
      isUserControlled: id === 1,
      teamStrategy: TeamStrategy.BALANCED,
      rosters: [],
    } as unknown as CareerTeam;

    careerTeam.rosters = STARTER_POSITIONS.map((position, index) => ({
      id: id * 10 + index,
      careerTeamId: id,
      careerTeam,
      careerPlayerId: id * 100 + index,
      careerPlayer: createCareerPlayer(id * 100 + index),
      role: RosterRole.STARTER,
      starterPosition: position,
      playerInstruction: null,
    }));

    return careerTeam;
  };
  const teamA = createCareerTeam(1, 'TEAM_A');
  const teamB = createCareerTeam(2, 'TEAM_B');

  let service: MatchesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesService,
        SimpleMatchSimulationService,
        MatchStatsSimulationService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(CareerTeam),
          useValue: careerTeamsRepository,
        },
        {
          provide: getRepositoryToken(Match),
          useValue: matchesRepository,
        },
      ],
    }).compile();

    service = module.get<MatchesService>(MatchesService);
    for (const rosterEntry of [...teamA.rosters, ...teamB.rosters]) {
      rosterEntry.playerInstruction = null;
      rosterEntry.careerPlayer.roleProficiencies = [];
    }
    careerTeamsRepository.find.mockResolvedValue([teamA, teamB]);
    entityManager.save.mockImplementation((_entity, value) => {
      const values = Array.isArray(value) ? value : [value];

      values.forEach((item, index) => {
        item.id ??= 500 + index;
      });

      return Promise.resolve(Array.isArray(value) ? values : values[0]);
    });
  });

  it('simulates two complete teams from the same career', async () => {
    const result = await service.simulate({
      careerId: 1,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 12345,
    });

    expect(result.careerId).toBe(1);
    expect(result.matchId).toBe(500);
    expect(result.teams).toHaveLength(2);
    expect(result.teams[0].playerStats).toHaveLength(5);
    expect(result.teams[0].baseAbility).toBe(70);
    expect([teamA.id, teamB.id]).toContain(result.winnerTeamId);
  });

  it('uses and snapshots an active role proficiency', async () => {
    const adcRoster = teamA.rosters.find(
      (rosterEntry) => rosterEntry.starterPosition === Position.ADC,
    )!;
    adcRoster.playerInstruction = PlayerInstruction.HYPER_CARRY;
    adcRoster.careerPlayer.roleProficiencies = [
      {
        id: 1,
        careerPlayerId: adcRoster.careerPlayerId,
        careerPlayer: adcRoster.careerPlayer,
        position: Position.ADC,
        instruction: PlayerInstruction.HYPER_CARRY,
        proficiency: 90,
      },
    ];

    const result = await service.simulate({
      careerId: 1,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 123,
    });
    const adcStats = result.teams[0].playerStats.find(
      (playerStat) => playerStat.position === Position.ADC,
    )!;

    expect(adcStats.playerInstruction).toBe(PlayerInstruction.HYPER_CARRY);
    expect(adcStats.roleProficiency).toBe(90);
  });

  it('returns a stored match with its player stats', async () => {
    matchesRepository.findOne.mockResolvedValue({
      id: 9,
      careerId: 1,
      seed: 12345,
      durationMinutes: 31.5,
      winnerTeamId: teamA.id,
      winnerTeam: teamA,
      teamAId: teamA.id,
      teamA,
      teamBId: teamB.id,
      teamB,
      teamABaseAbility: 70,
      teamARngModifier: 1,
      teamAPerformance: 71,
      teamAStrategy: TeamStrategy.BALANCED,
      teamBBaseAbility: 70,
      teamBRngModifier: -1,
      teamBPerformance: 69,
      teamBStrategy: TeamStrategy.BALANCED,
      playerStats: [teamA, teamB].flatMap((team) =>
        STARTER_POSITIONS.map((position, index) => ({
          careerPlayerId: team.id * 100 + index,
          careerTeamId: team.id,
          position,
          playerInstruction: null,
          roleProficiency: null,
          kills: index,
          deaths: index,
          assists: index,
          kda: 1,
          dpm: 500,
          damageShare: 20,
          gold: 10000,
          goldShare: 20,
          gdAt15: 0,
          csdAt15: 0,
          kp: 50,
          rating: 5,
        })),
      ),
    });

    const result = await service.findOne(9);

    expect(result.matchId).toBe(9);
    expect(result.winnerTeamCode).toBe(teamA.code);
    expect(result.teams).toHaveLength(2);
    expect(result.teams[0].teamKills).toBe(10);
    expect(result.teams[0].playerStats).toHaveLength(5);
  });

  it('rejects an unknown stored match', async () => {
    matchesRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne(404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a match where both ids point to the same team', async () => {
    await expect(
      service.simulate({
        careerId: 1,
        teamAId: teamA.id,
        teamBId: teamA.id,
        seed: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(careerTeamsRepository.find).not.toHaveBeenCalled();
  });

  it('rejects a team outside the requested career', async () => {
    careerTeamsRepository.find.mockResolvedValue([teamA]);

    await expect(
      service.simulate({
        careerId: 1,
        teamAId: teamA.id,
        teamBId: teamB.id,
        seed: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an incomplete starting roster', async () => {
    const incompleteTeam = createCareerTeam(2, 'INCOMPLETE');
    incompleteTeam.rosters = incompleteTeam.rosters.slice(0, -1);
    careerTeamsRepository.find.mockResolvedValue([teamA, incompleteTeam]);

    await expect(
      service.simulate({
        careerId: 1,
        teamAId: teamA.id,
        teamBId: incompleteTeam.id,
        seed: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
