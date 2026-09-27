import {
  actorLane,
  type ActorPlan,
  type ActorState,
  type EngineInput,
  type Intent,
  type Lane,
  type Observation,
  type Point,
  type UnitView,
} from './contracts';
import { distance, findPath, isWalkable } from './map-paths';
import { getCampDefinitions } from './resources';
import { nextRandom, type RandomStreams } from './seeded-rng';

type Choice = { intent: Intent; plan: ActorPlan };
const live = (unit: UnitView | ActorState) => unit.active && unit.hp > 0;
const health = (unit: UnitView | ActorState) =>
  unit.hp / Math.max(1, unit.maxHp);
const resource = (actor: ActorState) =>
  actor.maxMana > 0 ? actor.mana / actor.maxMana : 1;

function laneGeometry(points: Point[], point: Point) {
  const segments = points.slice(1).map((to, index) => ({
    from: points[index],
    to,
    length: distance(points[index], to),
  }));
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  let offset = 0;
  let closest = { distance: Infinity, progress: 0 };
  for (const segment of segments) {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const fraction =
      segment.length === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - segment.from.x) * dx +
                (point.y - segment.from.y) * dy) /
                (segment.length * segment.length),
            ),
          );
    const projected = {
      x: segment.from.x + dx * fraction,
      y: segment.from.y + dy * fraction,
    };
    const separation = distance(point, projected);
    if (separation < closest.distance)
      closest = {
        distance: separation,
        progress: length ? (offset + segment.length * fraction) / length : 0,
      };
    offset += segment.length;
  }
  return { ...closest, length };
}

function pointOnLane(points: Point[], fraction: number): Point {
  let remaining =
    points
      .slice(1)
      .reduce((sum, point, index) => sum + distance(points[index], point), 0) *
    fraction;
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (remaining <= length && length > 0)
      return {
        x:
          points[i - 1].x +
          ((points[i].x - points[i - 1].x) * remaining) / length,
        y:
          points[i - 1].y +
          ((points[i].y - points[i - 1].y) * remaining) / length,
      };
    remaining -= length;
  }
  return { ...points.at(-1)! };
}

function laneOf(input: EngineInput, point: Point): Lane {
  return (['TOP', 'MID', 'BOT'] as const)
    .map((lane) => ({
      lane,
      separation: laneGeometry(input.map.lanes[lane], point).distance,
    }))
    .sort((a, b) => a.separation - b.separation)[0].lane;
}

function approachLaneProgress(
  input: EngineInput,
  actor: ActorState,
  ownProgress: number,
): Point {
  const route = input.map.lanes[actorLane(actor.input.position)];
  const targetFraction = actor.side === 'BLUE' ? ownProgress : 1 - ownProgress;
  const projection = laneGeometry(route, actor.position);
  let progress = 0;
  const vertices = route.map((point, index) => {
    if (index > 0)
      progress += distance(route[index - 1], point) / projection.length;
    return { point, progress };
  });
  const forward = targetFraction >= projection.progress;
  // Both advancing and returning follow lane corners instead of a jungle chord.
  for (const vertex of forward ? vertices : [...vertices].reverse()) {
    if (
      forward
        ? vertex.progress > projection.progress + 0.008 &&
          vertex.progress < targetFraction
        : vertex.progress < projection.progress - 0.008 &&
          vertex.progress > targetFraction
    ) {
      return { ...vertex.point };
    }
  }
  return pointOnLane(route, targetFraction);
}

function farmAnchor(input: EngineInput, actor: ActorState): Point {
  return approachLaneProgress(input, actor, 0.48);
}

function notDeep(input: EngineInput, actor: ActorState, point: Point): boolean {
  const lane = laneOf(input, point);
  const projection = laneGeometry(input.map.lanes[lane], point);
  // Towers are not implemented in this laboratory. Never claim safe deep dives.
  return actor.side === 'BLUE'
    ? projection.progress <= 0.59
    : projection.progress >= 0.41;
}

