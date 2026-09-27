import { Position } from '../players/enums/position.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import type { Champion } from './champion-catalog';
import type { DraftPlayer, DraftTeam } from './draft-state';

const bounded = (n: number, limit: number) =>
  Math.max(-limit, Math.min(limit, n));
export function championLaneValue(
  c: Champion,
  position: Position,
  strategy: TeamStrategy,
  player?: DraftPlayer,
) {
  const early = /PRESSURE|UPPER|TOP_JUNGLE|MID_JUNGLE/.test(strategy);
  const carry =
    (strategy === TeamStrategy.BOT_CARRY && position === Position.ADC) ||
    (strategy === TeamStrategy.MID_CARRY && position === Position.MID) ||
    (strategy === TeamStrategy.TOP_CARRY && position === Position.TOP);
  const curve =
    c.early * (early ? 0.45 : 0.25) +
    c.mid * 0.3 +
    c.late * (early ? 0.25 : 0.45);
  const stats = player?.abilities;
  // Neutral baseline when stats are absent in old saved snapshots. Never invent mastery.
  const fit = stats
    ? (((stats.mechanics - 75) * c.difficulty) / 10 +
        ((stats.laning - 75) * c.lanePower) / 100 +
        ((stats.teamFight - 75) * c.teamFight) / 100) *
      0.09
    : 0;
  return (
    curve * 0.42 +
    c.roleRatings[position] * 0.4 +
    (carry
      ? c.scaling
      : position === Position.SUPPORT
        ? c.protection
        : c.teamFight) *
      0.18 +
    fit
  );
}

export function championCounter(c: Champion, enemy: Champion) {
  return bounded(
    (c.lanePower - enemy.lanePower) * 0.035 +
      (c.range - enemy.range) * 0.012 +
      (c.engage * enemy.range - enemy.engage * c.range) * 0.00016 +
      (c.early - enemy.early) * 0.02,
    4,
  );
}

export function compositionValue(champions: Champion[]) {
  if (!champions.length) return 0;
  const n = champions.length;
  const sum = (
    key: 'frontline' | 'engage' | 'protection' | 'magicShare' | 'scaling',
  ) => champions.reduce((s, c) => s + c[key], 0);
  const frontline = Math.min(sum('frontline') / (n * 37), 1);
  const engage = Math.min(sum('engage') / (n * 50), 1);
  const protection = Math.min(sum('protection') / (n * 38), 1);
  const mixed = 1 - Math.min(1, Math.abs(sum('magicShare') / n - 50) / 40);
  const scaling = Math.min(sum('scaling') / (n * 83), 1);
  // Evaluate actual output, never ban a composition merely for its lane/tag.
  // Partial drafts receive proportional penalties so AI can build a comp.
  const strongest = (
    key: 'damage' | 'waveClear' | 'objectiveDamage',
    count: number,
  ) => {
    const values = champions
      .map((c) => c[key])
      .sort((a, b) => b - a)
      .slice(0, count);
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  const damage = strongest('damage', 2);
  const outputPenalty =
    (Math.max(0, 72 - damage) * 0.38 +
      Math.max(0, 64 - strongest('waveClear', 3)) * 0.18 +
      Math.max(0, 60 - strongest('objectiveDamage', 2)) * 0.2) *
    (n / 5);
  return (
    frontline * 2 +
    engage * 1.3 +
    protection * 1.2 * Math.min(1, damage / 80) +
    mixed * 1.5 +
    scaling -
    5 -
    outputPenalty
  );
}

export type ChampionLineup = Record<Position, string>;
// Maximum-weight matching, at most five picks and 32 position masks.
export function bestChampionAssignment(
  picks: Champion[],
  team: DraftTeam,
  enemies: Partial<Record<Position, Champion>> = {},
  scoreAdjustment?: (champion: Champion, position: Position) => number,
) {
  const positions = Object.values(Position);
  let states = new Map<
    number,
    { score: number; lineup: Partial<ChampionLineup> }
  >([[0, { score: 0, lineup: {} }]]);
  for (const pick of picks) {
    const scores = positions.map(
      (position) =>
        championLaneValue(
          pick,
          position,
          team.strategy,
          team.players.find((p) => p.position === position),
        ) +
        (enemies[position] ? championCounter(pick, enemies[position]) : 0) +
        (scoreAdjustment?.(pick, position) ?? 0),
    );
    const next = new Map<
      number,
      { score: number; lineup: Partial<ChampionLineup> }
    >();
    for (const [mask, prev] of states)
      positions.forEach((position, index) => {
        if (mask & (1 << index)) return;
        const score = prev.score + scores[index];
        const nextMask = mask | (1 << index);
        if (!next.has(nextMask) || next.get(nextMask)!.score < score)
          next.set(nextMask, {
            score,
            lineup: { ...prev.lineup, [position]: pick.id },
          });
      });
    states = next;
  }
  return (
    [...states.values()].sort((a, b) => b.score - a.score)[0] ?? {
      score: 0,
      lineup: {},
    }
  );
}

export function championMatchModifier(
  c: Champion,
  enemy: Champion,
  position: Position,
  strategy: TeamStrategy,
  own: Champion[],
  opposing: Champion[],
) {
  const ownComposition = compositionValue(own);
  // Strong players cannot erase a missing damage source, farming/jungle role,
  // or objective threat with a small flat bonus. Flex picks remain legal.
  const rolePenalty = Math.max(0, 80 - c.roleRatings[position]) * 0.26;
  const modifier =
    (championLaneValue(c, position, strategy) - 78) * 0.2 +
    championCounter(c, enemy) +
    bounded(ownComposition - compositionValue(opposing), 6) * 0.8 +
    Math.min(0, ownComposition) * 0.9 -
    rolePenalty;
  return Math.max(-32, Math.min(10, modifier));
}
