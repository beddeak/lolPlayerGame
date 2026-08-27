import { STARTER_POSITIONS } from '../../careers/constants/career.constants';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { Position } from '../../players/enums/position.enum';
import { SIMPLE_MATCH_CONFIG } from '../config/simple-match.config';
import { SimpleMatchSimulationService } from './simple-match-simulation.service';
import {
  SimpleMatchPlayerInput,
  SimpleMatchTeamInput,
} from './simple-match.types';

describe('SimpleMatchSimulationService', () => {
  const createPlayer = (
    ability: number,
    index: number,
  ): SimpleMatchPlayerInput => ({
    careerPlayerId: index + 1,
    position: STARTER_POSITIONS[index],
    playerInstruction: null,
    roleProficiency: null,
    championArchetype: null,
    form: 50,
    condition: 100,
    mechanics: ability,
    gameSense: ability,
    laning: ability,
    teamFight: ability,
    macro: ability,
    teamPlay: ability,
    mental: ability,
    championPool: ability,
  });
  const createTeam = (
    teamId: number,
    teamCode: string,
    ability: number,
  ): SimpleMatchTeamInput => ({
    teamId,
    teamCode,
    teamStrategy: TeamStrategy.BALANCED,
    strategyProficiency: 50,
    chemistry: 50,
    activeSetBonuses: [],
    players: Array.from(
      { length: SIMPLE_MATCH_CONFIG.requiredStarterCount },
      (_, index) => createPlayer(ability, index),
    ),
  });
  const teamA = createTeam(1, 'TEAM_A', 70);
  const teamB = createTeam(2, 'TEAM_B', 70);

  let service: SimpleMatchSimulationService;

  beforeEach(() => {
    service = new SimpleMatchSimulationService();
  });

  it('reproduces exactly the same match with the same seed', () => {
    const firstResult = service.simulate(
      teamA,
      teamB,
      12345,
      TeamStrategy.BALANCED,
    );
    const secondResult = service.simulate(
      teamA,
      teamB,
      12345,
      TeamStrategy.BALANCED,
    );

    expect(secondResult).toEqual(firstResult);
  });

  it('changes the RNG result when the seed changes', () => {
    const firstResult = service.simulate(
      teamA,
      teamB,
      1,
      TeamStrategy.BALANCED,
    );
    const secondResult = service.simulate(
      teamA,
      teamB,
      2,
      TeamStrategy.BALANCED,
    );

    expect(secondResult.teams).not.toEqual(firstResult.teams);
  });

  it('uses the eight current stats as equal-weight base ability', () => {
    const variedPlayerStats = {
      mechanics: 80,
      gameSense: 70,
      laning: 60,
      teamFight: 50,
      macro: 40,
      teamPlay: 30,
      mental: 20,
      championPool: 10,
    };
    const variedTeam: SimpleMatchTeamInput = {
      teamId: 3,
      teamCode: 'VARIED',
      teamStrategy: TeamStrategy.BALANCED,
      strategyProficiency: 50,
      chemistry: 50,
      activeSetBonuses: [],
      players: Array.from(
        { length: SIMPLE_MATCH_CONFIG.requiredStarterCount },
        (_, index) => ({
          ...variedPlayerStats,
          careerPlayerId: index + 101,
          position: STARTER_POSITIONS[index],
          playerInstruction: null,
          roleProficiency: null,
          championArchetype: null,
          form: 50,
          condition: 100,
        }),
      ),
    };

    const result = service.simulate(
      variedTeam,
      teamB,
      7,
      TeamStrategy.BALANCED,
    );

    expect(result.teams[0].baseAbility).toBe(45);
  });

  it('keeps the RNG modifier inside the configured range', () => {
    const result = service.simulate(teamA, teamB, 999, TeamStrategy.BALANCED);

    for (const teamResult of result.teams) {
      expect(teamResult.rngModifier).toBeGreaterThanOrEqual(
        SIMPLE_MATCH_CONFIG.rngModifierMin,
      );
      expect(teamResult.rngModifier).toBeLessThanOrEqual(
        SIMPLE_MATCH_CONFIG.rngModifierMax,
      );
    }
  });

  it('applies Form, Condition, and Mental without changing base ability', () => {
    const lowStateTeam = createTeam(30, 'LOW_STATE', 70);
    const highStateTeam = createTeam(31, 'HIGH_STATE', 70);

    lowStateTeam.players.forEach((player) => {
      player.form = 20;
      player.condition = 40;
    });
    highStateTeam.players.forEach((player) => {
      player.form = 90;
      player.condition = 100;
    });

    const result = service.simulate(
      lowStateTeam,
      highStateTeam,
      100,
      TeamStrategy.BALANCED,
    );

    expect(result.teams[0].baseAbility).toBe(70);
    expect(result.teams[1].baseAbility).toBe(70);
    expect(result.teams[0].stateModifier).toBeLessThan(0);
    expect(result.teams[1].stateModifier).toBeGreaterThan(0);
    expect(result.teams[1].performance).toBeGreaterThan(
      result.teams[0].performance,
    );
  });

  it('always lets a vastly stronger team beat the RNG range', () => {
    const strongTeam = createTeam(3, 'STRONG', 100);
    const weakTeam = createTeam(4, 'WEAK', 0);

    const result = service.simulate(
      strongTeam,
      weakTeam,
      42,
      TeamStrategy.BALANCED,
    );

    expect(result.winnerTeamId).toBe(strongTeam.teamId);
  });

  it('changes team ability when a strategy fits a strong position', () => {
    const topFocusedPlayers = STARTER_POSITIONS.map((position, index) =>
      createPlayer(position === Position.TOP ? 100 : 50, index),
    );
    const balancedTeam: SimpleMatchTeamInput = {
      teamId: 5,
      teamCode: 'BALANCED_TEAM',
      teamStrategy: TeamStrategy.BALANCED,
      strategyProficiency: 50,
      chemistry: 50,
      activeSetBonuses: [],
      players: topFocusedPlayers,
    };
    const topCarryTeam: SimpleMatchTeamInput = {
      ...balancedTeam,
      teamId: 6,
      teamCode: 'TOP_CARRY_TEAM',
      teamStrategy: TeamStrategy.TOP_CARRY,
    };
    const result = service.simulate(
      balancedTeam,
      topCarryTeam,
      50,
      TeamStrategy.BALANCED,
    );

    expect(result.teams[1].baseAbility).toBeGreaterThan(
      result.teams[0].baseAbility,
    );
  });

  it('applies role proficiency to an active player instruction', () => {
    const lowProficiencyTeam = createTeam(7, 'LOW_ROLE', 70);
    const highProficiencyTeam = createTeam(8, 'HIGH_ROLE', 70);
    const lowAdc = lowProficiencyTeam.players.find(
      (player) => player.position === Position.ADC,
    )!;
    const highAdc = highProficiencyTeam.players.find(
      (player) => player.position === Position.ADC,
    )!;

    lowAdc.playerInstruction = PlayerInstruction.HYPER_CARRY;
    lowAdc.roleProficiency = 0;
    highAdc.playerInstruction = PlayerInstruction.HYPER_CARRY;
    highAdc.roleProficiency = 100;

    const result = service.simulate(
      lowProficiencyTeam,
      highProficiencyTeam,
      51,
      TeamStrategy.BALANCED,
    );

    expect(result.teams[1].baseAbility).toBeGreaterThan(
      result.teams[0].baseAbility,
    );
  });

  it('rejects an incomplete starting roster', () => {
    const incompleteTeam = {
      ...teamA,
      players: teamA.players.slice(0, -1),
    };

    expect(() =>
      service.simulate(incompleteTeam, teamB, 42, TeamStrategy.BALANCED),
    ).toThrow(RangeError);
  });

  it('rewards meta fit but lets low proficiency outweigh the bonus', () => {
    const metaTeam = createTeam(9, 'META_LOW', 70);
    const practicedTeam = createTeam(10, 'PRACTICED', 70);

    metaTeam.teamStrategy = TeamStrategy.BOT_CARRY;
    metaTeam.strategyProficiency = 0;
    practicedTeam.teamStrategy = TeamStrategy.BALANCED;
    practicedTeam.strategyProficiency = 100;

    const result = service.simulate(
      metaTeam,
      practicedTeam,
      52,
      TeamStrategy.BOT_CARRY,
    );

    expect(result.currentMeta).toBe(TeamStrategy.BOT_CARRY);
    expect(result.teams[0].metaModifier).toBe(3);
    expect(result.teams[0].strategyProficiencyModifier).toBe(-8);
    expect(result.teams[1].metaModifier).toBe(0);
    expect(result.teams[1].strategyProficiencyModifier).toBe(4);
    expect(result.teams[1].performance).toBeGreaterThan(
      result.teams[0].performance,
    );
  });

  it('rewards a team with stronger chemistry', () => {
    const lowChemistryTeam = createTeam(11, 'LOW_CHEMISTRY', 70);
    const highChemistryTeam = createTeam(12, 'HIGH_CHEMISTRY', 70);

    lowChemistryTeam.chemistry = 0;
    highChemistryTeam.chemistry = 100;

    const result = service.simulate(
      lowChemistryTeam,
      highChemistryTeam,
      53,
      TeamStrategy.BALANCED,
    );

    expect(result.teams[0].chemistryModifier).toBe(-6);
    expect(result.teams[1].chemistryModifier).toBe(4);
    expect(result.teams[1].performance).toBeGreaterThan(
      result.teams[0].performance,
    );
  });

  it('applies active set bonus stats and chemistry without mutating base ability', () => {
    const plainTeam = createTeam(13, 'PLAIN', 70);
    const setBonusTeam = createTeam(14, 'SET_BONUS', 70);

    setBonusTeam.activeSetBonuses = [
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
    ];

    const result = service.simulate(
      plainTeam,
      setBonusTeam,
      54,
      TeamStrategy.BALANCED,
    );
    const setBonusResult = result.teams[1];

    expect(setBonusResult.baseAbility).toBe(70);
    expect(setBonusResult.effectiveChemistry).toBe(60);
    expect(setBonusResult.chemistryModifier).toBe(0.8);
    expect(setBonusResult.setBonusModifier).toBe(1.5);
    expect(setBonusResult.activeSetBonuses[0].code).toBe('BOTTOM_DUO');
  });

  it('rewards an ADC archetype that fits the player stat profile', () => {
    const laneBullyTeam = createTeam(15, 'LANE_BULLY_TEAM', 70);
    const hyperCarryTeam = createTeam(16, 'HYPER_CARRY_TEAM', 70);
    const laneBullyAdc = laneBullyTeam.players.find(
      (player) => player.position === Position.ADC,
    )!;
    const hyperCarryAdc = hyperCarryTeam.players.find(
      (player) => player.position === Position.ADC,
    )!;

    Object.assign(laneBullyAdc, { laning: 100, teamFight: 40 });
    Object.assign(hyperCarryAdc, { laning: 100, teamFight: 40 });
    laneBullyAdc.championArchetype = ChampionArchetype.LANE_BULLY;
    hyperCarryAdc.championArchetype = ChampionArchetype.HYPER_CARRY;

    const result = service.simulate(
      laneBullyTeam,
      hyperCarryTeam,
      55,
      TeamStrategy.BALANCED,
    );

    expect(result.teams[0].archetypeModifier).toBeGreaterThan(
      result.teams[1].archetypeModifier,
    );
  });

  it.each([
    [Position.TOP, ChampionArchetype.TOP_SIDE_LANE],
    [Position.JUNGLE, ChampionArchetype.JUNGLE_EARLY_SNOWBALL],
    [Position.MID, ChampionArchetype.MID_STANDING_MAGE],
  ])(
    'applies the configured %s archetype to team performance',
    (position, archetype) => {
      const archetypeTeam = createTeam(17, `${position}_ARCHETYPE`, 70);
      const plainTeam = createTeam(18, `${position}_PLAIN`, 70);
      const player = archetypeTeam.players.find(
        (candidate) => candidate.position === position,
      )!;

      player.championArchetype = archetype;

      const result = service.simulate(
        archetypeTeam,
        plainTeam,
        56,
        TeamStrategy.BALANCED,
      );

      expect(result.teams[0].baseAbility).toBe(70);
      expect(result.teams[0].archetypeModifier).not.toBe(0);
      expect(result.teams[1].archetypeModifier).toBe(0);
    },
  );

  it('rejects a champion archetype assigned to the wrong position', () => {
    const invalidTeam = createTeam(19, 'INVALID_ARCHETYPE', 70);
    const top = invalidTeam.players.find(
      (player) => player.position === Position.TOP,
    )!;

    top.championArchetype = ChampionArchetype.LANE_BULLY;

    expect(() =>
      service.simulate(invalidTeam, teamB, 57, TeamStrategy.BALANCED),
    ).toThrow(RangeError);
  });
});