function makeChoice(
  actor: ActorState,
  now: number,
  kind: ActorPlan['kind'],
  point: Point,
  reason: string,
  intentKind: Intent['kind'],
  targetId: string | null = null,
  lifetimeMs = 8000,
): Choice {
  const plan: ActorPlan = {
    kind,
    point: { ...point },
    targetId,
    reason,
    createdAtMs: now,
    expiresAtMs: now + lifetimeMs,
  };
  let intent: Intent;
  if (intentKind === 'MOVE')
    intent = { kind: 'MOVE', actorId: actor.id, point: { ...point }, reason };
  else if (intentKind === 'ATTACK' && targetId !== null)
    intent = { kind: 'ATTACK', actorId: actor.id, targetId, reason };
  else if (intentKind === 'RECALL')
    intent = { kind: 'RECALL', actorId: actor.id, reason };
  else intent = { kind: 'HOLD', actorId: actor.id, reason };
  return { intent, plan };
}

function reachableMove(
  input: EngineInput,
  actor: ActorState,
  now: number,
  kind: ActorPlan['kind'],
  point: Point,
  reason: string,
  targetId: string | null = null,
): Choice {
  const path = findPath(input.map, actor.position, point);
  return path === null
    ? makeChoice(
        actor,
        now,
        kind,
        actor.position,
        `${reason}; no legal route, re-evaluate`,
        'HOLD',
        targetId,
        1000,
      )
    : makeChoice(
        actor,
        now,
        kind,
        point,
        reason,
        distance(actor.position, point) <= 30 ? 'HOLD' : 'MOVE',
        targetId,
      );
}

function recover(
  actor: ActorState,
  observation: Observation,
  input: EngineInput,
  enemies: UnitView[],
): Choice | null {
  const now = observation.atMs;
  const base = input.map.bases[actor.side];
  const nearBase = distance(actor.position, base) <= input.rules.fountainRadius;
  if (nearBase && (health(actor) < 0.98 || resource(actor) < 0.95)) {
    return makeChoice(
      actor,
      now,
      'RECOVER',
      base,
      'Fountain: wait for health/resource recovery before returning',
      'HOLD',
    );
  }
  const dangerous = enemies.filter(
    (enemy) =>
      distance(enemy.position, actor.position) <= enemy.attackRange + 450,
  );
  const support = observation.allies.filter(
    (ally) => live(ally) && distance(ally.position, actor.position) < 1200,
  );
  const overwhelmed = dangerous.length > support.length && health(actor) < 0.72;
  const low =
    health(actor) < 0.36 - actor.input.risk * 0.1 ||
    (resource(actor) < 0.08 && health(actor) < 0.62);
  if (!low && !overwhelmed) return null;
  if (nearBase)
    return makeChoice(
      actor,
      now,
      'RECOVER',
      base,
      'Recover in fountain',
      'HOLD',
    );
  const recentlyHit =
    actor.lastDamagedAtMs !== null && now - actor.lastDamagedAtMs < 3000;
  if (!dangerous.length && !recentlyHit) {
    return makeChoice(
      actor,
      now,
      'RECOVER',
      base,
      'Low health/resource; observed area safe enough to channel recall',
      'RECALL',
    );
  }
  const path = findPath(input.map, actor.position, base);
  const retreatPoint = path?.[0] ?? actor.position;
  return reachableMove(
    input,
    actor,
    now,
    'RETREAT',
    retreatPoint,
    `Disengage before recall: ${dangerous.length} observed threats, recent damage ${recentlyHit}`,
  );
}

function nearbyWave(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
) {
  return observedLaneWave(observation, input, actor).filter(
    (unit) => distance(unit.position, actor.position) <= 1400,
  );
}

function friendlyLaneWave(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
) {
  const route = input.map.lanes[actorLane(actor.input.position)];
  return (observation.friendlyMinions ?? []).filter(
    (unit) =>
      live(unit) &&
      unit.kind === 'MINION' &&
      unit.side === actor.side &&
      laneGeometry(route, unit.position).distance < 650,
  );
}

