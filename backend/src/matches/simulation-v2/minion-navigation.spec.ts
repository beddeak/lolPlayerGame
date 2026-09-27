import type { EngineState, Point, UnitState } from './contracts';
import { createDuelInput } from './test-fixtures';
import { createBattleRuleset } from './battle-rules';
import { startSimulation, runUntil } from './engine';
import {
  distance,
  findPath,
  hasLineOfSight,
  isWalkable,
  moveAlongPath,
} from './map-paths';
import { MINION_ACQUIRE_RADIUS, nextMinionPath } from './minion-navigation';
import { environmentTargetable, structureId } from './environment';
import { UnitSpatialIndex } from './unit-spatial-index';

function scenario(): EngineState {
  const input = createDuelInput();
  input.rules = createBattleRuleset();
  const state = startSimulation(input);
  state.actors.forEach((actor) => {
    actor.active = false;
    actor.hp = 0;
  });
  return state;
}
function minion(
  state: EngineState,
  point: Point,
  lane: 'TOP' | 'BOT' | 'MID' = 'TOP',
): UnitState {
  const result: UnitState = {
    id: 'test-navigation-minion',
    kind: 'MINION',
    side: 'BLUE',
    position: { ...point },
    origin: { ...state.input.map.bases.BLUE },
    lane,
    hp: 20_000,
    maxHp: 20_000,
    armor: 0,
    attackDamage: 1500,
    attackRange: 220,
    attackIntervalMs: 1000,
    moveSpeed: 220,
    nextAttackAtMs: 0,
    path: [{ ...state.input.map.bases.RED }],
    active: true,
    spawnAtMs: 0,
    respawnAtMs: null,
    generation: 1,
    reward: { gold: 20, xp: 55, cs: 1 },
  };
  state.units.push(result);
  return result;
}
function breachLane(state: EngineState): void {
  state.units
    .filter(
      (unit) => unit.side === 'RED' && unit.lane === 'TOP' && unit.structure,
    )
    .forEach((unit) => {
      unit.active = false;
      unit.hp = 0;
    });
}

