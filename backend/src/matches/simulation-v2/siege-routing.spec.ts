import type { Lane, Point, Side } from './contracts';
import { createMap, distance, findPath, moveAlongPath } from './map-paths';
import { siegeWaypoint, type SiegeHazard } from './siege-routing';

function segmentDistance(from: Point, to: Point, point: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fraction = Math.max(
    0,
    Math.min(
      1,
      ((point.x - from.x) * dx + (point.y - from.y) * dy) /
        Math.max(1, dx * dx + dy * dy),
    ),
  );
  return distance(
    { x: from.x + dx * fraction, y: from.y + dy * fraction },
    point,
  );
}

describe('physical siege lane routing', () => {
  it.each([
    ['BLUE', 'TOP'],
    ['BLUE', 'BOT'],
    ['RED', 'TOP'],
    ['RED', 'BOT'],
  ] as Array<[Side, Lane]>)(
    '%s follows %s around live MID towers when walking from fountain to the enemy base',
    (side, lane) => {
      const input = { map: createMap() };
      const opposite = side === 'BLUE' ? 'RED' : 'BLUE';
      const destination = input.map.bases[opposite];
      const hazards: SiegeHazard[] = [
        { x: 5860, y: 4140 },
        { x: 7322, y: 2678 },
        { x: 8311, y: 1689 },
      ].map((position) => ({
        position:
          side === 'BLUE'
            ? position
            : { x: 10000 - position.x, y: 10000 - position.y },
        attackRange: 900,
      }));
      let position = { ...input.map.bases[side] };
      const initial = siegeWaypoint(
        input,
        position,
        side,
        lane,
        destination,
        hazards,
      );
      const route =
        side === 'BLUE'
          ? input.map.lanes[lane]
          : [...input.map.lanes[lane]].reverse();
      expect(initial).toEqual(route[1]);
      for (
        let step = 0;
        step < 60 && distance(position, destination) > 1;
        step++
      ) {
        const waypoint = siegeWaypoint(
          input,
          position,
          side,
          lane,
          destination,
          hazards,
        );
        const path = findPath(input.map, position, waypoint);
        expect(path).not.toBeNull();
        const moved = moveAlongPath(position, path!, 400);
        expect(moved.travelled).toBeGreaterThan(0);
        for (const hazard of hazards)
          expect(
            segmentDistance(position, moved.position, hazard.position),
          ).toBeGreaterThan(hazard.attackRange);
        position = moved.position;
      }
      expect(position).toEqual(destination);
    },
  );

  it('uses an accessible local target without walking back to an earlier lane corner', () => {
    const input = { map: createMap() };
    const actor = { x: 8700, y: 1000 };
    const destination = { x: 8836, y: 924 };
    expect(
      siegeWaypoint(input, actor, 'BLUE', 'TOP', destination, [
        { position: { x: 7322, y: 2678 }, attackRange: 900 },
      ]),
    ).toEqual(destination);
  });

  it('detours around an unprotected neighboring turret even for a local destination', () => {
    const input = { map: createMap() };
    const actor = { x: 700, y: 2500 };
    const destination = { x: 700, y: 1800 };
    const hazard = { position: { x: 700, y: 2150 }, attackRange: 100 };
    const next = siegeWaypoint(input, actor, 'BLUE', 'TOP', destination, [
      hazard,
    ]);
    expect(next).not.toEqual(destination);
    expect(distance(next, actor)).toBeGreaterThan(0);
    expect(segmentDistance(actor, next, hazard.position)).toBeGreaterThan(
      hazard.attackRange + 90,
    );
  });

  it('allows a direct escape that moves outward from an existing turret danger circle', () => {
    const input = { map: createMap() };
    const actor = { x: 700, y: 2300 };
    const destination = { x: 700, y: 3000 };
    expect(
      siegeWaypoint(input, actor, 'BLUE', 'TOP', destination, [
        { position: { x: 700, y: 2150 }, attackRange: 100 },
      ]),
    ).toEqual(destination);
  });

  it('keeps a safe direct rotation and does not mutate caller data', () => {
    const input = { map: createMap() };
    const actor = { x: 700, y: 5000 };
    const destination = { x: 5492, y: 700 };
    const hazards = [{ position: { x: 9300, y: 4508 }, attackRange: 900 }];
    const before = JSON.stringify({ input, actor, destination, hazards });
    const next = siegeWaypoint(
      input,
      actor,
      'BLUE',
      'TOP',
      destination,
      hazards,
    );
    expect(next).toEqual(destination);
    next.x = 0;
    expect(JSON.stringify({ input, actor, destination, hazards })).toBe(before);
  });

  it('rejoins the nearest safe lane segment from the jungle before advancing', () => {
    const input = { map: createMap() };
    const actor = { x: 3500, y: 4500 };
    const destination = input.map.bases.RED;
    const hazards = [
      { position: { x: 5860, y: 4140 }, attackRange: 900 },
      { position: { x: 7322, y: 2678 }, attackRange: 900 },
    ];
    const next = siegeWaypoint(
      input,
      actor,
      'BLUE',
      'TOP',
      destination,
      hazards,
    );
    expect(next).toEqual({ x: 700, y: 4500 });
    expect(findPath(input.map, actor, next)).not.toBeNull();
  });
});
