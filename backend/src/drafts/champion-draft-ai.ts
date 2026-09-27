import { Position } from '../players/enums/position.enum';
import { CHAMPIONS, CHAMPIONS_BY_ID, type Champion } from './champion-catalog';
import {
  bestChampionAssignment,
  championCounter,
  compositionValue,
} from './champion-balance';
import {
  draftTurns,
  type DraftState,
  type DraftSide,
  type DraftTeam,
  type SelectionChoice,
} from './draft-state';
import {
  draftRandom,
  getDraftPlan,
  inferDraftPlan,
  planLaneFit,
  type DraftPlan,
} from './draft-ai-strategy';
export { getDraftPlan } from './draft-ai-strategy';

const positions = Object.values(Position);
const picked = (state: DraftState, side: DraftSide) =>
  state.actions
    .filter((action) => action.kind === 'PICK' && action.side === side)
    .map((action) => CHAMPIONS_BY_ID.get(action.variantId)!);
const teamFor = (state: DraftState, side: DraftSide) =>
  side === 'BLUE' ? state.blue : state.red;
const opposite = (side: DraftSide): DraftSide =>
  side === 'BLUE' ? 'RED' : 'BLUE';
const mean = (
  picks: Champion[],
  key: 'range' | 'frontline' | 'engage' | 'protection',
) =>
  picks.length ? picks.reduce((sum, c) => sum + c[key], 0) / picks.length : 0;