describe('minion local acquisition and safe lane rejoin', () => {
  it('returns identical paths/holds with a full scan or an ordered same-snapshot spatial subset', () => {
    const state = scenario();
    breachLane(state);
    const moving = minion(state, { x: 5000, y: 5000 });
    const samples = state.units
      .filter((unit) => unit.side === 'RED' && unit.structure)
      .flatMap((unit) =>
        [0, 220, 224, 650, 651].map((offset) => ({
          x: unit.position.x - offset,
          y: unit.position.y,
        })),
      );
    let checked = 0;
    for (const point of samples) {
      if (!isWalkable(state.input.map, point)) continue;
      moving.position = point;
      const all = [...state.actors, ...state.units];
      const index = new UnitSpatialIndex(all);
      const candidates = index.within(
        point,
        Math.max(moving.attackRange, MINION_ACQUIRE_RADIUS),
      );
      expect(nextMinionPath(state, moving, all, candidates)).toEqual(
        nextMinionPath(state, moving, all),
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('keeps the old target/hold decision exactly while reducing scans and sort allocations', () => {
    const state = scenario();
    breachLane(state);
    const moving = minion(state, { x: 5000, y: 5000 });
    const samples = state.units
      .filter((unit) => unit.side === 'RED' && unit.structure)
      .map((unit) => ({ x: unit.position.x - 350, y: unit.position.y }));
    let checked = 0;
    for (const point of samples) {
      if (!isWalkable(state.input.map, point)) continue;
      moving.position = point;
      const all = [...state.actors, ...state.units];
      // Preserve a reference to the pre-optimization decision, including exact distance/id ties.
      const candidates = all.filter(
        (other) =>
          other.id !== moving.id &&
          other.active &&
          other.hp > 0 &&
          other.side !== null &&
          other.side !== moving.side &&
          other.kind !== 'WARD' &&
          environmentTargetable(state, other) &&
          distance(moving.position, other.position) <=
            Math.max(moving.attackRange, 650) &&
          hasLineOfSight(state.input.map, moving.position, other.position),
      );
      const inRange = candidates.some(
        (other) =>
          distance(moving.position, other.position) <= moving.attackRange,
      );
      const target = candidates.sort(
        (a, b) =>
          Number(a.kind === 'CHAMPION') - Number(b.kind === 'CHAMPION') ||
          distance(moving.position, a.position) -
            distance(moving.position, b.position) ||
          a.id.localeCompare(b.id, 'en'),
      )[0];
      if (!target) continue;
      const before = JSON.stringify(state);
      expect(nextMinionPath(state, moving, all)).toEqual(
        inRange
          ? []
          : (findPath(state.input.map, moving.position, target.position) ?? []),
      );
      expect(JSON.stringify(state)).toBe(before);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it.each(['TOP', 'BOT'] as const)(
    'detours the %s wave toward the 224-unit-offset nexus turret before attacking',
    (lane) => {
      const state = scenario();
      breachLane(state);
      const point = lane === 'TOP' ? { x: 8836, y: 700 } : { x: 9300, y: 1164 };
      const moving = minion(state, point, lane);
      const tower = state.units.find(
        (unit) =>
          unit.id === `structure:RED:NEXUS_TURRET:${lane === 'TOP' ? 0 : 1}`,
      )!;
      expect(distance(moving.position, tower.position)).toBeCloseTo(224);
      expect(distance(moving.position, tower.position)).toBeGreaterThan(
        moving.attackRange,
      );
      const path = nextMinionPath(state, moving, state.units);
      expect(path.at(-1)).toEqual(tower.position);
      const result = moveAlongPath(
        moving.position,
        path,
        moving.moveSpeed * 0.1,
      );
      expect(distance(result.position, tower.position)).toBeLessThanOrEqual(
        moving.attackRange,
      );
      expect(distance(moving.position, result.position)).toBeLessThanOrEqual(
        22.000001,
      );
      expect(tower.hp).toBe(tower.maxHp);
    },
  );

  it('does not pursue a locked structure, far-away defender or neutral objective', () => {
    const state = scenario();
    const inner = state.units.find(
      (unit) => unit.id === structureId('RED', 'TOP', 'INNER'),
    )!;
    const moving = minion(state, {
      x: inner.position.x - 300,
      y: inner.position.y,
    });
    const originalHp = state.units.map((unit) => unit.hp);
    const path = nextMinionPath(state, moving, state.units);
    expect(path.at(-1)).toEqual(state.input.map.bases.RED);
    expect(path[0]).not.toEqual(inner.position);
    expect(state.units.map((unit) => unit.hp)).toEqual(originalHp);
  });

  it('resumes only forward lane waypoints after an off-center target dies', () => {
    const state = scenario();
    breachLane(state);
    const moving = minion(state, { x: 8836, y: 850 });
    state.units
      .filter((unit) => unit.side === 'RED' && unit.kind === 'TURRET')
      .forEach((unit) => {
        unit.active = false;
        unit.hp = 0;
      });
    // Keep nexus locked so the test observes lane restoration, not another legal pursuit.
    const inhibitor = state.units.find(
      (unit) => unit.id === structureId('RED', 'TOP', 'INHIBITOR'),
    )!;
    inhibitor.active = true;
    inhibitor.hp = inhibitor.maxHp;
    const path = nextMinionPath(state, moving, []);
    expect(path).toEqual([{ ...state.input.map.bases.RED }]);
    expect(hasLineOfSight(state.input.map, moving.position, path[0])).toBe(
      true,
    );
  });

  it('rejoins through a legal path even when the detour ended beside a map wall', () => {
    const state = scenario();
    const moving = minion(state, { x: 3300, y: 5600 }, 'MID');
    const path = nextMinionPath(state, moving, []);
    expect(path.length).toBeGreaterThan(0);
    expect(
      path.every((point, index) =>
        hasLineOfSight(
          state.input.map,
          index ? path[index - 1] : moving.position,
          point,
        ),
      ),
    ).toBe(true);
    expect(path.at(-1)).toEqual(state.input.map.bases.RED);
  });

  it.each(['TOP', 'BOT'] as const)(
    'lets a real %s siege wave destroy both unlocked nexus turrets and then nexus through the shared resolver',
    (lane) => {
      const state = scenario();
      breachLane(state);
      const moving = minion(
        state,
        lane === 'TOP' ? { x: 8750, y: 700 } : { x: 9300, y: 1250 },
        lane,
      );
      runUntil(state, 20_000);
      expect(state.error).toBeNull();
      expect(state.status).toBe('FINISHED');
      expect(state.winnerTeamId).toBe(1);
      expect(moving.hp).toBeLessThan(moving.maxHp);
      expect(
        state.events.filter((event) => event.kind === 'NEXUS_DESTROYED'),
      ).toHaveLength(1);
      expect(
        state.events.filter(
          (event) =>
            event.kind === 'DAMAGE' &&
            event.actorId === moving.id &&
            event.targetId?.includes('NEXUS_TURRET'),
        ).length,
      ).toBeGreaterThan(0);
      expect(state.ledger.some((entry) => entry.kind === 'KILL')).toBe(false);
    },
  );
});
