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
import { ChampionArchetype } from '../careers/enums/champion-archetype.enum';
import { Position } from '../players/enums/position.enum';
import { SetBonus } from '../set-bonuses/entities/set-bonus.entity';
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
  const setBonusesRepository = {
    find: jest.fn(),
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
    update: jest.fn().mockResolvedValue({ affected: 1 }),
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
      playerCardId: id,
      currentMechanics: 70,
      currentGameSense: 70,
      currentLaning: 70,
      currentTeamFight: 70,
      currentMacro: 70,
      currentTeamPlay: 70,
      currentMental: 70,
      currentChampionPool: 70,
      form: 50,
      condition: 100,
      roleProficiencies: [],
    }) as CareerPlayer;
  const createCareerTeam = (id: number, code: string): CareerTeam => {
    const careerTeam = {
      id,
      careerId: 1,
      career: {
        id: 1,
        accountId: 7,
        currentMeta: TeamStrategy.BALANCED,
      },
      code,
      name: code,
      region: Region.LCK,
      isUserControlled: id === 1,
      teamStrategy: TeamStrategy.BALANCED,
      chemistry: 50,
      strategyProficiencies: Object.values(TeamStrategy).map(
        (strategy, index) => ({
          id: id * 100 + index,
          careerTeamId: id,
          strategy,
          proficiency: 50,
        }),
      ),
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
      championArchetype: null,
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
        {
          provide: getRepositoryToken(SetBonus),
          useValue: setBonusesRepository,
        },
      ],
    }).compile();

    service = module.get<MatchesService>(MatchesService);
    for (const rosterEntry of [...teamA.rosters, ...teamB.rosters]) {
      rosterEntry.playerInstruction = null;
      rosterEntry.championArchetype = null;
      rosterEntry.careerPlayer.roleProficiencies = [];
    }
    careerTeamsRepository.find.mockResolvedValue([teamA, teamB]);
    setBonusesRepository.find.mockResolvedValue([]);
    teamA.chemistry = 50;
    teamB.chemistry = 50;
    entityManager.save.mockImplementation((_entity, value) => {
      const values = Array.isArray(value) ? value : [value];

      values.forEach((item, index) => {
        item.id ??= 500 + index;
      });

      return Promise.resolve(Array.isArray(value) ? values : values[0]);
    });
  });

  it('simulates two complete teams from the same career', async () => {
    const result = await service.simulate(7, {
      careerId: 1,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 12345,
    });

    expect(result.careerId).toBe(1);
    expect(result.currentMeta).toBe(TeamStrategy.BALANCED);
    expect(result.matchId).toBe(500);
    expect(result.teams).toHaveLength(2);
    expect(result.teams[0].playerStats).toHaveLength(5);
    expect(result.teams[0].baseAbility).toBe(70);
    expect(result.teams[0].archetypeModifier).toBe(0);
    expect(result.teams[0].stateModifier).toBe(1.6);
    expect(result.teams[0].playerStats[0]).toEqual(
      expect.objectContaining({
        form: 50,
        condition: 100,
        mental: 70,
      }),
    );
    expect(entityManager.update).toHaveBeenCalledTimes(10);
    expect([teamA.id, teamB.id]).toContain(result.winnerTeamId);
  });

  it('activates a data-driven set bonus only for the matching roster', async () => {
    setBonusesRepository.find.mockResolvedValue([
      {
        id: 1,
        code: 'TEAM_A_DUO',
        name: 'Team A Duo',
        chemistryBonus: 10,
        laningBonus: 4,
        teamFightBonus: 2,
        macroBonus: 0,
        teamPlayBonus: 4,
        requirements: teamA.rosters.slice(0, 2).map((rosterEntry) => ({
          playerCardId: rosterEntry.careerPlayer.playerCardId,
        })),
      },
    ]);

    const result = await service.simulate(7, {
      careerId: 1,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 2026,
    });

    expect(result.teams[0].activeSetBonuses).toHaveLength(1);
    expect(result.teams[0].effectiveChemistry).toBe(60);
    expect(result.teams[0].setBonusModifier).toBeGreaterThan(0);
    expect(result.teams[1].activeSetBonuses).toEqual([]);
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

    const result = await service.simulate(7, {
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

  it('uses and snapshots selected ADC and Support archetypes', async () => {
    const adcRoster = teamA.rosters.find(
      (rosterEntry) => rosterEntry.starterPosition === Position.ADC,
    )!;
    const supportRoster = teamA.rosters.find(
      (rosterEntry) => rosterEntry.starterPosition === Position.SUPPORT,
    )!;

    adcRoster.championArchetype = ChampionArchetype.HYPER_CARRY;
    supportRoster.championArchetype = ChampionArchetype.UTILITY;

    const result = await service.simulate(7, {
      careerId: 1,
      teamAId: teamA.id,
      teamBId: teamB.id,
      seed: 124,
    });
    const adcStats = result.teams[0].playerStats.find(
      (playerStat) => playerStat.position === Position.ADC,
    )!;
    const supportStats = result.teams[0].playerStats.find(
      (playerStat) => playerStat.position === Position.SUPPORT,
    )!;

    expect(result.teams[0].archetypeModifier).not.toBe(0);
    expect(adcStats.championArchetype).toBe(ChampionArchetype.HYPER_CARRY);
    expect(supportStats.championArchetype).toBe(ChampionArchetype.UTILITY);
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
      teamAStrategyProficiency: 50,
      teamAStrategyProficiencyModifier: 0,
      teamAMetaModifier: 3,
      teamAChemistry: 50,
      teamAEffectiveChemistry: 60,
      teamAChemistryModifier: 0.8,
      teamASetBonusModifier: 1.5,
      teamAActiveSetBonuses: [
        {
          id: 1,
          code: 'BOTTOM_DUO',
          name: 'Bottom Duo',
          chemistryBonus: 10,
          laningBonus: 4,
          teamFightBonus: 4,
          macroBonus: 0,
          teamPlayBonus: 4,
        },
      ],
      teamAArchetypeModifier: 0.5,
      teamAStateModifier: 1.6,
      teamBBaseAbility: 70,
      teamBRngModifier: -1,
      teamBPerformance: 69,
      teamBStrategy: TeamStrategy.BALANCED,
      teamBStrategyProficiency: 50,
      teamBStrategyProficiencyModifier: 0,
      teamBMetaModifier: 3,
      teamBChemistry: 50,
      teamBEffectiveChemistry: 50,
      teamBChemistryModifier: 0,
      teamBSetBonusModifier: 0,
      teamBActiveSetBonuses: [],
      teamBArchetypeModifier: 0,
      teamBStateModifier: 1.6,
      currentMeta: TeamStrategy.BALANCED,
      playerStats: [teamA, teamB].flatMap((team) =>
        STARTER_POSITIONS.map((position, index) => ({
          careerPlayerId: team.id * 100 + index,
          careerTeamId: team.id,
          position,
          playerInstruction: null,
          roleProficiency: null,
          championArchetype:
            team.id === teamA.id && position === Position.ADC
              ? ChampionArchetype.HYPER_CARRY
              : null,
          form: 50,
          condition: 100,
          mental: 70,
          formModifier: 0,
          conditionModifier: 0,
          mentalModifier: 1.6,
          stateModifier: 1.6,
          formAfter: 51,
          conditionAfter: 94,
          mentalAfter: 71,
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

    const result = await service.findOne(7, 9);

    expect(result.matchId).toBe(9);
    expect(result.winnerTeamCode).toBe(teamA.code);
    expect(result.teams).toHaveLength(2);
    expect(result.teams[0].teamKills).toBe(10);
    expect(result.teams[0].playerStats).toHaveLength(5);
    expect(result.teams[0].activeSetBonuses[0].code).toBe('BOTTOM_DUO');
    expect(result.teams[0].archetypeModifier).toBe(0.5);
    expect(result.teams[0].stateModifier).toBe(1.6);
    expect(result.teams[0].playerStats[0]).toEqual(
      expect.objectContaining({
        form: 50,
        condition: 100,
        mental: 70,
        formAfter: 51,
        conditionAfter: 94,
        mentalAfter: 71,
      }),
    );
    expect(
      result.teams[0].playerStats.find(
        (playerStat) => playerStat.position === Position.ADC,
      )?.championArchetype,
    ).toBe(ChampionArchetype.HYPER_CARRY);
  });

  it('rejects an unknown stored match', async () => {
    matchesRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne(7, 404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a match where both ids point to the same team', async () => {
    await expect(
      service.simulate(7, {
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
      service.simulate(7, {
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
      service.simulate(7, {
        careerId: 1,
        teamAId: teamA.id,
        teamBId: incompleteTeam.id,
        seed: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