function responseValue(
  c: Champion,
  enemy: Champion[],
  position: Position,
): number {
  if (!enemy.length) return 0;
  const certainty = Math.min(1, enemy.length / 3);
  const engage = Math.max(0, mean(enemy, 'engage') - 60) / 40;
  const tanks = Math.max(0, mean(enemy, 'frontline') - 50) / 50;
  const ranged = Math.max(0, mean(enemy, 'range') - 45) / 55;
  const support = position === Position.SUPPORT;
  const frontliner = position === Position.TOP || position === Position.JUNGLE;
  // Existing profile fields only; not invented champion abilities/mastery.
  return (
    certainty *
    (engage *
      ((c.protection - 60) * (support ? 0.1 : 0.065) +
        (frontliner ? (c.frontline - 50) * 0.025 : 0)) +
      // Damage lanes answer tanks; the support can protect those damage dealers.
      tanks *
        ((c.damage - 70) * 0.09 + (c.scaling - 70) * 0.04) *
        (support ? 0.15 : 1) +
      ranged * (c.engage - 60) * 0.075)
  );
}
function assignmentScorer(
  team: DraftTeam,
  enemy: Champion[],
  plan: DraftPlan | null,
) {
  const cache = new Map<string, number>();
  return (c: Champion, position: Position) => {
    const key = `${c.id}:${position}`,
      prior = cache.get(key);
    if (prior !== undefined) return prior;
    // Soft specialization cost, never a legality filter. Manual flex remains free.
    const specialization = c.recommendedPositions.includes(position) ? 0 : -5;
    const instruction =
      team.players.find((p) => p.position === position)?.instruction ?? '';
    const instructionFit =
      (/PRESSURE|GANK/.test(instruction) ? (c.early - 75) * 0.08 : 0) +
      (/CARRY|SCALING/.test(instruction)
        ? (c.damage + c.scaling - 150) * 0.04
        : 0) +
      (/PROTECT|WEAK_SIDE/.test(instruction) ? (c.protection - 65) * 0.04 : 0);
    // Enemy flex lanes are uncertain, especially early. No access to future assignments.
    const opponents = enemy.filter((other) =>
      other.recommendedPositions.includes(position),
    );
    const matchup = opponents.length
      ? (opponents.reduce((sum, other) => sum + championCounter(c, other), 0) /
          opponents.length) *
        Math.min(1, enemy.length / 4)
      : 0;
    const score =
      (plan ? planLaneFit(c, position, plan) : 0) +
      specialization +
      instructionFit +
      matchup +
      responseValue(c, enemy, position);
    cache.set(key, score);
    return score;
  };
}
/** Same acquisition plan in auto-assignment. The user's manual confirmation may override. */
export function chooseChampionAssignment(state: DraftState, side: DraftSide) {
  const team = teamFor(state, side);
  return bestChampionAssignment(
    picked(state, side),
    team,
    {},
    assignmentScorer(
      team,
      picked(state, opposite(side)),
      getDraftPlan(state, team.id),
    ),
  ).lineup;
}
export interface RankedChampionChoice {
  champion: Champion;
  score: number;
  reasons: string[];
  position: Position;
}
function evaluatePicks(
  state: DraftState,
  side: DraftSide,
  candidates: Champion[],
  plan: DraftPlan | null,
): RankedChampionChoice[] {
  const own = picked(state, side),
    enemy = picked(state, opposite(side));
  const team = teamFor(state, side),
    adjust = assignmentScorer(team, enemy, plan);
  const base = bestChampionAssignment(own, team, {}, adjust).score;
  const baseComposition = compositionValue(own);
  return candidates.map((champion) => {
    const group = [...own, champion];
    const assigned = bestChampionAssignment(group, team, {}, adjust);
    const position = positions.find((p) => assigned.lineup[p] === champion.id)!;
    const composition =
      (compositionValue(group) - baseComposition) * (1.8 + own.length * 0.35);
    const flex =
      Math.max(0, 2 - own.length) *
      Math.max(0, champion.recommendedPositions.length - 1) *
      0.45;
    const response = responseValue(champion, enemy, position);
    const reasons = [
      plan ? plan.label : '공개 선수·전술에 맞는 우선 픽',
      `${position} 배치 적합도`,
    ];
    if (composition > 0.5) reasons.push('부족한 조합 역할 보완');
    if (flex > 0) reasons.push('초반 멀티 포지션 선택지 확보');
    if (response > 0.6) reasons.push('드러난 상대 조합 대응');
    return {
      champion,
      position,
      score: assigned.score - base + composition + flex,
      reasons,
    };
  });
}
/** Diagnostics are pure; per-call cached scoring and bounded 32-mask assignment, no full tree search. */
export function rankChampionChoices(
  state: DraftState,
  side: DraftSide,
  kind: 'PICK' | 'BAN',
  candidates: Champion[],
): RankedChampionChoice[] {
  const blocked = new Set([
    ...state.unavailable,
    ...state.actions.map((a) => a.variantId),
  ]);
  const legal = [
    ...new Map(
      candidates.filter((c) => !blocked.has(c.id)).map((c) => [c.id, c]),
    ).values(),
  ];
  if (!legal.length) return [];
  const team = teamFor(state, side);
  let ranked: RankedChampionChoice[];
  if (kind === 'PICK')
    ranked = evaluatePicks(state, side, legal, getDraftPlan(state, team.id));
  else {
    const target = opposite(side),
      enemy = teamFor(state, target);
    const threats = evaluatePicks(
      state,
      target,
      legal,
      inferDraftPlan(enemy, picked(state, target)),
    );
    const own = evaluatePicks(state, side, legal, getDraftPlan(state, team.id));
    const ownScores = new Map(own.map((row) => [row.champion.id, row.score]));
    const ownBest = Math.max(...own.map((row) => row.score));
    const nextPick = draftTurns(state)
      .slice(state.actions.length)
      .find((turn) => turn.kind === 'PICK');
    const replacements = new Map(
      positions.map((position) => [
        position,
        threats
          .filter((row) => row.position === position)
          .map((row) => row.score)
          .sort((a, b) => b - a),
      ]),
    );
    ranked = threats.map((row) => {
      const alternatives = replacements.get(row.position)!;
      const fallback =
        alternatives[Math.min(4, alternatives.length - 1)] ?? row.score;
      const replacementCount = Math.max(0, alternatives.length - 1);
      const scarcity = Math.min(
        8,
        Math.max(0, Math.min(8, row.score - fallback)) * 0.85 +
          Math.max(0, 3 - replacementCount) * 1.2,
      );
      const reservation =
        nextPick?.side === side
          ? Math.max(0, (ownScores.get(row.champion.id) ?? 0) - ownBest + 6) *
            1.3
          : 0;
      return {
        ...row,
        score: row.score + scarcity - reservation,
        reasons: [
          '상대 공개 픽·조합 완성 방해',
          ...row.reasons,
          ...(scarcity > 1 ? ['대체재가 적은 상대 포지션 공략'] : []),
          ...(reservation > 0 ? ['우리 선픽 후보를 밴하는 비용 반영'] : []),
        ],
      };
    });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || a.champion.id.localeCompare(b.champion.id),
  );
}
export function chooseChampion(
  state: DraftState,
  side: DraftSide,
  kind: 'PICK' | 'BAN',
  candidates: Champion[],
) {
  const evaluated = rankChampionChoices(state, side, kind, candidates);
  const best = evaluated[0]?.score;
  if (best === undefined) throw new Error('No legal champion remains');
  const team = teamFor(state, side);
  // Variation breaks close ties inside one plan, not a new strategy every turn.
  return evaluated
    .filter((row) => row.score >= best - 3.5)
    .slice(0, 8)
    .map((row) => ({
      ...row,
      selection:
        row.score +
        draftRandom(
          state,
          team.id,
          `${state.actions.length}:${kind}:${row.champion.id}`,
        ) *
          3.5,
    }))
    .sort(
      (a, b) =>
        b.selection - a.selection || a.champion.id.localeCompare(b.champion.id),
    )[0].champion;
}
export function chooseChampionSelection(
  state: DraftState,
  teamId: number,
  options: SelectionChoice[],
): SelectionChoice {
  if (!options.length) throw new Error('No legal selection remains');
  const side: DraftSide = state.blue.id === teamId ? 'BLUE' : 'RED';
  const plan = getDraftPlan(state, teamId);
  const remaining = CHAMPIONS.filter((c) => !state.unavailable.includes(c.id));
  const ranked = evaluatePicks(state, side, remaining, plan).sort(
    (a, b) => b.score - a.score,
  );
  const scarcity = Math.min(
    4,
    (ranked[0]?.score ?? 0) - (ranked[8]?.score ?? 0),
  );
  const priority = ['TEMPO', 'SCALING', 'TEAMFIGHT'].includes(plan.id);
  const scores: Record<SelectionChoice, number> = {
    FIRST_PICK: 1.5 + scarcity * 0.35 + (priority ? 1.3 : 0),
    SECOND_PICK: 1.5 + (priority ? 0 : 1.6),
    // There is no modeled map-side advantage, so don't invent one.
    BLUE: 1,
    RED: 1,
  };
  return [...options]
    .map((choice) => ({
      choice,
      score:
        scores[choice] + draftRandom(state, teamId, `selection:${choice}`) * 3,
    }))
    .sort((a, b) => b.score - a.score || a.choice.localeCompare(b.choice))[0]
    .choice;
}
