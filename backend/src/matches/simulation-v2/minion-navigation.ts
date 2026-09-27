import type { EngineState, MapDefinition, Point, UnitState } from './contracts';
import { environmentTargetable } from './environment';
import { distance, findPath, hasLineOfSight } from './map-paths';

/** MODEL: existing shared minion vision radius; acquisition is not attack range. */
export const MINION_ACQUIRE_RADIUS = 650;

function resumeLane(map: MapDefinition, unit: UnitState): Point[] {
  if (!unit.side || !unit.lane) return unit.path.map((point) => ({ ...point }));
  const route =
    unit.side === 'BLUE'
      ? map.lanes[unit.lane]
      : [...map.lanes[unit.lane]].reverse();
  let best = { index: 1, distance: Infinity };
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1];
    const to = route[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const ratio = Math.max(
      0,
      Math.min(
        1,
        ((unit.position.x - from.x) * dx + (unit.position.y - from.y) * dy) /
          (dx * dx + dy * dy),
      ),
    );
    const separation = distance(unit.position, {
      x: from.x + dx * ratio,
      y: from.y + dy * ratio,
    });
    // At a shared corner choose the later segment, never send a passed unit backward.
    if (separation <= best.distance + 1e-8)
      best = { index, distance: separation };
  }
  const remaining = route.slice(best.index);
  while (remaining.length && distance(unit.position, remaining[0]) < 0.001)
    remaining.shift();
  if (!remaining.length) return [];
  const approach = findPath(map, unit.position, remaining[0]);
  if (!approach) return [];
  return [...approach, ...remaining.slice(1).map((point) => ({ ...point }))];
}

/**
 * A wave can acquire a nearby defender or off-center structure, physically walk
 * into attack range, and rejoin its own lane when that target dies/leaves.
 * Acquisition never teleports, deals damage, consumes a reward, or changes HP.
 * The returned path is the ACTUAL next path, so replay samples retain detours.
 */
export function nextMinionPath(
  state: EngineState,
  unit: UnitState,
  previousUnits: readonly UnitState[],
  nearbyCandidates?: readonly UnitState[],
): Point[] {
  if (
    !state.input.rules.environment ||
    unit.kind !== 'MINION' ||
    !unit.side ||
    !unit.lane
  )
    return unit.path.map((point) => ({ ...point }));
  if (!unit.active || unit.hp <= 0) return [];
  let target: UnitState | undefined;
  let closest = Infinity;
  let priority = Infinity;
  const radius = Math.max(unit.attackRange, MINION_ACQUIRE_RADIUS);
  // An optional same-snapshot spatial subset is only an acceleration. Keep all
  // eligibility/range/LOS checks here and retain the original snapshot ordering.
  for (const other of nearbyCandidates ?? previousUnits) {
    if (
      other.id === unit.id ||
      !other.active ||
      other.hp <= 0 ||
      other.side === null ||
      other.side === unit.side ||
      other.kind === 'WARD'
    )
      continue;
    const separation = distance(unit.position, other.position);
    // Prerequisite inspection scans structure state: never do it for distant map units.
    if (
      separation > radius ||
      !environmentTargetable(state, other) ||
      !hasLineOfSight(state.input.map, unit.position, other.position)
    )
      continue;
    // Same result as the prior filter/some/sort pipeline, without allocations or repeated distances.
    if (separation <= unit.attackRange) return [];
    const rank = Number(other.kind === 'CHAMPION');
    if (
      rank < priority ||
      (rank === priority &&
        (separation < closest ||
          (separation === closest &&
            (!target || other.id.localeCompare(target.id, 'en') < 0))))
    ) {
      target = other;
      closest = separation;
      priority = rank;
    }
  }
  if (target)
    return findPath(state.input.map, unit.position, target.position) ?? [];
  return resumeLane(state.input.map, unit);
}
