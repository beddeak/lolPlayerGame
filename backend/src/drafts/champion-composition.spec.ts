import { Position } from '../players/enums/position.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { CHAMPIONS_BY_ID } from './champion-catalog';
import { compositionValue, championMatchModifier } from './champion-balance';
import { applyVariantDraft } from './variant-match';
import type { DraftState } from './draft-state';
import type { SimpleMatchTeamInput } from '../matches/simulation/simple-match.types';
import { SimpleMatchSimulationService } from '../matches/simulation/simple-match-simulation.service';

const positions = Object.values(Position);
const balanced = ['Ornn', 'LeeSin', 'Ahri', 'Jinx', 'Lulu'];
const opposing = ['Malphite', 'XinZhao', 'Orianna', 'Caitlyn', 'Nami'];
const enchanters = ['Janna', 'Yuumi', 'Soraka', 'Milio', 'Taric'];
const engageSupports = ['Alistar', 'Leona', 'Braum', 'Rell', 'Nautilus'];
const marksmen = ['Vayne', 'Ashe', 'Draven', 'Jhin', 'Ezreal'];
const champions = (ids: string[]) => ids.map((id) => CHAMPIONS_BY_ID.get(id)!);
const input = (teamId: number, ability: number): SimpleMatchTeamInput => ({
  teamId,
  teamCode: `T${teamId}`,
  teamStrategy: TeamStrategy.BALANCED,
  strategyProficiency: 50,
  chemistry: 50,
  activeSetBonuses: [],
  players: positions.map((position, i) => ({
    careerPlayerId: teamId * 10 + i,
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
const draft = (ids: string[]) =>
  ({
    version: 3,
    blue: { id: 1 },
    red: { id: 2 },
    completed: true,
    assignmentsConfirmed: true,
    assignments: {
      BLUE: Object.fromEntries(positions.map((p, i) => [p, ids[i]])),
      RED: Object.fromEntries(positions.map((p, i) => [p, opposing[i]])),
    },
  }) as DraftState;
const winRate = (ids: string[], ability = 85) => {
  const state = draft(ids);
  const a = applyVariantDraft(input(1, ability), state);
  const b = applyVariantDraft(input(2, 85), state);
  const simulation = new SimpleMatchSimulationService();
  let wins = 0;
  for (let seed = 1; seed <= 512; seed++) {
    const result = simulation.simulate(
      a,
      b,
      Math.imul(seed, 2654435761) >>> 0,
      TeamStrategy.BALANCED,
    );
    if (result.winnerTeamId === 1) wins++;
    for (const team of result.teams)
      expect(Number.isFinite(team.performance)).toBe(true);
  }
  return wins / 512;
};

describe('champion composition viability through the real winner pipeline', () => {
  it('exposes missing damage, wave clear and objective threat instead of rewarding five protectors', () => {
    expect(compositionValue(champions(enchanters))).toBeLessThan(-15);
    expect(compositionValue(champions(engageSupports))).toBeLessThan(-12);
    expect(compositionValue(champions(balanced))).toBeGreaterThan(-2);
    // These are often support picks, but do supply damage and farming capability.
    expect(
      compositionValue(
        champions(['Swain', 'Zyra', 'Lux', 'Seraphine', 'Brand']),
      ),
    ).toBeGreaterThan(-5);
    expect(compositionValue([])).toBe(0);
  });
  it('makes five low-output supports lose against a functional equal-strength team, even with a 15-stat advantage', () => {
    const rates = {
      balanced: winRate(balanced),
      enchanters: winRate(enchanters),
      engageSupports: winRate(engageSupports),
      strongerSupports: winRate(enchanters, 100),
      marksmen: winRate(marksmen),
    };
    process.stdout.write(
      `512 seeded games per composition: ${JSON.stringify(rates)}\n`,
    );
    expect(rates.balanced).toBeGreaterThan(0.15);
    expect(rates.balanced).toBeLessThan(0.85);
    expect(rates.enchanters).toBeLessThan(0.05);
    expect(rates.engageSupports).toBeLessThan(0.05);
    expect(rates.strongerSupports).toBeLessThan(0.2);
    expect(rates.marksmen).toBeLessThan(rates.balanced);
  });
  it('preserves viable off-meta positions and strong-player advantage for functional teams', () => {
    const own = champions(balanced),
      enemy = champions(opposing);
    const modifier = (id: string, p: Position) =>
      championMatchModifier(
        CHAMPIONS_BY_ID.get(id)!,
        CHAMPIONS_BY_ID.get('Orianna')!,
        p,
        TeamStrategy.BALANCED,
        own,
        enemy,
      );
    expect(modifier('Seraphine', Position.ADC)).toBeGreaterThan(-5);
    expect(modifier('Vayne', Position.TOP)).toBeGreaterThan(-5);
    expect(modifier('Yuumi', Position.JUNGLE)).toBeLessThan(-10);
    expect(winRate(balanced, 95)).toBeGreaterThan(winRate(balanced));
  });
  it('changes only transient match modifiers, not the saved abilities', () => {
    const team = input(1, 95),
      original = structuredClone(team);
    const result = applyVariantDraft(team, draft(enchanters));
    expect(team).toEqual(original);
    expect(result.players.every((p) => p.mechanics === 95)).toBe(true);
    expect(result.players.every((p) => p.variantModifier! < -10)).toBe(true);
  });
});
