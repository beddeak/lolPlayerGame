import type { MapDefinition, Point } from './contracts';
export type { MapDefinition } from './contracts';

const CORNER_CLEARANCE = 1;
const EPSILON = 1e-9;

interface CornerGraph {
  corners: Point[];
  costs: number[][];
}
// Only immutable geometry is cached. No actor/world decisions or mutable maps
// enter this cache; a JSON resume builds the same graph with the same tie order.
const cornerGraphs = new WeakMap<MapDefinition, CornerGraph>();

function cornerGraph(map: MapDefinition): CornerGraph {
  const prior = cornerGraphs.get(map);
  if (prior) return prior;
  const corners = map.walls
    .flatMap((wall) => [
      { x: wall.x1 - CORNER_CLEARANCE, y: wall.y1 - CORNER_CLEARANCE },
      { x: wall.x1 - CORNER_CLEARANCE, y: wall.y2 + CORNER_CLEARANCE },
      { x: wall.x2 + CORNER_CLEARANCE, y: wall.y1 - CORNER_CLEARANCE },
      { x: wall.x2 + CORNER_CLEARANCE, y: wall.y2 + CORNER_CLEARANCE },
    ])
    .filter((point) => isWalkable(map, point))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const graph = {
    corners,
    costs: corners.map((from) =>
      corners.map((to) =>
        hasLineOfSight(map, from, to) ? distance(from, to) : Infinity,
      ),
    ),
  };
  if (
    Object.isFrozen(map) &&
    Object.isFrozen(map.walls) &&
    map.walls.every(Object.isFrozen)
  )
    cornerGraphs.set(map, graph);
  return graph;
}

/** An explicitly approximate map, not Riot's collision mesh or map units. */
export function createMap(): MapDefinition {
  const blue = { x: 700, y: 9300 };
  const red = { x: 9300, y: 700 };
  const top = [blue, { x: 700, y: 1800 }, { x: 1800, y: 700 }, red];
  const baseWalls = [
    { x1: 2200, y1: 5000, x2: 3200, y2: 6400 },
    { x1: 1500, y1: 2900, x2: 2400, y2: 4000 },
  ];
  const walls = baseWalls.flatMap((wall) => {
    const reflected = {
      x1: 10000 - wall.y2,
      y1: 10000 - wall.x2,
      x2: 10000 - wall.y1,
      y2: 10000 - wall.x1,
    };
    return [wall, reflected].flatMap((part) => [
      part,
      {
        x1: 10000 - part.x2,
        y1: 10000 - part.y2,
        x2: 10000 - part.x1,
        y2: 10000 - part.y1,
      },
    ]);
  });
  return {
    version: 'approximate-rift-10000-v1',
    width: 10000,
    height: 10000,
    bases: { BLUE: { ...blue }, RED: { ...red } },
    lanes: {
      TOP: top.map((point) => ({ ...point })),
      MID: [{ ...blue }, { ...red }],
      BOT: top.map(({ x, y }) => ({ x: 10000 - y, y: 10000 - x })),
    },
    walls,
  };
}

function validPoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function distance(a: Point, b: Point): number {
  if (!validPoint(a) || !validPoint(b)) {
    throw new RangeError('Map coordinates must be finite numbers');
  }
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Map edges are walkable. Wall edges and corners are not. */
export function isWalkable(map: MapDefinition, point: Point): boolean {
  return (
    validPoint(point) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= map.width &&
    point.y <= map.height &&
    !map.walls.some(
      (wall) =>
        point.x >= wall.x1 &&
        point.x <= wall.x2 &&
        point.y >= wall.y1 &&
        point.y <= wall.y2,
    )
  );
}

// Segment/slab intersection includes touching a wall: no diagonal corner cutting.
function intersectsWall(
  from: Point,
  to: Point,
  wall: MapDefinition['walls'][number],
): boolean {
  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = to[axis] - from[axis];
    const low = wall[`${axis}1`];
    const high = wall[`${axis}2`];
    if (delta === 0) {
      if (from[axis] < low || from[axis] > high) return false;
      continue;
    }
    const first = (low - from[axis]) / delta;
    const last = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (enter > exit + EPSILON) return false;
  }
  return enter <= exit + EPSILON;
}

/** Geometric visibility only. Fog of war and attack range are separate checks. */
export function hasLineOfSight(
  map: MapDefinition,
  from: Point,
  to: Point,
): boolean {
  return (
    isWalkable(map, from) &&
    isWalkable(map, to) &&
    !map.walls.some((wall) => intersectsWall(from, to, wall))
  );
}

/**
 * Deterministic shortest path over visible, clearance-offset wall corners.
 * Returned nodes exclude the origin and include the destination; [] means arrived.
 * The approximation has a one-unit corner clearance (no champion body radius yet).
 */
export function findPath(
  map: MapDefinition,
  from: Point,
  to: Point,
): Point[] | null {
  if (!isWalkable(map, from) || !isWalkable(map, to)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  if (hasLineOfSight(map, from, to)) return [{ ...to }];

  const graph = cornerGraph(map);
  const nodes = [from, to, ...graph.corners];
  const costs = nodes.map(() => Infinity);
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  costs[0] = 0;
  for (;;) {
    let current = -1;
    for (let index = 0; index < nodes.length; index++) {
      if (
        !visited.has(index) &&
        Number.isFinite(costs[index]) &&
        (current === -1 || costs[index] < costs[current])
      ) {
        current = index;
      }
    }
    if (current === -1) return null;
    if (current === 1) {
      const result: Point[] = [];
      for (let index = 1; index !== 0; index = previous[index]) {
        result.push({ ...nodes[index] });
      }
      return result.reverse();
    }
    visited.add(current);
    for (let next = 0; next < nodes.length; next++) {
      if (visited.has(next)) continue;
      const edge =
        current >= 2 && next >= 2
          ? graph.costs[current - 2][next - 2]
          : hasLineOfSight(map, nodes[current], nodes[next])
            ? distance(nodes[current], nodes[next])
            : Infinity;
      const cost = costs[current] + edge;
      if (cost < costs[next]) {
        costs[next] = cost;
        previous[next] = current;
      }
    }
  }
}

/** Consumes validated waypoints only; callers obtain those from findPath. */
export function moveAlongPath(
  position: Point,
  path: Point[],
  distanceBudget: number,
): { position: Point; path: Point[]; travelled: number } {
  if (!validPoint(position) || path.some((point) => !validPoint(point))) {
    throw new RangeError('Map coordinates must be finite numbers');
  }
  if (!Number.isFinite(distanceBudget) || distanceBudget < 0) {
    throw new RangeError(
      'Movement distance budget must be finite and nonnegative',
    );
  }
  let current = { ...position };
  let remaining = distanceBudget;
  let index = 0;
  let travelled = 0;
  while (index < path.length) {
    const target = path[index];
    const length = distance(current, target);
    if (length === 0) {
      index++;
      continue;
    }
    if (remaining === 0) break;
    if (length <= remaining) {
      current = { ...target };
      remaining -= length;
      travelled += length;
      index++;
    } else {
      const fraction = remaining / length;
      current = {
        x: current.x + (target.x - current.x) * fraction,
        y: current.y + (target.y - current.y) * fraction,
      };
      travelled += remaining;
      remaining = 0;
      break;
    }
  }
  return {
    position: current,
    path: path.slice(index).map((point) => ({ ...point })),
    travelled,
  };
}
