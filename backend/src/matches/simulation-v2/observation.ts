import type {
  EngineState,
  Observation,
  Side,
  UnitState,
  UnitView,
} from './contracts';
import { isVisibleToTeam, memoryEstimate } from './vision';

const view = (unit: UnitState): UnitView => ({
  id: unit.id,
  kind: unit.kind,
  side: unit.side,
  position: { ...unit.position },
  hp: unit.hp,
  maxHp: unit.maxHp,
  active: unit.active,
  attackRange: unit.attackRange,
});

/** Read-only projection: inspecting it cannot change the next simulation decision. */
export function observe(state: EngineState, side: Side): Observation {
  const allies = state.actors.filter((a) => a.side === side);
  const minionVision = state.units.filter(
    (u) => u.kind === 'MINION' && u.side === side && u.active,
  );
  const visible: UnitView[] = [];
  const remembered = Object.fromEntries(
    Object.entries(state.observations[side]).filter(
      ([, entry]) =>
        state.simTimeMs - entry.atMs <=
        (state.input.rules.vision?.memoryMs ?? 30_000),
    ),
  );
  for (const unit of [...state.actors, ...state.units]) {
    if (unit.side === side) continue;
    const seen = isVisibleToTeam(state, side, unit);
    if (!seen) continue;
    const value = view(unit);
    visible.push(value);
    remembered[unit.id] = {
      atMs: state.simTimeMs,
      unit: structuredClone(value),
    };
  }
  return {
    atMs: state.simTimeMs,
    side,
    allies: structuredClone(allies),
    friendlyMinions: minionVision.map(view),
    ...(state.vision
      ? {
          friendlyWards: state.units
            .filter(
              (unit) =>
                unit.kind === 'WARD' && unit.side === side && unit.active,
            )
            .map(view),
          estimates: Object.values(remembered).map((entry) => ({
            unitId: entry.unit.id,
            lastPosition: { ...entry.unit.position },
            lastSeenAtMs: entry.atMs,
            ...memoryEstimate(
              state.simTimeMs,
              entry.atMs,
              entry.unit,
              state.input.rules.vision?.memoryMs ?? 30_000,
            ),
          })),
        }
      : {}),
    ...(state.input.rules.environment
      ? {
          friendlyStructures: state.units
            .filter(
              (unit) =>
                ['TURRET', 'INHIBITOR', 'NEXUS'].includes(unit.kind) &&
                unit.side === side,
            )
            .map(view),
        }
      : {}),
    visible,
    remembered: Object.values(remembered).map((entry) =>
      structuredClone(entry),
    ),
  };
}
