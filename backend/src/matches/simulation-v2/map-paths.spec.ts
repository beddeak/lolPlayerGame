import type { MapDefinition, Point } from './contracts';
import {
  createMap,
  distance,
  findPath,
  hasLineOfSight,
  isWalkable,
  moveAlongPath,
} from './map-paths';

const pathLength = (from: Point, path: Point[]) =>
  [from, ...path]
    .slice(1)
    .reduce(
      (total, point, index) => total + distance([from, ...path][index], point),
      0,
    );

function assertLegalPath(map: MapDefinition, from: Point, path: Point[]) {
  let previous = from;
  for (const point of path) {
    expect(isWalkable(map, point)).toBe(true);
    expect(hasLineOfSight(map, previous, point)).toBe(true);
    previous = point;
  }
}

function testMap(walls: MapDefinition['walls']): MapDefinition {
  return { ...createMap(), width: 100, height: 100, walls };
}

describe('simulation-v2 map and movement', () => {
  it('uses independent symmetric 10000-unit map geometry', () => {
    const map = createMap();
    expect(map.version).toBe('approximate-rift-10000-v1');
    expect([map.width, map.height]).toEqual([10000, 10000]);
    expect(map.bases).toEqual({
      BLUE: { x: 700, y: 9300 },
      RED: { x: 9300, y: 700 },
    });
    expect(map.lanes.BOT).toEqual(
      map.lanes.TOP.map(({ x, y }) => ({ x: 10000 - y, y: 10000 - x })),
    );
    expect(pathLength(map.lanes.TOP[0], map.lanes.TOP.slice(1))).toBe(
      pathLength(map.lanes.BOT[0], map.lanes.BOT.slice(1)),
    );
    for (const wall of map.walls) {
      expect(map.walls).toContainEqual({
        x1: 10000 - wall.x2,
        y1: 10000 - wall.y2,
        x2: 10000 - wall.x1,
        y2: 10000 - wall.y1,
      });
    }
    for (const lane of Object.values(map.lanes)) {
      expect(lane[0]).toEqual(map.bases.BLUE);
      expect(lane.at(-1)).toEqual(map.bases.RED);
      assertLegalPath(map, lane[0], lane.slice(1));
    }
    map.lanes.TOP[0].x = 999;
    expect(map.bases.BLUE.x).toBe(700);
    expect(createMap().lanes.TOP[0].x).toBe(700);
  });

  it('rejects invalid or blocked endpoints and closed wall boundaries', () => {
    const map = testMap([{ x1: 40, y1: 40, x2: 60, y2: 60 }]);
    for (const point of [
      { x: -1, y: 1 },
      { x: 101, y: 1 },
      { x: 1, y: -1 },
      { x: 1, y: 101 },
      { x: NaN, y: 1 },
      { x: 1, y: Infinity },
      { x: 50, y: 50 },
      { x: 40, y: 40 },
      { x: 60, y: 50 },
    ]) {
      expect(isWalkable(map, point)).toBe(false);
      expect(findPath(map, { x: 0, y: 0 }, point)).toBeNull();
      expect(findPath(map, point, { x: 0, y: 0 })).toBeNull();
    }
    expect(isWalkable(map, { x: 0, y: 100 })).toBe(true);
    expect(isWalkable(map, { x: 100, y: 0 })).toBe(true);
    expect(findPath(map, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
  });

  it('tests sight against full segments, including parallel lines and corner tangency', () => {
    const map = testMap([{ x1: 40, y1: 40, x2: 60, y2: 60 }]);
    expect(hasLineOfSight(map, { x: 0, y: 50 }, { x: 100, y: 50 })).toBe(false);
    expect(hasLineOfSight(map, { x: 50, y: 0 }, { x: 50, y: 100 })).toBe(false);
    expect(hasLineOfSight(map, { x: 0, y: 80 }, { x: 80, y: 0 })).toBe(false);
    expect(hasLineOfSight(map, { x: 0, y: 39 }, { x: 100, y: 39 })).toBe(true);
    expect(hasLineOfSight(map, { x: 0, y: 40 }, { x: 100, y: 40 })).toBe(false);
    expect(hasLineOfSight(map, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
  });

  it('finds a true wall detour without mutating inputs', () => {
    const map = testMap([{ x1: 40, y1: 30, x2: 60, y2: 70 }]);
    const from = { x: 10, y: 50 };
    const to = { x: 90, y: 50 };
    const before = JSON.stringify({ map, from, to });
    const path = findPath(map, from, to)!;
    expect(path.length).toBeGreaterThan(1);
    expect(path.at(-1)).toEqual(to);
    expect(path).not.toContainEqual(from);
    expect(pathLength(from, path)).toBeGreaterThan(distance(from, to));
    assertLegalPath(map, from, path);
    expect(findPath(map, from, to)).toEqual(path);
    expect(JSON.stringify({ map, from, to })).toBe(before);
  });

  it('cannot cross a wall that seals the map or pass through a shared wall corner', () => {
    const from = { x: 10, y: 50 };
    const to = { x: 90, y: 50 };
    expect(
      findPath(testMap([{ x1: 40, y1: 0, x2: 60, y2: 100 }]), from, to),
    ).toBeNull();
    const touching = testMap([
      { x1: 40, y1: 0, x2: 60, y2: 50 },
      { x1: 60, y1: 50, x2: 80, y2: 100 },
    ]);
    expect(findPath(touching, from, to)).toBeNull();
  });

  it('routes mirrored jungle travel with the same distance', () => {
    const map = createMap();
    const from = { x: 1800, y: 5700 };
    const to = { x: 3500, y: 5700 };
    const flip = (point: Point) => ({ x: 10000 - point.x, y: 10000 - point.y });
    const bluePath = findPath(map, from, to)!;
    const redPath = findPath(map, flip(from), flip(to))!;
    assertLegalPath(map, from, bluePath);
    assertLegalPath(map, flip(from), redPath);
    expect(pathLength(from, bluePath)).toBeCloseTo(
      pathLength(flip(from), redPath),
      8,
    );
  });

  it('does not confuse geometric visibility or a shared region with attack range', () => {
    const map = testMap([]);
    const first = { x: 10, y: 10 };
    const second = { x: 90, y: 10 };
    expect(hasLineOfSight(map, first, second)).toBe(true);
    expect(distance(first, second)).toBe(80);
    expect(distance(first, second) <= 20).toBe(false);
    expect(findPath(map, first, second)).toEqual([second]);
  });

  it('honors the movement budget across corners with no overshoot or alias mutation', () => {
    const start = { x: 0, y: 0 };
    const path = [
      { x: 3, y: 4 },
      { x: 6, y: 8 },
      { x: 6, y: 20 },
    ];
    const before = JSON.stringify({ start, path });
    const result = moveAlongPath(start, path, 7);
    expect(result.position.x).toBeCloseTo(4.2, 10);
    expect(result.position.y).toBeCloseTo(5.6, 10);
    expect(result.travelled).toBe(7);
    expect(result.path).toEqual(path.slice(1));
    expect(moveAlongPath(start, path, 100)).toEqual({
      position: { x: 6, y: 20 },
      path: [],
      travelled: 22,
    });
    expect(moveAlongPath(start, path, 0)).toEqual({
      position: start,
      path,
      travelled: 0,
    });
    expect(moveAlongPath(start, [start, start], 1)).toEqual({
      position: start,
      path: [],
      travelled: 0,
    });
    result.path[0].x = 999;
    expect(JSON.stringify({ start, path })).toBe(before);
  });

  it('has equivalent split-tick and single-budget movement along a legal path', () => {
    const map = createMap();
    const start = { x: 1800, y: 5700 };
    const path = findPath(map, start, { x: 3500, y: 5700 })!;
    const single = moveAlongPath(start, path, 2000);
    let repeated = { position: start, path, travelled: 0 };
    let total = 0;
    for (let step = 0; step < 20; step++) {
      const previous = repeated.position;
      const beforePath = repeated.path;
      repeated = moveAlongPath(repeated.position, repeated.path, 100);
      total += repeated.travelled;
      expect(repeated.travelled).toBeLessThanOrEqual(100);
      // A tick may cross a waypoint. Validate the consumed route, not a chord
      // that a renderer must never substitute for that route around the corner.
      const consumed = beforePath.slice(
        0,
        beforePath.length - repeated.path.length,
      );
      assertLegalPath(map, previous, [...consumed, repeated.position]);
      expect(distance(previous, repeated.position)).toBeLessThanOrEqual(
        100 + 1e-9,
      );
    }
    expect(repeated.position.x).toBeCloseTo(single.position.x, 8);
    expect(repeated.position.y).toBeCloseTo(single.position.y, 8);
    expect(total).toBeCloseTo(single.travelled, 8);
  });

  it('rejects invalid movement quantities instead of producing NaN positions', () => {
    for (const budget of [-1, NaN, Infinity, -Infinity]) {
      expect(() => moveAlongPath({ x: 0, y: 0 }, [], budget)).toThrow(
        RangeError,
      );
    }
    expect(() => distance({ x: NaN, y: 0 }, { x: 0, y: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      moveAlongPath({ x: 0, y: 0 }, [{ x: Infinity, y: 0 }], 5),
    ).toThrow(RangeError);
  });
});