function relativeLaneProgress(
  input: EngineInput,
  actor: ActorState,
  point: Point,
): number {
  const progress = laneGeometry(
    input.map.lanes[actorLane(actor.input.position)],
    point,
  ).progress;
  return actor.side === 'BLUE' ? progress : 1 - progress;
}

function farmingAdvanceLimit(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
): number {
  const friendly = friendlyLaneWave(observation, input, actor);
  // This is an operating boundary for a structure-less lab, not a turret-safety claim.
  // Advance with an actual friendly wave, never by elapsed time or hidden enemy units.
  const front = friendly.reduce(
    (progress, unit) =>
      Math.max(progress, relativeLaneProgress(input, actor, unit.position)),
    0,
  );
  return Math.min(0.74, Math.max(0.52, front + 0.03));
}

function canApproachFarmPoint(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
  point: Point,
  advanceLimit = farmingAdvanceLimit(observation, input, actor),
): boolean {
  if (relativeLaneProgress(input, actor, point) > advanceLimit) return false;
  const opposingSide = actor.side === 'BLUE' ? 'RED' : 'BLUE';
  if (distance(point, input.map.bases[opposingSide]) < 2200) return false;
  const threats = observation.visible.filter(
    (unit) =>
      live(unit) &&
      unit.kind === 'CHAMPION' &&
      unit.side !== actor.side &&
      distance(unit.position, point) < 1200,
  );
  const helpers = observation.allies.filter(
    (ally) =>
      live(ally) &&
      ally.id !== actor.id &&
      ally.action.kind !== 'RECALL' &&
      distance(ally.position, point) < 1300,
  );
  // Own arrival is a plan, not immediate combat contribution. Avoid unsupported
  // forward moves against a visible numerical disadvantage or low-health duel.
  return (
    relativeLaneProgress(input, actor, point) <=
      relativeLaneProgress(input, actor, actor.position) ||
    (threats.length <= helpers.length + 1 &&
      (threats.length === 0 || health(actor) >= 0.6))
  );
}

function observedLaneWave(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
) {
  const lane = actorLane(actor.input.position);
  const advanceLimit = farmingAdvanceLimit(observation, input, actor);
  return observation.visible.filter(
    (unit) =>
      live(unit) &&
      unit.kind === 'MINION' &&
      unit.side !== actor.side &&
      laneGeometry(input.map.lanes[lane], unit.position).distance < 650 &&
      canApproachFarmPoint(
        observation,
        input,
        actor,
        unit.position,
        advanceLimit,
      ),
  );
}

function followWave(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
): Choice | null {
  const remote = observedLaneWave(observation, input, actor)
    .filter((unit) => distance(unit.position, actor.position) > 1400)
    .sort(
      (a, b) =>
        distance(actor.position, a.position) -
          distance(actor.position, b.position) || a.id.localeCompare(b.id),
    )[0];
  if (remote) {
    const laneLength = laneGeometry(
      input.map.lanes[actorLane(actor.input.position)],
      remote.position,
    ).length;
    const progress = Math.max(
      0.05,
      relativeLaneProgress(input, actor, remote.position) -
        (actor.attackRange * 0.6) / laneLength,
    );
    return reachableMove(
      input,
      actor,
      observation.atMs,
      'LANE',
      approachLaneProgress(input, actor, progress),
      'Rejoin observed lane wave through shared vision; walk before farming, no remote CS',
      remote.id,
    );
  }
  const front = friendlyLaneWave(observation, input, actor).sort(
    (a, b) =>
      relativeLaneProgress(input, actor, b.position) -
      relativeLaneProgress(input, actor, a.position),
  )[0];
  if (!front) return null;
  const progress = Math.min(
    farmingAdvanceLimit(observation, input, actor),
    Math.max(0.48, relativeLaneProgress(input, actor, front.position) - 0.015),
  );
  const point = pointOnLane(
    input.map.lanes[actorLane(actor.input.position)],
    actor.side === 'BLUE' ? progress : 1 - progress,
  );
  if (
    !canApproachFarmPoint(observation, input, actor, point) ||
    distance(point, actor.position) < 40
  )
    return null;
  return reachableMove(
    input,
    actor,
    observation.atMs,
    'LANE',
    approachLaneProgress(input, actor, progress),
    'Escort the observed friendly lane wave; locate its next farming contest',
    front.id,
  );
}

