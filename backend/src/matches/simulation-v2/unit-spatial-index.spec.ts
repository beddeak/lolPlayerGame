import type { Point, UnitState } from './contracts';
import { UnitSpatialIndex } from './unit-spatial-index';

function unit(id: string, x: number, y: number): UnitState {
  return {
    id,
    kind: 'MINION',
    side: 'BLUE',
    position: { x, y },
    origin: { x, y },
    lane: 'MID',
    hp: 100,
    maxHp: 100,
    armor: 0,
    attackDamage: 1,
    attackRange: 220,
    attackIntervalMs: 1000,
    moveSpeed: 220,
    nextAttackAtMs: 0,
    path: [],
    active: true,
    spawnAtMs: 0,
    respawnAtMs: null,
    generation: 1,
    reward: { gold: 0, xp: 0, cs: 0 },
  };
}
const brute = (units: UnitState[], point: Point, radius: number) =>
  units.filter(
    (entry) =>
      Math.hypot(point.x - entry.position.x, point.y - entry.position.y) <=
      radius,
  );

describe('snapshot spatial lookup', () => {
  it('matches a full scan including exact distance boundaries and preserves original order across cells', () => {
    const units = [
      unit('last-cell-first', 1600, 800),
      unit('left', 0, 800),
      unit('center', 800, 800),
      unit('diagonal-edge', 1280, 1440),
      unit('outside', 1600.0001, 800),
      unit('negative', -50, 0),
    ];
    const index = new UnitSpatialIndex(units, 800);
    expect(index.within({ x: 800, y: 800 }, 800)).toEqual(
      brute(units, { x: 800, y: 800 }, 800),
    );
    expect(
      index.within({ x: 800, y: 800 }, 800).map((entry) => entry.id),
    ).toEqual(['last-cell-first', 'left', 'center', 'diagonal-edge']);
    expect(index.within({ x: -50, y: 0 }, 0)).toEqual([units[5]]);
  });

  it('is equivalent to a brute scan for deterministic mixed positive/negative coordinates and ranges', () => {
    let seed = 1217;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const units = Array.from({ length: 200 }, (_, i) =>
      unit(`unit:${i}`, random() * 12_000 - 1000, random() * 12_000 - 1000),
    );
    for (const size of [350, 800, 2000]) {
      const index = new UnitSpatialIndex(units, size);
      for (let i = 0; i < 70; i++) {
        const point = {
          x: random() * 12_000 - 1000,
          y: random() * 12_000 - 1000,
        };
        const radius = random() * 3500;
        expect(index.within(point, radius).map((entry) => entry.id)).toEqual(
          brute(units, point, radius).map((entry) => entry.id),
        );
      }
    }
  });

  it('does not perform gameplay filtering or mutate units and returns an independent result list', () => {
    const units = [unit('alive', 10, 10), unit('dead', 10, 10)];
    units[1].active = false;
    units[1].hp = 0;
    const before = JSON.stringify(units);
    const index = new UnitSpatialIndex(units);
    const result = index.within({ x: 10, y: 10 }, 0);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(units[0]);
    result.reverse();
    result.pop();
    expect(index.within({ x: 10, y: 10 }, 0)).toEqual(units);
    expect(JSON.stringify(units)).toBe(before);
  });

  it('pins geometry to its construction snapshot and needs rebuilding after movement', () => {
    const units = [unit('moving', 0, 0)];
    const index = new UnitSpatialIndex(units);
    units[0].position = { x: 9000, y: 9000 };
    expect(index.within({ x: 0, y: 0 }, 0)).toEqual(units);
    expect(index.within({ x: 9000, y: 9000 }, 0)).toHaveLength(0);
    expect(new UnitSpatialIndex(units).within({ x: 9000, y: 9000 }, 0)).toEqual(
      units,
    );
  });

  it('handles empty and enormous-radius queries without walking unbounded empty cells', () => {
    expect(new UnitSpatialIndex([]).within({ x: 0, y: 0 }, 1e100)).toEqual([]);
    const units = [unit('one', 100, 100), unit('two', 200, 200)];
    expect(new UnitSpatialIndex(units).within({ x: 0, y: 0 }, 1e100)).toEqual(
      units,
    );
  });

  it('falls back to exact scans when finite coordinates produce unsafe or infinite cell indices', () => {
    const units = [unit('distant', 1e30, 1e30), unit('origin', 0, 0)];
    for (const size of [Number.MIN_VALUE, 1e-10, 800]) {
      expect(
        new UnitSpatialIndex(units, size).within({ x: 1e30, y: 1e30 }, 0),
      ).toEqual([units[0]]);
      expect(
        new UnitSpatialIndex(units, size).within({ x: 0, y: 0 }, 1e31),
      ).toEqual(units);
    }
  });

  it('rejects invalid inputs rather than poisoning movement with NaN or an infinite grid loop', () => {
    expect(() => new UnitSpatialIndex([], 0)).toThrow('cell size');
    expect(() => new UnitSpatialIndex([unit('bad', NaN, 0)])).toThrow(
      'positions',
    );
    const index = new UnitSpatialIndex([]);
    expect(() => index.within({ x: Infinity, y: 0 }, 1)).toThrow('query');
    expect(() => index.within({ x: 0, y: 0 }, -1)).toThrow('query');
    expect(() => index.within({ x: 0, y: 0 }, Infinity)).toThrow('query');
  });
});
