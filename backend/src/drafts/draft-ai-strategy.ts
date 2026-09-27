import { createHash } from 'node:crypto';
import { Position } from '../players/enums/position.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { CHAMPIONS, type Champion } from './champion-catalog';
import type { DraftState, DraftTeam } from './draft-state';

export const DRAFT_PLANS = [
  { id: 'TEMPO', label: '초반 압박·스노우볼' },
  { id: 'TEAMFIGHT', label: '이니시·한타' },
  { id: 'SCALING', label: '후반 캐리 보호' },
  { id: 'POKE', label: '포킹·공성' },
  { id: 'PICK', label: '픽오프·교전' },
  { id: 'SPLIT', label: '사이드 운영' },
] as const;
export type DraftPlanId = (typeof DRAFT_PLANS)[number]['id'];
export interface DraftPlan {
  id: DraftPlanId;
  label: string;
  carryPosition: Position;
}

/** No wall clock/global RNG; identity survives BLUE/RED choice and JSON reload. */
export function draftRandom(state: DraftState, teamId: number, key: string) {
  return (
    createHash('sha256')
      .update(
        `${state.aiSeed ?? [state.blue.id, state.red.id].sort((a, b) => a - b).join(':')}:${state.gameNumber}:${teamId}:${key}`,
      )
      .digest()
      .readUInt32BE(0) / 0x1_0000_0000
  );
}
function carryPosition(team: DraftTeam, plan: DraftPlanId): Position {
  if (plan === 'SPLIT' || team.strategy === TeamStrategy.TOP_CARRY)
    return Position.TOP;
  if (team.strategy === TeamStrategy.MID_CARRY) return Position.MID;
  if (team.strategy === TeamStrategy.BOT_CARRY || plan === 'SCALING')
    return Position.ADC;
  return [Position.TOP, Position.MID, Position.ADC].sort((a, b) => {
    const value = (p: Position) => {
      const player = team.players.find((entry) => entry.position === p);
      const stats = player?.abilities;
      return (
        (stats ? stats.mechanics + stats.laning + stats.teamFight : 225) +
        (/CARRY|PRESSURE/.test(player?.instruction ?? '') ? 12 : 0)
      );
    };
    return value(b) - value(a) || a.localeCompare(b);
  })[0];
}
export function describePlan(team: DraftTeam, id: DraftPlanId): DraftPlan {
  return {
    ...DRAFT_PLANS.find((entry) => entry.id === id)!,
    carryPosition: carryPosition(team, id),
  };
}
/** AI rating points only, never changes catalog/combat stats. */
export function planLaneFit(
  c: Champion,
  position: Position,
  plan: DraftPlan,
): number {
  const support = position === Position.SUPPORT,
    jungle = position === Position.JUNGLE;
  const carry = position === plan.carryPosition;
  const v = (value: number) => value - 75;
  switch (plan.id) {
    case 'TEMPO':
      return (
        v(c.early) * 0.28 +
        v(c.lanePower) * 0.1 +
        v(c.engage) * (jungle || support ? 0.1 : 0.025)
      );
    case 'TEAMFIGHT':
      return (
        v(c.teamFight) * 0.18 +
        v(c.engage) * 0.09 +
        v(c.frontline) * (jungle || support ? 0.07 : 0.02)
      );
    case 'SCALING':
      return support
        ? v(c.protection) * 0.27 + v(c.late) * 0.1
        : jungle
          ? v(c.frontline) * 0.11 + v(c.engage) * 0.07 + v(c.late) * 0.1
          : v(c.late) * 0.23 +
            v(c.scaling) * 0.17 +
            v(c.damage) * (carry ? 0.08 : 0.025);
    case 'POKE':
      return support || jungle
        ? v(c.protection) * 0.13 + v(c.engage) * 0.055 + v(c.waveClear) * 0.06
        : v(c.range) * 0.16 +
            v(c.waveClear) * 0.12 +
            v(c.mid) * 0.09 +
            v(c.damage) * 0.06;
    case 'PICK':
      return (
        v(c.engage) * 0.17 +
        v(c.mid) * 0.13 +
        v(c.early) * 0.09 +
        v(c.damage) * (support ? 0.015 : 0.07)
      );
    case 'SPLIT':
      return carry
        ? v(c.damage) * 0.17 +
            v(c.objectiveDamage) * 0.14 +
            v(c.lanePower) * 0.12 +
            v(c.scaling) * 0.1
        : v(c.waveClear) * 0.12 +
            v(c.protection) * (support ? 0.19 : 0.065) +
            v(c.engage) * 0.04;
  }
}
function planWeights(team: DraftTeam): Record<DraftPlanId, number> {
  const weights: Record<DraftPlanId, number> = {
    TEMPO: 1,
    TEAMFIGHT: 1.5,
    SCALING: 1,
    POKE: 1,
    PICK: 1,
    SPLIT: 1,
  };
  if (/PRESSURE|JUNGLE|UPPER/.test(team.strategy)) {
    weights.TEMPO += 3;
    weights.PICK += 1.5;
  }
  if (team.strategy === TeamStrategy.BOT_CARRY) weights.SCALING += 4;
  if (team.strategy === TeamStrategy.TOP_CARRY) weights.SPLIT += 4;
  if (team.strategy === TeamStrategy.MID_CARRY) {
    weights.POKE += 2;
    weights.PICK += 1.5;
  }
  for (const player of team.players) {
    const instruction = player.instruction ?? '';
    if (/SPLIT/.test(instruction)) weights.SPLIT += 2;
    if (/SCALING|HYPER|PROTECT|SAFE_FARM/.test(instruction))
      weights.SCALING += 0.7;
    if (/PRESSURE|GANK/.test(instruction)) weights.TEMPO += 0.7;
    if (/ENGAGE|TEAMFIGHT/.test(instruction)) weights.TEAMFIGHT += 0.7;
    if (/ROAM/.test(instruction)) weights.PICK += 0.7;
    if (player.abilities) {
      weights.TEMPO +=
        Math.max(0, player.abilities.laning - player.abilities.teamFight) / 35;
      weights.TEAMFIGHT +=
        Math.max(0, player.abilities.teamFight - player.abilities.laning) / 35;
    }
  }
  return weights;
}
/** One coherent team/set plan. Ordinary bans do not reroll it; Fearless changes the next set's pool. */
export function getDraftPlan(state: DraftState, teamId: number): DraftPlan {
  const team = [state.blue, state.red].find((entry) => entry.id === teamId);
  if (!team) throw new Error('Unknown draft team');
  const weights = planWeights(team);
  const pool = CHAMPIONS.filter((c) => !state.unavailable.includes(c.id));
  for (const entry of DRAFT_PLANS) {
    const plan = describePlan(team, entry.id);
    // Soft scarcity preference; no hard lane restriction or made-up mastery.
    const supply =
      Object.values(Position).reduce(
        (sum, position) =>
          sum +
          Math.min(
            3,
            pool.filter(
              (c) =>
                c.roleRatings[position] >= 80 &&
                planLaneFit(c, position, plan) >= 0,
            ).length,
          ),
        0,
      ) / 15;
    weights[entry.id] *= 0.35 + 0.65 * supply;
  }
  let cursor =
    draftRandom(state, teamId, 'plan-v1') *
    Object.values(weights).reduce((a, b) => a + b, 0);
  for (const entry of DRAFT_PLANS) {
    cursor -= weights[entry.id];
    if (cursor < 0) return describePlan(team, entry.id);
  }
  return describePlan(team, 'TEAMFIGHT');
}
/** BAN infers public picks, never reads the opponent's private sampled plan. */
export function inferDraftPlan(
  team: DraftTeam,
  picks: Champion[],
): DraftPlan | null {
  if (picks.length < 2) return null;
  const weights = planWeights(team);
  return DRAFT_PLANS.map((entry) => {
    const plan = describePlan(team, entry.id);
    return {
      plan,
      score:
        picks.reduce(
          (sum, c) =>
            sum +
            Math.max(
              ...c.recommendedPositions.map((p) => planLaneFit(c, p, plan)),
            ),
          0,
        ) /
          picks.length +
        Math.log(weights[entry.id]),
    };
  }).sort((a, b) => b.score - a.score || a.plan.id.localeCompare(b.plan.id))[0]
    .plan;
}