function resetDuringWaveGap(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
  enemies: UnitView[],
): Choice | null {
  const base = input.map.bases[actor.side];
  if (distance(actor.position, base) <= input.rules.fountainRadius) return null;
  const cheapest = input.rules.items
    .filter((item) => !actor.items.includes(item.id))
    .reduce((cost, item) => Math.min(cost, item.cost), Infinity);
  // Bridge the gap between the emergency-recall threshold and the health needed
  // for a forward contested wave. Do not stand idle forever at 30..60% health.
  const needsReset =
    health(actor) < 0.6 || resource(actor) < 0.15 || actor.gold >= cheapest * 2;
  if (!needsReset) return null;
  const threatened = enemies.some(
    (enemy) =>
      distance(enemy.position, actor.position) <= enemy.attackRange + 450,
  );
  const recentlyHit =
    actor.lastDamagedAtMs !== null &&
    observation.atMs - actor.lastDamagedAtMs < 3000;
  if (threatened || recentlyHit) {
    const path = findPath(input.map, actor.position, base);
    return reachableMove(
      input,
      actor,
      observation.atMs,
      'RETREAT',
      path?.[0] ?? actor.position,
      'No accessible farming window and recovery needed; disengage before channeling',
    );
  }
  return makeChoice(
    actor,
    observation.atMs,
    'RECOVER',
    base,
    'No accessible farming window; recall to recover or purchase before the next wave',
    'RECALL',
  );
}

function gankChoice(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
  enemies: UnitView[],
  noise: number,
): Choice | null {
  const role = actor.input.position;
  if (
    !['JUNGLE', 'MID', 'SUPPORT'].includes(role) ||
    health(actor) < 0.58 ||
    resource(actor) < 0.2
  )
    return null;
  const wave = nearbyWave(observation, input, actor);
  const isJungle = role === 'JUNGLE';
  if (!isJungle && wave.length >= 3) return null;
  const strategy =
    input.teams.find((team) => team.side === actor.side)?.strategy ?? '';
  const preferred = strategy.includes('TOP')
    ? 'TOP'
    : strategy.includes('BOT')
      ? 'BOT'
      : strategy.includes('MID')
        ? 'MID'
        : null;
  const nearbyCamp = observation.visible.find(
    (unit) =>
      unit.kind === 'CAMP' &&
      live(unit) &&
      distance(unit.position, actor.position) < actor.attackRange + 100,
  );
  const campCost = nearbyCamp && health(nearbyCamp) < 0.4 ? 80 : 0;
  const candidates = enemies
    .filter((enemy) => notDeep(input, actor, enemy.position))
    .map((enemy) => {
      const travel = distance(actor.position, enemy.position);
      const helpers = observation.allies.filter(
        (ally) =>
          ally.id !== actor.id &&
          live(ally) &&
          health(ally) > 0.3 &&
          ally.action.kind !== 'RECALL' &&
          distance(ally.position, enemy.position) < 1200,
      );
      const defenders = enemies.filter(
        (other) => distance(other.position, enemy.position) < 1100,
      );
      const pressured = helpers.some(
        (ally) =>
          ally.lastDamagedAtMs !== null &&
          observation.atMs - ally.lastDamagedAtMs < 5000,
      );
      const numbers = helpers.length + 1 - defenders.length;
      const lane = laneOf(input, enemy.position);
      let score =
        85 +
        (1 - health(enemy)) * 60 +
        Math.min(2, numbers) * 25 +
        (pressured ? 30 : 0) +
        (preferred === lane ? 18 : 0) +
        actor.input.teamwork * 10 +
        (noise - 0.5) * 8 -
        (travel / Math.max(1, actor.moveSpeed)) * 4 -
        wave.length * 25 -
        campCost;
      if (!helpers.length || numbers < 0 || travel > (isJungle ? 2500 : 1600))
        score = -Infinity;
      if (role === 'SUPPORT' && lane !== 'BOT') {
        const adc = observation.allies.find(
          (ally) => ally.input.position === 'ADC' && live(ally),
        );
        if (
          !adc ||
          health(adc) < 0.7 ||
          enemies.some((other) => distance(other.position, adc.position) < 1400)
        )
          score = -Infinity;
      }
      return { enemy, score, pressured, helpers: helpers.length, numbers };
    })
    .sort((a, b) => b.score - a.score || a.enemy.id.localeCompare(b.enemy.id));
  const prior = actor.plan;
  const retained =
    prior &&
    (prior.kind === 'GANK' || prior.kind === 'COVER') &&
    prior.expiresAtMs > observation.atMs
      ? candidates.find(
          (candidate) =>
            candidate.enemy.id === prior.targetId && candidate.score > 45,
        )
      : null;
  const best = retained ?? candidates[0];
  if (!best || best.score < (retained ? 45 : 85)) return null;
  const choice = makeChoice(
    actor,
    observation.atMs,
    best.pressured ? 'COVER' : 'GANK',
    best.enemy.position,
    `Observed ${best.pressured ? 'ally pressure/counter-gank' : 'gank window'}: ${best.helpers} nearby allies, number margin ${best.numbers}, wave cost ${wave.length}, score ${best.score.toFixed(1)}`,
    'ATTACK',
    best.enemy.id,
  );
  if (retained && prior) {
    choice.plan.createdAtMs = prior.createdAtMs;
    choice.plan.expiresAtMs = prior.expiresAtMs;
  }
  return choice;
}

