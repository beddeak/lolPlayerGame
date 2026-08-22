import { STARTER_POSITIONS } from '../../careers/constants/career.constants';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
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
    const firstResult = service.simulate(teamA, teamB, 12345);
    const secondResult = service.simulate(teamA, teamB, 12345);

    expect(secondResult).toEqual(firstResult);
  });

  it('changes the RNG result when the seed changes', () => {
    const firstResult = service.simulate(teamA, teamB, 1);
    const secondResult = service.simulate(teamA, teamB, 2);

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
      players: Array.from(
        { length: SIMPLE_MATCH_CONFIG.requiredStarterCount },
        (_, index) => ({
          ...variedPlayerStats,
          careerPlayerId: index + 101,
          position: STARTER_POSITIONS[index],
          playerInstruction: null,
          roleProficiency: null,
        }),
      ),
    };

    const result = service.simulate(variedTeam, teamB, 7);

    expect(result.teams[0].baseAbility).toBe(45);
  });

  it('keeps the RNG modifier inside the configured range', () => {
    const result = service.simulate(teamA, teamB, 999);

    for (const teamResult of result.teams) {
      expect(teamResult.rngModifier).toBeGreaterThanOrEqual(
        SIMPLE_MATCH_CONFIG.rngModifierMin,
      );
      expect(teamResult.rngModifier).toBeLessThanOrEqual(
        SIMPLE_MATCH_CONFIG.rngModifierMax,
      );
    }
  });

  it('always lets a vastly stronger team beat the RNG range', () => {
    const strongTeam = createTeam(3, 'STRONG', 100);
    const weakTeam = createTeam(4, 'WEAK', 0);

    const result = service.simulate(strongTeam, weakTeam, 42);

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
      players: topFocusedPlayers,
    };
    const topCarryTeam: SimpleMatchTeamInput = {
      ...balancedTeam,
      teamId: 6,
      teamCode: 'TOP_CARRY_TEAM',
      teamStrategy: TeamStrategy.TOP_CARRY,
    };
    const result = service.simulate(balancedTeam, topCarryTeam, 50);

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

    expect(() => service.simulate(incompleteTeam, teamB, 42)).toThrow(
      RangeError,
    );
  });
});
