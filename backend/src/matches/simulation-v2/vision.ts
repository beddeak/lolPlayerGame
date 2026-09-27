import type {
  EngineInput,
  EngineState,
  Point,
  Ruleset,
  Side,
  UnitState,
  UnitView,
} from './contracts';
import { emit } from './contracts';
import { distance, hasLineOfSight, isWalkable } from './map-paths';

export interface VisionRules {
  charges: number;
  rechargeMs: number;
  placementMs: number;
  placementRange: number;
  lifetimeMs: number;
  radius: number;
  maxWardsPerActor: number;
  scanRadius: number;
  scanDurationMs: number;
  scanCooldownMs: number;
  memoryMs: number;
}
export const MODEL_VISION_RULES: VisionRules = {
  charges: 2,
  rechargeMs: 120_000,
  placementMs: 300,
  placementRange: 450,
  lifetimeMs: 90_000,
  radius: 1050,
  maxWardsPerActor: 3,
  scanRadius: 750,
  scanDurationMs: 8000,
  scanCooldownMs: 90_000,
  memoryMs: 30_000,
};
export interface WardRecord {
  unitId: string;
  ownerId: string;
  expiresAtMs: number;
}
export interface VisionInventory {
  charges: number;
  nextChargeAtMs: number;
  scanReadyAtMs: number;
  scanUntilMs: number;
  placement: { point: Point; completesAtMs: number } | null;
  placements: number;
}
export interface VisionState {
  wards: WardRecord[];
  inventory: Record<string, VisionInventory>;
}
type VisionWorld = EngineState & {
  vision: VisionState;
  input: EngineInput & { rules: Ruleset & { vision: VisionRules } };
};
function hasVision(state: EngineState): state is VisionWorld {
  return !!state.vision && !!state.input.rules.vision;
}

export function createVisionState(
  actorIds: string[],
  rules: VisionRules,
): VisionState {
  return {
    wards: [],
    inventory: Object.fromEntries(
      actorIds.map((id) => [
        id,
        {
          charges: rules.charges,
          nextChargeAtMs: rules.rechargeMs,
          scanReadyAtMs: 0,
          scanUntilMs: 0,
          placement: null,
          placements: 0,
        },
      ]),
    ),
  };
}

/** Scanners reveal/disable wards, never champions through a wall or an entire hidden jungle. */
export function wardDetected(
  state: EngineState,
  side: Side,
  ward: UnitState,
): boolean {
  if (!hasVision(state)) return false;
  return state.actors.some(
    (actor) =>
      actor.active &&
      actor.side === side &&
      state.vision.inventory[actor.id]?.scanUntilMs > state.simTimeMs &&
      distance(actor.position, ward.position) <=
        state.input.rules.vision.scanRadius &&
      hasLineOfSight(state.input.map, actor.position, ward.position),
  );
}

export function isVisibleToTeam(
  state: EngineState,
  side: Side,
  target: UnitState,
  all: UnitState[] = [...state.actors, ...state.units],
): boolean {
  if (target.side === side) return true;
  if (target.kind === 'WARD')
    return target.active && wardDetected(state, side, target);
  return all.some((source) => {
    if (!source.active || source.side !== side) return false;
    if (
      source.kind === 'WARD' &&
      wardDetected(state, side === 'BLUE' ? 'RED' : 'BLUE', source)
    )
      return false;
    const radius =
      source.kind === 'CHAMPION'
        ? state.input.actors.find((actor) => actor.actorId === source.id)!
            .profile.visionRange
        : source.kind === 'WARD'
          ? (state.input.rules.vision?.radius ?? 0)
          : source.kind === 'TURRET'
            ? // A turret cannot select an in-range enemy that its own team cannot see.
              // This is a model minimum, not an asserted Riot vision-radius value.
              Math.max(
                state.input.rules.environment?.towerVision ?? 650,
                source.attackRange,
              )
            : 650;
    return (
      distance(source.position, target.position) <= radius &&
      hasLineOfSight(state.input.map, source.position, target.position)
    );
  });
}

export function requestWard(
  state: EngineState,
  actorId: string,
  point: Point,
): boolean {
  if (!hasVision(state)) return false;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const inventory = state.vision.inventory[actorId];
  const rules = state.input.rules.vision;
  if (
    !actor?.active ||
    actor.action.kind === 'RECALL' ||
    !inventory ||
    inventory.placement ||
    inventory.charges <= 0 ||
    !isWalkable(state.input.map, point) ||
    distance(actor.position, point) > rules.placementRange ||
    !hasLineOfSight(state.input.map, actor.position, point)
  )
    return false;
  if (inventory.charges === rules.charges)
    inventory.nextChargeAtMs = state.simTimeMs + rules.rechargeMs;
  inventory.charges--;
  inventory.placement = {
    point: { ...point },
    completesAtMs: state.simTimeMs + rules.placementMs,
  };
  actor.path = [];
  actor.action = { kind: 'IDLE' };
  emit(state, { kind: 'WARD_START', actorId, position: { ...point } });
  return true;
}

