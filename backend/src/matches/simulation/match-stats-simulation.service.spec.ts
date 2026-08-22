import { STARTER_POSITIONS } from '../../careers/constants/career.constants';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { MatchStatsSimulationService } from './match-stats-simulation.service';
import { SimpleMatchSimulationService } from './simple-match-simulation.service';
import { SimpleMatchTeamInput } from './simple-match.types';

describe('MatchStatsSimulationService', () => {
  const createTeam = (
    teamId: number,
    teamCode: string,
    ability: number,
  ): SimpleMatchTeamInput => ({
    teamId,
    teamCode,
    teamStrategy: TeamStrategy.BALANCED,
    players: STARTER_POSITIONS.map((position, index) => ({
      careerPlayerId: teamId * 100 + index,
      position,
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
    })),
  });
  const teamA = createTeam(1, 'TEAM_A', 70);
  const teamB = createTeam(2, 'TEAM_B', 70);

  let matchSimulationService: SimpleMatchSimulationService;
  let statsSimulationService: MatchStatsSimulationService;

  beforeEach(() => {
    matchSimulationService = new SimpleMatchSimulationService();
    statsSimulationService = new MatchStatsSimulationService();
  });

  it('reproduces the same player stats with the same seed', () => {
    const matchResult = matchSimulationService.simulate(teamA, teamB, 12345);
    const firstResult = statsSimulationService.simulate(
      teamA,
      teamB,
      matchResult,
      12345,
    );
    const secondResult = statsSimulationService.simulate(
      teamA,
      teamB,
      matchResult,
      12345,
    );

    expect(secondResult).toEqual(firstResult);
  });

  it('keeps team kills and opponent deaths consistent', () => {
    const matchResult = matchSimulationService.simulate(teamA, teamB, 77);
    const result = statsSimulationService.simulate(
      teamA,
      teamB,
      matchResult,
      77,
    );
    const [teamAStats, teamBStats] = result.teams;

    expect(
      teamAStats.playerStats.reduce((total, player) => total + player.kills, 0),
    ).toBe(teamAStats.teamKills);
    expect(
      teamAStats.playerStats.reduce(
        (total, player) => total + player.deaths,
        0,
      ),
    ).toBe(teamBStats.teamKills);
    expect(
      teamBStats.playerStats.reduce(
        (total, player) => total + player.deaths,
        0,
      ),
    ).toBe(teamAStats.teamKills);
  });

  it('calculates damage and gold shares near one hundred percent', () => {
    const matchResult = matchSimulationService.simulate(teamA, teamB, 88);
    const result = statsSimulationService.simulate(
      teamA,
      teamB,
      matchResult,
      88,
    );

    for (const teamResult of result.teams) {
      const damageShare = teamResult.playerStats.reduce(
        (total, player) => total + player.damageShare,
        0,
      );
      const goldShare = teamResult.playerStats.reduce(
        (total, player) => total + player.goldShare,
        0,
      );

      expect(damageShare).toBeCloseTo(100, 2);
      expect(goldShare).toBeCloseTo(100, 2);
    }
  });

  it('makes GD@15 and CSD@15 zero-sum for each position', () => {
    const matchResult = matchSimulationService.simulate(teamA, teamB, 99);
    const result = statsSimulationService.simulate(
      teamA,
      teamB,
      matchResult,
      99,
    );

    for (const position of STARTER_POSITIONS) {
      const teamAPlayer = result.teams[0].playerStats.find(
        (player) => player.position === position,
      )!;
      const teamBPlayer = result.teams[1].playerStats.find(
        (player) => player.position === position,
      )!;

      expect(teamAPlayer.gdAt15 + teamBPlayer.gdAt15).toBe(0);
      expect(teamAPlayer.csdAt15 + teamBPlayer.csdAt15).toBe(0);
    }
  });

  it('keeps KP and Rating inside their display ranges', () => {
    const matchResult = matchSimulationService.simulate(teamA, teamB, 100);
    const result = statsSimulationService.simulate(
      teamA,
      teamB,
      matchResult,
      100,
    );

    for (const player of result.teams.flatMap((team) => team.playerStats)) {
      expect(player.kp).toBeGreaterThanOrEqual(0);
      expect(player.kp).toBeLessThanOrEqual(100);
      expect(player.rating).toBeGreaterThanOrEqual(0);
      expect(player.rating).toBeLessThanOrEqual(10);
    }
  });
});
