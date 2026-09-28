import { STARTER_POSITIONS } from '../../careers/constants/career.constants';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { MatchStatsSimulationService } from './match-stats-simulation.service';
import { SimpleMatchSimulationService } from './simple-match-simulation.service';
import { SimpleMatchTeamInput } from './simple-match.types';
import { DraftState, DraftTeam } from '../../drafts/draft-state';
import { applyVariantDraft } from '../../drafts/variant-match';
import { Position } from '../../players/enums/position.enum';
import { selectPlayerOfGame, selectPlayerOfMatch } from '../match-awards';

function requireAt15(value: number | null): number {
  if (value === null)
    throw new Error(
      'Legacy fixtures lasting at least 25 minutes require a 15-minute measurement',
    );
  return value;
}

describe('MatchStatsSimulationService', () => {
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
    players: STARTER_POSITIONS.map((position, index) => ({
      careerPlayerId: teamId * 100 + index,
      position,
      playerInstruction: null,
      roleProficiency: null,
      positionProficiency: 100,
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
    const matchResult = matchSimulationService.simulate(
      teamA,
      teamB,
      12345,
      TeamStrategy.BALANCED,
    );
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
    const matchResult = matchSimulationService.simulate(
      teamA,
      teamB,
      77,
      TeamStrategy.BALANCED,
    );
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

  it('off-position adaptation lowers lane performance and damage without changing base stats', () => {
    const adapted = createTeam(1, 'ADAPTED', 90);
    const novice = structuredClone(adapted);
    novice.players[0].positionProficiency = 20;
    const snapshot = structuredClone(novice);
    const match = matchSimulationService.simulate(
      adapted,
      teamB,
      77,
      TeamStrategy.BALANCED,
    );
    const normal = statsSimulationService.simulate(adapted, teamB, match, 77)
      .teams[0].playerStats[0];
    const offRole = statsSimulationService.simulate(novice, teamB, match, 77)
      .teams[0].playerStats[0];
    expect(offRole.dpm).toBeLessThan(normal.dpm);
    expect(offRole.gdAt15).toBeLessThan(requireAt15(normal.gdAt15));
    expect(offRole.csdAt15).toBeLessThan(requireAt15(normal.csdAt15));
    expect(novice).toEqual(snapshot);
    novice.players[0].positionProficiency = 100;
    expect(
      statsSimulationService.simulate(novice, teamB, match, 77).teams[0]
        .playerStats[0],
    ).toEqual(normal);
  });

  it('carries real champion swaps into personal metrics with the same seed and winner', () => {
    const strong = createTeam(1, 'TEAM_A', 90);
    const weak = createTeam(2, 'TEAM_B', 60);
    const toDraftTeam = (team: SimpleMatchTeamInput): DraftTeam => ({
      id: team.teamId,
      code: team.teamCode,
      strategy: team.teamStrategy,
      players: team.players.map((player) => ({
        id: player.careerPlayerId,
        nickname: String(player.careerPlayerId),
        position: player.position,
        instruction: null,
        roleProficiency: null,
        typeProficiencies: {},
      })),
    });
    const draft: DraftState = {
      version: 3,
      blue: toDraftTeam(strong),
      red: toDraftTeam(weak),
      managedTeamId: 1,
      gameNumber: 1,
      fearless: true,
      unavailable: [],
      actions: [],
      deadline: null,
      completed: true,
      assignmentsConfirmed: true,
      assignments: {
        BLUE: {
          TOP: 'Ornn',
          JUNGLE: 'LeeSin',
          MID: 'Ahri',
          ADC: 'Jinx',
          SUPPORT: 'Lulu',
        },
        RED: {
          TOP: 'Garen',
          JUNGLE: 'Vi',
          MID: 'Vex',
          ADC: 'Caitlyn',
          SUPPORT: 'Leona',
        },
      },
    };
    const swapped = structuredClone(draft);
    swapped.assignments!.BLUE.ADC = 'Lulu';
    swapped.assignments!.BLUE.SUPPORT = 'Jinx';
    const snapshot = structuredClone(strong);
    const play = (state: DraftState) => {
      const a = applyVariantDraft(strong, state);
      const b = applyVariantDraft(weak, state);
      const match = matchSimulationService.simulate(
        a,
        b,
        123,
        TeamStrategy.BALANCED,
      );
      return {
        ...statsSimulationService.simulate(a, b, match, 123),
        winnerTeamId: match.winnerTeamId,
      };
    };
    const normal = play(draft);
    const offRole = play(swapped);
    expect(normal.winnerTeamId).toBe(1);
    expect(offRole.winnerTeamId).toBe(normal.winnerTeamId);
    expect(play(swapped)).toEqual(offRole);
    for (const position of [Position.ADC, Position.SUPPORT]) {
      const before = normal.teams[0].playerStats.find(
        (p) => p.position === position,
      )!;
      const after = offRole.teams[0].playerStats.find(
        (p) => p.position === position,
      )!;
      expect(after.dpm).toBeLessThan(before.dpm);
      expect(after.gold).toBeLessThan(before.gold);
      expect(after.gdAt15).toBeLessThan(requireAt15(before.gdAt15));
      expect(after.csdAt15).toBeLessThan(requireAt15(before.csdAt15));
      expect(after.rating).not.toBe(before.rating);
      expect(after.mental).toBe(before.mental);
      const opponent = offRole.teams[1].playerStats.find(
        (p) => p.position === position,
      )!;
      expect(requireAt15(after.gdAt15) + requireAt15(opponent.gdAt15)).toBe(0);
      expect(requireAt15(after.csdAt15) + requireAt15(opponent.csdAt15)).toBe(
        0,
      );
    }
    expect(strong).toEqual(snapshot);
    const pog = selectPlayerOfGame(offRole)!;
    expect(pog.teamId).toBe(offRole.winnerTeamId);
    expect(pog.rating).toBe(
      Math.max(...offRole.teams[0].playerStats.map((p) => p.rating)),
    );
    const pom = selectPlayerOfMatch([normal, offRole], 1)!;
    const winningPlayerStats = [normal, offRole].map((game) =>
      game.teams[0].playerStats.find(
        (p) => p.careerPlayerId === pom.careerPlayerId,
      )!,
    );
    expect(pom.totalRating).toBeCloseTo(
      winningPlayerStats.reduce((sum, p) => sum + p.rating, 0),
      3,
    );
  });

  it('uses draft strength for KDA allocation without breaking kill/death totals', () => {
    const run = (modifier: number) => {
      const team = structuredClone(teamA);
      team.players[0].variantModifier = modifier;
      const match = matchSimulationService.simulate(
        teamA,
        teamB,
        123,
        TeamStrategy.BALANCED,
      );
      return statsSimulationService.simulate(team, teamB, match, 123);
    };
    const worse = run(-8);
    const better = run(8);
    const first = worse.teams[0].playerStats[0];
    const second = better.teams[0].playerStats[0];
    expect(second.kills).toBeGreaterThanOrEqual(first.kills);
    expect(second.deaths).toBeLessThanOrEqual(first.deaths);
    expect(second.kda).toBeGreaterThan(first.kda);
    for (const result of [worse, better]) {
      for (const [index, team] of result.teams.entries()) {
        expect(team.playerStats.reduce((sum, p) => sum + p.kills, 0)).toBe(
          team.teamKills,
        );
        expect(team.playerStats.reduce((sum, p) => sum + p.deaths, 0)).toBe(
          result.teams[1 - index].teamKills,
        );
      }
    }
  });

  it('preserves no-draft results when the optional modifier is absent or zero', () => {
    const zero = structuredClone(teamA);
    zero.players.forEach((p) => {
      p.variantModifier = 0;
    });
    const match = matchSimulationService.simulate(
      teamA,
      teamB,
      99,
      TeamStrategy.BALANCED,
    );
    expect(statsSimulationService.simulate(zero, teamB, match, 99)).toEqual(
      statsSimulationService.simulate(teamA, teamB, match, 99),
    );
  });

  it.each([0, 119])(
    'bounds effective stats with draft modifiers at base ability %i',
    (ability) => {
      const team = createTeam(1, 'TEAM_A', ability);
      team.players.forEach((p, i) => {
        p.variantModifier = i % 2 ? -32 : 10;
      });
      const snapshot = structuredClone(team);
      const match = matchSimulationService.simulate(
        team,
        teamB,
        123,
        TeamStrategy.BALANCED,
      );
      const result = statsSimulationService.simulate(team, teamB, match, 123);
      for (const player of result.teams[0].playerStats) {
        expect(Number.isFinite(player.dpm)).toBe(true);
        expect(player.dpm).toBeGreaterThanOrEqual(0);
        expect(player.deaths).toBeGreaterThanOrEqual(0);
        expect(player.rating).toBeGreaterThanOrEqual(0);
        expect(player.rating).toBeLessThanOrEqual(10);
      }
      expect(team).toEqual(snapshot);
    },
  );

  it('calculates damage and gold shares near one hundred percent', () => {
    const matchResult = matchSimulationService.simulate(
      teamA,
      teamB,
      88,
      TeamStrategy.BALANCED,
    );
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
    const matchResult = matchSimulationService.simulate(
      teamA,
      teamB,
      99,
      TeamStrategy.BALANCED,
    );
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

      expect(
        requireAt15(teamAPlayer.gdAt15) + requireAt15(teamBPlayer.gdAt15),
      ).toBe(0);
      expect(
        requireAt15(teamAPlayer.csdAt15) + requireAt15(teamBPlayer.csdAt15),
      ).toBe(0);
    }
  });

  it('keeps KP and Rating inside their display ranges', () => {
    const matchResult = matchSimulationService.simulate(
      teamA,
      teamB,
      100,
      TeamStrategy.BALANCED,
    );
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

  it('uses abilities above 100 in damage, gold and lane stats', () => {
    const capped = createTeam(1, 'TEAM_A', 100);
    const elite = createTeam(1, 'TEAM_A', 119);
    for (const player of [...capped.players, ...elite.players]) {
      player.mental = 50;
    }
    const matchResult = matchSimulationService.simulate(
      capped,
      teamB,
      123,
      TeamStrategy.BALANCED,
    );
    const baseline = statsSimulationService.simulate(
      capped,
      teamB,
      matchResult,
      123,
    );
    const improved = statsSimulationService.simulate(
      elite,
      teamB,
      matchResult,
      123,
    );

    for (let index = 0; index < capped.players.length; index++) {
      const before = baseline.teams[0].playerStats[index];
      const after = improved.teams[0].playerStats[index];
      expect(after.dpm - before.dpm).toBeCloseTo(19 * 5);
      expect(after.gold).toBeGreaterThan(before.gold);
      expect(
        requireAt15(after.gdAt15) - requireAt15(before.gdAt15),
      ).toBeCloseTo(19 * 20);
    }
  });

  it('caps positive state boosts to effective ability 119', () => {
    const elite = createTeam(1, 'TEAM_A', 119);
    const boosted = {
      ...elite,
      players: elite.players.map((player) => ({ ...player, form: 100 })),
    };
    const matchResult = matchSimulationService.simulate(
      elite,
      teamB,
      123,
      TeamStrategy.BALANCED,
    );
    const baseline = statsSimulationService.simulate(
      elite,
      teamB,
      matchResult,
      123,
    );
    const result = statsSimulationService.simulate(
      boosted,
      teamB,
      matchResult,
      123,
    );
    for (let index = 0; index < elite.players.length; index++) {
      expect(result.teams[0].playerStats[index].dpm).toBe(
        baseline.teams[0].playerStats[index].dpm,
      );
      expect(result.teams[0].playerStats[index].gold).toBe(
        baseline.teams[0].playerStats[index].gold,
      );
    }
  });

  it.each([1, 77, 12345])(
    'keeps mixed 100..119 Mental death allocation nonnegative for seed %i',
    (seed) => {
      const elite = createTeam(1, 'TEAM_A', 119);
      elite.players.forEach((player, index) => {
        player.mental = [119, 118, 110, 100, 80][index];
      });
      const matchResult = matchSimulationService.simulate(
        elite,
        teamB,
        seed,
        TeamStrategy.BALANCED,
      );
      const result = statsSimulationService.simulate(
        elite,
        teamB,
        matchResult,
        seed,
      );
      expect(
        result.teams[0].playerStats.reduce(
          (sum, player) => sum + player.deaths,
          0,
        ),
      ).toBe(result.teams[1].teamKills);
      for (const player of result.teams[0].playerStats) {
        expect(Number.isInteger(player.deaths)).toBe(true);
        expect(player.deaths).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it('snapshots state modifiers and calculates the next match state', () => {
    const matchResult = matchSimulationService.simulate(
      teamA,
      teamB,
      101,
      TeamStrategy.BALANCED,
    );
    const result = statsSimulationService.simulate(
      teamA,
      teamB,
      matchResult,
      101,
    );

    for (const teamResult of result.teams) {
      const won = teamResult.teamId === matchResult.winnerTeamId;

      for (const player of teamResult.playerStats) {
        expect(player).toEqual(
          expect.objectContaining({
            form: 50,
            condition: 100,
            mental: 70,
            formModifier: 0,
            conditionModifier: 0,
            mentalModifier: 1.6,
            stateModifier: 1.6,
          }),
        );
        expect(player.conditionAfter).toBeLessThan(player.condition);
        expect(player.formAfter).toBeGreaterThanOrEqual(0);
        expect(player.formAfter).toBeLessThanOrEqual(100);
        if (won) {
          expect(player.mentalAfter).toBeGreaterThanOrEqual(player.mental);
          expect(player.mentalAfter).toBeLessThanOrEqual(player.mental + 2);
        } else {
          expect(player.mentalAfter).toBeLessThanOrEqual(player.mental);
          expect(player.mentalAfter).toBeGreaterThanOrEqual(player.mental - 2);
        }
      }
    }
  });
});