function jungleChoice(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
): Choice {
  const camps = getCampDefinitions(input.map, input.rules).filter(
    (camp) => camp.side === actor.side,
  );
  const known = new Map(
    observation.remembered.map((entry) => [entry.unit.id, entry]),
  );
  for (const unit of observation.visible)
    known.set(unit.id, { atMs: observation.atMs, unit });
  const candidates = camps
    .map((camp) => {
      const observationEntry = known.get(camp.id);
      const visible = observation.visible.find((unit) => unit.id === camp.id);
      const unavailableUntil =
        observation.atMs < camp.spawnAtMs
          ? camp.spawnAtMs
          : observationEntry && !live(observationEntry.unit)
            ? observationEntry.atMs + input.rules.campRespawnMs
            : observation.atMs;
      const travel =
        (distance(actor.position, camp.position) /
          Math.max(1, actor.moveSpeed)) *
        1000;
      const wait = Math.max(0, unavailableUntil - observation.atMs - travel);
      const retained =
        actor.plan?.kind === 'JUNGLE' &&
        actor.plan.targetId === camp.id &&
        actor.plan.expiresAtMs > observation.atMs &&
        !(visible && !live(visible) && observation.atMs >= camp.spawnAtMs);
      return {
        camp,
        visible,
        observationEntry,
        unavailableUntil,
        score: travel + wait * 1.2 - (retained ? 10_000 : 0),
      };
    })
    .sort((a, b) => a.score - b.score || a.camp.id.localeCompare(b.camp.id));
  const selected = candidates[0];
  if (!selected)
    return makeChoice(
      actor,
      observation.atMs,
      'JUNGLE',
      actor.position,
      'No configured reachable camp; wait and re-evaluate',
      'HOLD',
    );
  if (selected.visible && live(selected.visible))
    return makeChoice(
      actor,
      observation.atMs,
      'JUNGLE',
      selected.camp.position,
      'Clear observed living camp; rewards require actual combat resolution',
      'ATTACK',
      selected.camp.id,
      12_000,
    );
  const reason = selected.observationEntry
    ? `Camp last observed at ${selected.observationEntry.atMs}; estimated available ${selected.unavailableUntil}, no hidden camp state read`
    : `Explore public camp location; spawn schedule ${selected.camp.spawnAtMs}, current contents unknown`;
  return reachableMove(
    input,
    actor,
    observation.atMs,
    'JUNGLE',
    selected.camp.position,
    reason,
    selected.camp.id,
  );
}

