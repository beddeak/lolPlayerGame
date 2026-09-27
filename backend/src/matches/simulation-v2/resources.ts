import {
  emit,
  type EngineState,
  type Lane,
  type MapDefinition,
  type Point,
  type Ruleset,
  type Side,
  type UnitState,
} from './contracts';
import { isWalkable } from './map-paths';
import { applySuperMinion } from './environment';

export interface CampDefinition {
  id: string;
  side: Side;
  name: string;
  position: Point;
  spawnAtMs: number;
}

/** Abstract mirrored camp locations, not an official map collision dataset. */
export function getCampDefinitions(
  map: MapDefinition,
  rules: Ruleset,
): CampDefinition[] {
  const { standard, delayed } = rules.campSpawnTimesMs;
  const camps = [
    { name: 'RED', x: 0.32, y: 0.8, spawnAtMs: standard },
    { name: 'RAPTORS', x: 0.35, y: 0.76, spawnAtMs: standard },
    { name: 'WOLVES', x: 0.35, y: 0.62, spawnAtMs: standard },
    { name: 'BLUE', x: 0.18, y: 0.45, spawnAtMs: standard },
    { name: 'GROMP', x: 0.1, y: 0.42, spawnAtMs: delayed },
    { name: 'KRUGS', x: 0.43, y: 0.88, spawnAtMs: delayed },
  ];
  return (['BLUE', 'RED'] as const).flatMap((side) =>
    camps.map((camp) => {
      const blueX = Math.round(map.width * camp.x);
      const blueY = Math.round(map.height * camp.y);
      const position = {
        x: side === 'BLUE' ? blueX : map.width - blueX,
        y: side === 'BLUE' ? blueY : map.height - blueY,
      };
      if (!isWalkable(map, position))
        throw new RangeError(`Camp ${side}-${camp.name} is inside a wall`);
      return {
        id: `camp:${side}:${camp.name}`,
        side,
        name: camp.name,
        position,
        spawnAtMs: camp.spawnAtMs,
      };
    }),
  );
}

function spawn(state: EngineState, unit: UnitState): void {
  unit.active = true;
  unit.hp = unit.maxHp;
  unit.position = { ...unit.origin };
  unit.nextAttackAtMs = state.simTimeMs;
  unit.respawnAtMs = null;
  unit.generation++;
  emit(state, {
    kind: 'SPAWN',
    targetId: unit.id,
    position: { ...unit.position },
    sourceId: `${unit.id}@${unit.generation}`,
  });
}

export function initializeResources(state: EngineState): void {
  const template = state.input.rules.camp;
  for (const camp of getCampDefinitions(state.input.map, state.input.rules)) {
    if (state.units.some((unit) => unit.id === camp.id)) continue;
    state.units.push({
      id: camp.id,
      kind: 'CAMP',
      side: null,
      position: { ...camp.position },
      origin: { ...camp.position },
      lane: null,
      hp: 0,
      maxHp: template.hp,
      armor: template.armor,
      attackDamage: template.attackDamage,
      attackRange: template.attackRange,
      attackIntervalMs: template.attackIntervalMs,
      moveSpeed: template.moveSpeed,
      nextAttackAtMs: camp.spawnAtMs,
      path: [],
      active: false,
      spawnAtMs: camp.spawnAtMs,
      respawnAtMs: null,
      generation: 0,
      reward: { gold: template.gold, xp: template.xp, cs: template.cs },
    });
  }
}

/** The engine owns movement/combat; this function owns scheduled resource lifecycles. */
export function advanceResources(state: EngineState): void {
  const { rules, map } = state.input;
  if (!Number.isSafeInteger(rules.waveIntervalMs) || rules.waveIntervalMs <= 0)
    throw new RangeError('Wave interval must be a positive integer');
  // Dead minions have no future lifecycle. Their events/reward keys remain immutable.
  state.units = state.units.filter(
    (unit) => unit.kind !== 'MINION' || unit.active,
  );
  for (const camp of state.units.filter(
    (unit) => unit.kind === 'CAMP' && !unit.active,
  )) {
    if (
      (camp.generation === 0 && state.simTimeMs >= camp.spawnAtMs) ||
      (camp.respawnAtMs !== null && state.simTimeMs >= camp.respawnAtMs)
    ) {
      camp.spawnAtMs = state.simTimeMs;
      camp.path = [];
      spawn(state, camp);
    }
  }
  while (state.nextWaveAtMs <= state.simTimeMs) {
    const atMs = state.nextWaveAtMs;
    state.nextWaveAtMs += rules.waveIntervalMs;
    state.waveNumber++;
    for (const lane of ['TOP', 'MID', 'BOT'] as Lane[]) {
      for (const side of ['BLUE', 'RED'] as Side[]) {
        const route =
          side === 'BLUE' ? map.lanes[lane] : [...map.lanes[lane]].reverse();
        const origin = route[0];
        for (let index = 0; index < rules.minionsPerWave; index++) {
          const template = rules.minion;
          const unit: UnitState = {
            id: `wave:${state.waveNumber}:${lane}:${side}:${index}`,
            kind: 'MINION',
            side,
            lane,
            position: { ...origin },
            origin: { ...origin },
            hp: template.hp,
            maxHp: template.hp,
            armor: template.armor,
            attackDamage: template.attackDamage,
            attackRange: template.attackRange,
            attackIntervalMs: template.attackIntervalMs,
            moveSpeed: template.moveSpeed,
            nextAttackAtMs: atMs,
            path: route.slice(1).map((point) => ({ ...point })),
            active: true,
            spawnAtMs: atMs,
            respawnAtMs: null,
            generation: 1,
            reward: { gold: template.gold, xp: template.xp, cs: template.cs },
          };
          if (rules.environment) {
            const growth = Math.floor(atMs / 90_000);
            unit.maxHp += growth * 12;
            unit.hp = unit.maxHp;
            unit.attackDamage += growth * 1.5;
            applySuperMinion(state, unit, index);
          }
          state.units.push(unit);
          emit(state, {
            kind: 'SPAWN',
            targetId: unit.id,
            position: { ...origin },
            sourceId: `${unit.id}@1`,
          });
        }
      }
    }
  }
  for (const objective of rules.objectives) {
    if (
      state.simTimeMs < objective.spawnAtMs ||
      state.objectivesAnnounced[objective.id]
    )
      continue;
    state.objectivesAnnounced[objective.id] = true;
    emit(state, {
      kind: 'OBJECTIVE_AVAILABLE',
      targetId: objective.id,
      position: { ...objective.position },
      reason: `${objective.capability}: lifecycle only; objective combat is not enabled`,
    });
  }
}