export function requestSweep(state: EngineState, actorId: string): boolean {
  if (!hasVision(state)) return false;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const inventory = state.vision.inventory[actorId];
  if (
    !actor?.active ||
    actor.action.kind === 'RECALL' ||
    !inventory ||
    inventory.scanReadyAtMs > state.simTimeMs
  )
    return false;
  inventory.scanReadyAtMs =
    state.simTimeMs + state.input.rules.vision.scanCooldownMs;
  inventory.scanUntilMs =
    state.simTimeMs + state.input.rules.vision.scanDurationMs;
  emit(state, { kind: 'SWEEP', actorId, position: { ...actor.position } });
  return true;
}

export function advanceVision(state: EngineState): void {
  if (!hasVision(state)) return;
  const rules = state.input.rules.vision;
  for (const actor of state.actors) {
    const inventory = state.vision.inventory[actor.id];
    if (!inventory) continue;
    while (inventory.nextChargeAtMs <= state.simTimeMs) {
      inventory.charges = Math.min(rules.charges, inventory.charges + 1);
      inventory.nextChargeAtMs += rules.rechargeMs;
    }
    const pending = inventory.placement;
    if (!pending) continue;
    if (
      !actor.active ||
      actor.action.kind === 'RECALL' ||
      state.combat?.effects.some(
        (effect) =>
          effect.kind === 'STUN' &&
          effect.targetId === actor.id &&
          effect.expiresAtMs > state.simTimeMs,
      ) ||
      distance(actor.position, pending.point) > rules.placementRange ||
      !hasLineOfSight(state.input.map, actor.position, pending.point)
    ) {
      inventory.placement = null;
      emit(state, {
        kind: 'WARD_CANCEL',
        actorId: actor.id,
        reason: 'Placement interrupted; charge consumed',
      });
      continue;
    }
    if (pending.completesAtMs > state.simTimeMs) continue;
    inventory.placement = null;
    const existing = state.vision.wards.filter(
      (ward) =>
        ward.ownerId === actor.id &&
        state.units.some((unit) => unit.id === ward.unitId && unit.active),
    );
    while (existing.length >= rules.maxWardsPerActor) {
      const oldest = existing.shift()!;
      const unit = state.units.find(
        (candidate) => candidate.id === oldest.unitId,
      )!;
      unit.active = false;
      unit.hp = 0;
      emit(state, {
        kind: 'WARD_EXPIRE',
        targetId: unit.id,
        reason: 'Owner ward limit',
      });
    }
    const unitId = `ward:${actor.id}:${++inventory.placements}`;
    state.units.push({
      id: unitId,
      kind: 'WARD',
      side: actor.side,
      position: { ...pending.point },
      origin: { ...pending.point },
      lane: null,
      hp: 3,
      maxHp: 3,
      armor: 0,
      attackDamage: 0,
      attackRange: 0,
      attackIntervalMs: 1000,
      moveSpeed: 0,
      nextAttackAtMs: 0,
      path: [],
      active: true,
      spawnAtMs: state.simTimeMs,
      respawnAtMs: null,
      generation: 0,
      reward: { gold: 0, xp: 0, cs: 0 },
    });
    state.vision.wards.push({
      unitId,
      ownerId: actor.id,
      expiresAtMs: state.simTimeMs + rules.lifetimeMs,
    });
    emit(state, {
      kind: 'WARD_PLACED',
      actorId: actor.id,
      targetId: unitId,
      position: { ...pending.point },
    });
  }
  for (const ward of state.vision.wards) {
    const unit = state.units.find((candidate) => candidate.id === ward.unitId);
    if (unit?.active && ward.expiresAtMs <= state.simTimeMs) {
      unit.active = false;
      unit.hp = 0;
      emit(state, {
        kind: 'WARD_EXPIRE',
        targetId: unit.id,
        reason: 'Duration elapsed',
      });
    }
  }
  state.vision.wards = state.vision.wards.filter((ward) =>
    state.units.some((unit) => unit.id === ward.unitId && unit.active),
  );
  state.units = state.units.filter(
    (unit) => unit.kind !== 'WARD' || unit.active,
  );
}

/** Bounded knowledge, never a claim that the enemy is actually at the predicted location. */
export function memoryEstimate(
  atMs: number,
  seenAtMs: number,
  unit: UnitView,
  memoryMs: number,
) {
  const age = Math.max(0, atMs - seenAtMs);
  return {
    source: age === 0 ? ('CURRENT_VISION' as const) : ('LAST_SEEN' as const),
    confidence: Math.max(0, 1 - age / memoryMs),
    uncertaintyRadius: unit.active ? Math.min(14_143, (age / 1000) * 500) : 0,
  };
}