function laneChoice(
  observation: Observation,
  input: EngineInput,
  actor: ActorState,
  enemies: UnitView[],
  noise: number,
): Choice {
  const wave = nearbyWave(observation, input, actor);
  const lane = actorLane(actor.input.position);
  const target = enemies
    .filter(
      (enemy) =>
        notDeep(input, actor, enemy.position) &&
        distance(actor.position, enemy.position) < actor.attackRange + 200 &&
        laneGeometry(input.map.lanes[lane], enemy.position).distance < 800 &&
        (wave.length <= 3 || health(enemy) < 0.45) &&
        health(actor) >
          health(enemy) * (0.72 + (1 - actor.input.aggression) * 0.22) &&
        noise < 0.3 + actor.input.aggression * 0.6,
    )
    .sort((a, b) => health(a) - health(b) || a.id.localeCompare(b.id))[0];
  if (target)
    return makeChoice(
      actor,
      observation.atMs,
      'LANE',
      target.position,
      `Local observed trade: health advantage, ${wave.length} nearby hostile minions`,
      'ATTACK',
      target.id,
    );
  const adcNearby =
    actor.input.position === 'SUPPORT' &&
    observation.allies.some(
      (ally) =>
        live(ally) &&
        ally.input.position === 'ADC' &&
        distance(ally.position, actor.position) < 1200,
    );
  const minion = wave
    .filter((unit) => !adcNearby || health(unit) > 0.5)
    .sort(
      (a, b) =>
        a.hp - b.hp ||
        distance(a.position, actor.position) -
          distance(b.position, actor.position) ||
        a.id.localeCompare(b.id),
    )[0];
  if (minion)
    return makeChoice(
      actor,
      observation.atMs,
      'LANE',
      minion.position,
      adcNearby
        ? 'Support wave pressure without taking low-health carry last hits'
        : 'Farm observed enemy wave; finite unit must die before CS/XP reward',
      'ATTACK',
      minion.id,
    );
  const waveMovement = followWave(observation, input, actor);
  if (waveMovement) return waveMovement;
  const reset = resetDuringWaveGap(observation, input, actor, enemies);
  if (reset) return reset;
  const anchor = farmAnchor(input, actor);
  return reachableMove(
    input,
    actor,
    observation.atMs,
    'LANE',
    anchor,
    'Maintain assigned lane and wait for a visible farming/trading opportunity',
  );
}

/** No WorldState access: decisions depend only on one team observation + pinned configuration. */
export function planActors(
  observation: Observation,
  input: EngineInput,
  rng: RandomStreams,
): { intents: Intent[]; plans: Record<string, ActorPlan> } {
  const intents: Intent[] = [];
  const plans: Record<string, ActorPlan> = {};
  const enemies = observation.visible.filter(
    (unit) =>
      unit.kind === 'CHAMPION' && unit.side !== observation.side && live(unit),
  );
  for (const actor of [...observation.allies].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    // Keep the draw schedule independent of hidden opposing death/recall states
    // when the engine calls the two team planners on one persisted stream.
    const noise = nextRandom(rng, 'decision');
    if (
      actor.side !== observation.side ||
      !live(actor) ||
      actor.action.kind === 'DEAD' ||
      actor.action.kind === 'RECALL'
    )
      continue;
    const choice =
      recover(actor, observation, input, enemies) ??
      gankChoice(observation, input, actor, enemies, noise) ??
      (actor.input.position === 'JUNGLE'
        ? jungleChoice(observation, input, actor)
        : laneChoice(observation, input, actor, enemies, noise));
    if (!isWalkable(input.map, choice.plan.point)) {
      // Observation ingress may be malformed; do not turn it into illegal movement.
      const fallback = makeChoice(
        actor,
        observation.atMs,
        'LANE',
        actor.position,
        'Observed destination is blocked; re-evaluate',
        'HOLD',
        null,
        1000,
      );
      intents.push(fallback.intent);
      plans[actor.id] = fallback.plan;
    } else {
      intents.push(choice.intent);
      plans[actor.id] = choice.plan;
    }
  }
  return { intents, plans };
}
