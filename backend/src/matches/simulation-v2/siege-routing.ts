import type { EngineInput, Lane, Point, Side } from './contracts';
import { distance, findPath } from './map-paths';

/** Public, active enemy turrets that have no friendly wave protecting this route. */
export interface SiegeHazard {
  position: Point;
  attackRange: number;
}

const ARRIVAL_TOLERANCE = 50;
const TURRET_CLEARANCE = 90;

function projection(from: Point, to: Point, point: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const squared = dx * dx + dy * dy;
  return squared
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - from.x) * dx + (point.y - from.y) * dy) / squared,
        ),
      )
    : 0;
}

function between(from: Point, to: Point, fraction: number): Point {
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
  };
}

/** Recheck a persisted physical route against the current public tower hazards. */
export function isSiegePathSafe(
  origin: Point,
  path: readonly Point[],
  hazards: readonly SiegeHazard[],
): boolean {
  let from = origin;
  for (const to of path) {
    for (const hazard of hazards) {
      const radius = hazard.attackRange + TURRET_CLEARANCE;
      const nearest = projection(from, to, hazard.position);
      if (distance(between(from, to, nearest), hazard.position) >= radius)
        continue;
      // An actor already inside a danger circle may leave it, but cannot route
      // deeper through that turret to reach a different lane.
      if (
        distance(from, hazard.position) < radius &&
        nearest === 0 &&
        distance(to, hazard.position) > distance(from, hazard.position)
      )
        continue;
      return false;
    }
    from = to;
  }
  return true;
}

function avoidingPath(
  input: Pick<EngineInput, 'map'>,
  from: Point,
  to: Point,
  hazards: readonly SiegeHazard[],
): Point[] | null {
  const ordinary = findPath(input.map, from, to);
  if (ordinary && isSiegePathSafe(from, ordinary, hazards)) return ordinary;
  // A lane can graze a neighboring base tower. Try physical points around its
  // danger circle and validate both legs against the real walls and all towers.
  const detours = hazards
    .flatMap((hazard) =>
      Array.from({ length: 8 }, (_, index) => {
        const angle = (index * Math.PI) / 4;
        const radius = hazard.attackRange + TURRET_CLEARANCE + 50;
        return {
          x: hazard.position.x + Math.cos(angle) * radius,
          y: hazard.position.y + Math.sin(angle) * radius,
        };
      }),
    )
    .map((point) => {
      const first = findPath(input.map, from, point);
      const second = findPath(input.map, point, to);
      const path = first && second ? [...first, ...second] : null;
      return {
        path,
        length:
          path?.reduce(
            (sum, next, index) =>
              sum + distance(index ? path[index - 1] : from, next),
            0,
          ) ?? Infinity,
      };
    })
    .filter(
      (detour) => detour.path && isSiegePathSafe(from, detour.path, hazards),
    )
    .sort((a, b) => a.length - b.length);
  return detours[0]?.path ?? null;
}

/**
 * One physical waypoint for a siege rotation. A safe shortcut is permitted;
 * otherwise enter the assigned lane and follow its corners instead of walking
 * from fountain through still-standing towers in another lane. The caller owns
 * local fighting/retreat decisions and excludes wave-protected turret hazards.
 */
export function siegeWaypoint(
  input: Pick<EngineInput, 'map'>,
  actorPoint: Point,
  side: Side,
  lane: Lane,
  destination: Point,
  hazards: readonly SiegeHazard[] = [],
): Point {
  const direct = findPath(input.map, actorPoint, destination);
  if (direct && isSiegePathSafe(actorPoint, direct, hazards))
    return { ...destination };

  const route =
    side === 'BLUE'
      ? input.map.lanes[lane]
      : [...input.map.lanes[lane]].reverse();
  let progress = 0;
  const segments = route.slice(1).map((to, index) => {
    const from = route[index];
    const length = distance(from, to);
    const segment = { from, to, length, progress };
    progress += length;
    return segment;
  });
  const goal = segments
    .map((segment) => {
      const fraction = projection(segment.from, segment.to, destination);
      const point = between(segment.from, segment.to, fraction);
      return {
        point,
        progress: segment.progress + segment.length * fraction,
        separation: distance(point, destination),
      };
    })
    .sort((a, b) => a.separation - b.separation)[0];
  if (!goal) return { ...actorPoint };

  const candidates = segments
    .filter((segment) => segment.progress <= goal.progress)
    .flatMap((segment) => {
      const maxFraction = segment.length
        ? Math.min(1, (goal.progress - segment.progress) / segment.length)
        : 0;
      const fraction = Math.min(
        maxFraction,
        projection(segment.from, segment.to, actorPoint),
      );
      return [0, fraction, maxFraction].map((value) => ({
        point: between(segment.from, segment.to, value),
        progress: segment.progress + segment.length * value,
      }));
    })
    .map((entry) => {
      const path = findPath(input.map, actorPoint, entry.point);
      return {
        ...entry,
        path,
        travel:
          path?.reduce(
            (sum, point, index) =>
              sum + distance(index ? path[index - 1] : actorPoint, point),
            0,
          ) ?? Infinity,
      };
    })
    .filter(
      (entry) => entry.path && isSiegePathSafe(actorPoint, entry.path, hazards),
    )
    .sort((a, b) => a.travel - b.travel || b.progress - a.progress);
  const entry = candidates[0];
  if (!entry) return { ...actorPoint };
  if (entry.travel > ARRIVAL_TOLERANCE) return { ...entry.path![0] };

  const forward = segments.find(
    (segment) =>
      segment.progress + segment.length > entry.progress + ARRIVAL_TOLERANCE &&
      segment.progress + segment.length < goal.progress - ARRIVAL_TOLERANCE,
  );
  const next = forward?.to ?? goal.point;
  const nextPath = avoidingPath(input, actorPoint, next, hazards);
  if (nextPath?.length) return { ...nextPath[0] };
  return { ...actorPoint };
}
