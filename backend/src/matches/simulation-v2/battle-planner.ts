import {
  actorLane,
  opposite,
  type ActorPlan,
  type ActorState,
  type EngineInput,
  type EngineState,
  type Intent,
  type Lane,
  type Observation,
  type Point,
  type Side,
  type UnitView,
} from './contracts';
import { planActors } from './actor-planner';
import { distance, findPath, hasLineOfSight, isWalkable } from './map-paths';
import { canonicalHash, type RandomStreams } from './seeded-rng';
import { tacticalPolicy } from './tactics';
import { getActorActionSlots, isCasting, isStunned } from './effects';
import type { ObjectiveType, StructureType } from './environment-types';
import { isSiegePathSafe, siegeWaypoint } from './siege-routing';
import { coordinateMacro, coordinatedArrivalLimit } from './team-macro';

interface PublicStructure {
  id: string;
  side: Side;
  lane: Lane | null;
  position: Point;
  active: boolean;
  type: StructureType;
  prerequisiteIds: string[];
}
interface PublicObjective {
  id: string;
  type: ObjectiveType;
  position: Point;
  available: boolean;
  nextAtMs: number | null;
}
/** ONLY globally announced structure/objective lifecycle and the team's OWN cooldowns.
 * Enemy HP, movement, cooldowns, intentions and unseen camps never enter this boundary. */
export interface BattlePublicInformation {
  structures: PublicStructure[];
  objectives: PublicObjective[];
  /** Own surviving recipients only; a planning preference, not an extra combat buff. */
  siegeBuffUntilMs?: number;
  own: Record<
    string,
    {
      cooldowns: Record<string, number>;
      busy: boolean;
      wardCharges: number;
      scannerReady: boolean;
    }
  >;
}
export function battlePublicInformation(
  state: EngineState,
  side: Side,
): BattlePublicInformation {
  return {
    siegeBuffUntilMs: Math.max(
      0,
      ...(['baron', 'elder'] as const).map((buff) => {
        const team = state.environment?.teams[side];
        return team &&
          team[`${buff}Recipients`].some((id) =>
            state.actors.some((actor) => actor.id === id && actor.active),
          )
          ? team[`${buff}UntilMs`]
          : 0;
      }),
    ),
    structures: state.units
      .filter((unit) => unit.structure)
      .map((unit) => ({
        id: unit.id,
        side: unit.side!,
        lane: unit.lane,
        position: { ...unit.origin },
        active: unit.active,
        type: unit.structure!.type,
        prerequisiteIds: [...unit.structure!.prerequisiteIds],
      })),
    objectives: state.units
      .filter((unit) => unit.objective)
      .map((unit) => ({
        id: unit.id,
        type: unit.objective!.type,
        position: { ...unit.origin },
        available: unit.active,
        nextAtMs: unit.active
          ? state.simTimeMs
          : (unit.respawnAtMs ??
            (unit.generation === 0 &&
            (unit.objective!.despawnAtMs === null ||
              state.simTimeMs < unit.objective!.despawnAtMs)
              ? unit.objective!.type === 'ELDER'
                ? (state.environment?.elderAvailableAtMs ?? null)
                : unit.spawnAtMs
              : null)),
      })),
    own: Object.fromEntries(
      state.actors
        .filter((actor) => actor.side === side)
        .map((actor) => [
          actor.id,
          {
            cooldowns: { ...(state.combat?.cooldowns[actor.id] ?? {}) },
            busy:
              isCasting(state, actor.id) ||
              isStunned(state, actor.id) ||
              !!state.vision?.inventory[actor.id]?.placement,
            wardCharges: state.vision?.inventory[actor.id]?.charges ?? 0,
            scannerReady:
              !!state.vision &&
              (state.vision.inventory[actor.id]?.scanReadyAtMs ?? Infinity) <=
                state.simTimeMs,
          },
        ]),
    ),
  };
}
const alive = (unit: UnitView | ActorState) => unit.active && unit.hp > 0;
const hp = (unit: UnitView | ActorState) => unit.hp / Math.max(1, unit.maxHp);
const lanes: Lane[] = ['TOP', 'MID', 'BOT'];

function pointAt(points: Point[], fraction: number): Point {
  let remaining =
    points
      .slice(1)
      .reduce((sum, point, i) => sum + distance(points[i], point), 0) *
    fraction;
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (remaining <= length)
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
function choice(
  actor: ActorState,
  now: number,
  kind: ActorPlan['kind'],
  point: Point,
  reason: string,
  targetId?: string,
): { intent: Intent; plan: ActorPlan } {
  return {
    intent: targetId
      ? { kind: 'ATTACK', actorId: actor.id, targetId, reason }
      : { kind: 'MOVE', actorId: actor.id, point: { ...point }, reason },
    plan: {
      kind,
      point: { ...point },
      targetId: targetId ?? null,
      reason,
      createdAtMs: now,
      expiresAtMs: now + 8000,
    },
  };
}
function unlocked(
  structure: PublicStructure,
  publicInfo: BattlePublicInformation,
): boolean {
  return (
    structure.active &&
    !structure.prerequisiteIds.some((id) =>
      publicInfo.structures.some((other) => other.id === id && other.active),
    ) &&
    (!['NEXUS', 'NEXUS_TURRET'].includes(structure.type) ||
      publicInfo.structures.some(
        (other) =>
          other.side === structure.side &&
          other.type === 'INHIBITOR' &&
          !other.active,
      ))
  );
}
function reachable(input: EngineInput, start: Point, goal: Point): number {
  const path = findPath(input.map, start, goal);
  if (!path) return Infinity;
  return path.reduce(
    (sum, point, i) => sum + distance(i ? path[i - 1] : start, point),
    0,
  );
}
function safePoint(
  input: EngineInput,
  actor: ActorState,
  danger: Point,
  distanceToMove = 900,
): Point {
  const length = Math.max(1, distance(actor.position, danger));
  const point = {
    x:
      actor.position.x +
      ((actor.position.x - danger.x) * distanceToMove) / length,
    y:
      actor.position.y +
      ((actor.position.y - danger.y) * distanceToMove) / length,
  };
  return isWalkable(input.map, point) &&
    findPath(input.map, actor.position, point)
    ? point
    : { ...input.map.bases[actor.side] };
}

/** Local encounters, rotations, objective preparation and split pressure share ordinary actions.
 * No 14-minute teleport, all-team fight trigger, forced reward or hidden world lookup. */
export function planBattleActors(
  observation: Observation,
  input: EngineInput,
  rng: RandomStreams,
  info: BattlePublicInformation,
): { intents: Intent[]; plans: Record<string, ActorPlan> } {
  const result = planActors(observation, input, rng); // fixed actor RNG draw schedule; early lane/jungle fallback
  const now = observation.atMs;
  const visible = observation.visible.filter(alive);
  const enemies = visible.filter(
    (unit) =>
      unit.kind === 'CHAMPION' && unit.side === opposite(observation.side),
  );
  const allies = observation.allies.filter(alive);
  const waves = (observation.friendlyMinions ?? []).filter(alive);
  const targets = info.structures.filter(
    (unit) => unit.side !== observation.side && unlocked(unit, info),
  );
  const routeHazards = info.structures
    .filter(
      (unit) =>
        unit.side !== observation.side &&
        unit.active &&
        !['INHIBITOR', 'NEXUS'].includes(unit.type),
    )
    .map((unit) => ({
      position: unit.position,
      attackRange: input.rules.environment!.structures[unit.type].attackRange,
    }))
    .filter(
      (hazard) =>
        !waves.some(
          (wave) =>
            distance(wave.position, hazard.position) < hazard.attackRange,
        ),
    );
  const teamPolicy = tacticalPolicy(
    input,
    observation.allies[0].input,
    input.meta,
  );
  const structuralChange = info.structures.some(
    (unit) => unit.type === 'OUTER' && !unit.active,
  );
  const developed =
    allies.length > 0 &&
    allies.reduce((sum, actor) => sum + actor.level, 0) / allies.length >= 9;
  const macro = structuralChange || developed;
  const coordination = ['COORDINATED_V1', 'COORDINATED_V2'].includes(
    input.rules.macroAi ?? '',
  )
    ? coordinateMacro(observation, input, info, macro)
    : null;
  const laneScores = lanes
    .map((lane) => {
      const target =
        targets.find((unit) => unit.lane === lane) ??
        targets.find((unit) => unit.lane === null);
      const point = target?.position ?? pointAt(input.map.lanes[lane], 0.5);
      const pressure = waves.filter(
        (unit) => distance(unit.position, point) < 1800,
      ).length;
      const defenders = enemies.filter(
        (unit) => distance(unit.position, point) < 1800,
      ).length;
      const removed = info.structures.filter(
        (unit) =>
          unit.side !== observation.side && unit.lane === lane && !unit.active,
      ).length;
      // Stable seeded tie-break, never always BOT or a clock-based forced ending.
      const tie =
        parseInt(
          canonicalHash([input.seed, observation.side, lane]).slice(0, 4),
          16,
        ) / 65535;
      return {
        lane,
        target,
        point,
        score:
          teamPolicy.lanePriority[lane] * 2 +
          removed * 1.1 +
          pressure * 0.15 -
          defenders * 0.45 +
          tie * 0.35,
      };
    })
    .sort((a, b) => b.score - a.score);
  // A small visibility/wave fluctuation must not reverse a cross-map rotation.
  // Large pressure changes can still win the score comparison; danger is checked below.
  const lead = ['ADC', 'MID', 'SUPPORT']
    .map((position) =>
      allies.find((actor) => actor.input.position === position),
    )
    .find(
      (actor) =>
        actor?.plan?.siegeLane && actor.plan.siegeLane.expiresAtMs > now,
    );
  const previousLane = lead?.plan?.siegeLane;
  const heldLane = laneScores.find(
    (value) =>
      value.lane === previousLane?.lane &&
      value.target?.id === previousLane.targetId,
  );
  if (heldLane && laneScores[0].score - heldLane.score < 1) {
    laneScores.splice(laneScores.indexOf(heldLane), 1);
    laneScores.unshift(heldLane);
  }
  for (const actor of observation.allies) {
    if (!alive(actor) || actor.action.kind === 'RECALL') continue;
    if (info.own[actor.id]?.busy) {
      // The fallback already consumed this actor's fixed RNG draw. Do not
      // replace its persisted setup/siege plan while its actions are blocked.
      result.intents = result.intents.filter(
        (intent) => intent.actorId !== actor.id,
      );
      delete result.plans[actor.id];
      continue;
    }
    const policy = tacticalPolicy(input, actor.input, input.meta);
    const splitting = coordination
      ? coordination.splitActorId === actor.id
      : actor.input.position === 'TOP';
    const fallback = result.intents.find(
      (intent) => intent.actorId === actor.id,
    );
    if (!fallback) continue;
    // A channel at the fountain would postpone its ordinary recovery loop.
    // Do not override the early planner's HOLD/RECOVER with another recall.
    if (
      distance(actor.position, input.map.bases[actor.side]) <=
        input.rules.fountainRadius &&
      (hp(actor) < 0.98 ||
        (actor.maxMana > 0 && actor.mana / actor.maxMana < 0.95))
    )
      continue;
    const set = (value: ReturnType<typeof choice>) => {
      const index = result.intents.findIndex(
        (intent) => intent.actorId === actor.id,
      );
      result.intents[index] = value.intent;
      const backoff = result.plans[actor.id]?.objectiveBackoff;
      if (backoff && backoff.untilMs > now)
        value.plan.objectiveBackoff = { ...backoff };
      result.plans[actor.id] = value.plan;
    };
    const commitSiege = (
      value: ReturnType<typeof choice>,
      lane: Lane,
      targetId: string,
    ) => {
      const previous = actor.plan?.siegeLane;
      value.plan.siegeLane =
        previous &&
        previous.targetId === targetId &&
        previous.lane === lane &&
        previous.expiresAtMs > now
          ? { ...previous }
          : { lane, targetId, createdAtMs: now, expiresAtMs: now + 25_000 };
      if (['SIEGE', 'TRADE'].includes(value.plan.kind)) {
        const retainingWaypoint =
          value.intent.kind === 'MOVE' &&
          previous?.lane === lane &&
          previous.targetId === targetId &&
          previous.expiresAtMs > now &&
          actor.plan?.kind === value.plan.kind &&
          actor.action.kind === 'MOVE' &&
          actor.path.length > 0 &&
          distance(actor.position, actor.action.goal) > 80 &&
          isSiegePathSafe(actor.position, actor.path, routeHazards);
        const next =
          retainingWaypoint && actor.action.kind === 'MOVE'
            ? actor.action.goal
            : siegeWaypoint(
                input,
                actor.position,
                actor.side,
                lane,
                value.plan.point,
                routeHazards,
              );
        if (distance(next, value.plan.point) > 1) {
          value.plan.point = { ...next };
          value.intent =
            distance(next, actor.position) < 1
              ? {
                  kind: 'HOLD',
                  actorId: actor.id,
                  reason: 'Wait for a safe lane approach or wave',
                }
              : {
                  kind: 'MOVE',
                  actorId: actor.id,
                  point: { ...next },
                  reason: value.plan.reason,
                };
        }
      }
      set(value);
    };
    const localEnemies = enemies.filter(
      (unit) => distance(actor.position, unit.position) < 1500,
    );
    const localAllies = allies.filter(
      (unit) => distance(actor.position, unit.position) < 1500,
    );
    const dangerTower = info.structures.find(
      (unit) =>
        unit.side !== actor.side &&
        unit.active &&
        unit.type !== 'INHIBITOR' &&
        unit.type !== 'NEXUS' &&
        distance(actor.position, unit.position) <
          input.rules.environment!.structures[unit.type].attackRange + 90 &&
        !waves.some(
          (minion) =>
            distance(minion.position, unit.position) <
            input.rules.environment!.structures[unit.type].attackRange,
        ),
    );
    const baseThreat = info.structures.find(
      (unit) =>
        unit.side === actor.side &&
        ['NEXUS', 'NEXUS_TURRET'].includes(unit.type) &&
        unit.active &&
        visible.some(
          (enemy) =>
            enemy.side !== actor.side &&
            enemy.side !== null &&
            distance(enemy.position, unit.position) < 1000,
        ),
    );
    const baseAttackers = baseThreat
      ? visible.filter(
          (enemy) =>
            enemy.side === opposite(actor.side) &&
            distance(enemy.position, baseThreat.position) < 1200,
        )
      : [];
    const baseDefenders = baseThreat
      ? [...allies]
          .sort(
            (a, b) =>
              distance(a.position, baseThreat.position) -
              distance(b.position, baseThreat.position),
          )
          .slice(
            0,
            baseAttackers.some((enemy) => enemy.kind === 'CHAMPION') ? 5 : 2,
          )
      : [];
    const desperate = baseDefenders.some(
      (defender) => defender.id === actor.id,
    );
    if (hp(actor) < policy.retreatThreshold || (dangerTower && !desperate)) {
      if (dangerTower)
        set(
          choice(
            actor,
            now,
            'RETREAT',
            safePoint(input, actor, dangerTower.position),
            'Disengage: no allied wave to absorb turret attacks',
          ),
        );
      else if (
        !localEnemies.length &&
        (actor.lastDamagedAtMs === null || now - actor.lastDamagedAtMs >= 3000)
      ) {
        result.intents[
          result.intents.findIndex((intent) => intent.actorId === actor.id)
        ] = {
          kind: 'RECALL',
          actorId: actor.id,
          reason: 'Low-health macro recovery',
        };
      } else if (localEnemies.length)
        set(
          choice(
            actor,
            now,
            'RETREAT',
            safePoint(input, actor, localEnemies[0].position),
            'Low-health disengage before recall',
          ),
        );
      // Existing recovery rule has a real recall/walk, no instantaneous regeneration.
      continue;
    }
    const localEnemyPower = localEnemies.reduce(
      (sum, unit) => sum + hp(unit),
      0,
    );
    const localAllyPower = localAllies.reduce((sum, unit) => sum + hp(unit), 0);
    if (
      !desperate &&
      localEnemyPower > localAllyPower * 1.35 &&
      localEnemies.length
    ) {
      set(
        choice(
          actor,
          now,
          'RETREAT',
          safePoint(input, actor, localEnemies[0].position),
          'Disengage local outnumber: observed arrivals beat available allies',
        ),
      );
      continue;
    }
    const slots = input.rules.abilities?.enabled
      ? getActorActionSlots(actor.input)
      : [];
    const usable = (slot: (typeof slots)[number]) =>
      actor.mana >= slot.mana &&
      (info.own[actor.id]?.cooldowns[slot.id] ?? 0) <= now;
    const guard = slots.find((slot) => slot.kind === 'SHIELD' && usable(slot));
    const hurt = allies
      .filter(
        (ally) =>
          hp(ally) < 0.65 &&
          distance(actor.position, ally.position) < (guard?.range ?? 0) &&
          enemies.some(
            (enemy) => distance(enemy.position, ally.position) < 1100,
          ),
      )
      .sort((a, b) => hp(a) - hp(b))[0];
    if (guard && hurt) {
      set(
        choice(
          actor,
          now,
          'COVER',
          hurt.position,
          'Protect an observed ally before the next damage window',
          hurt.id,
        ),
      );
      result.intents[
        result.intents.findIndex((intent) => intent.actorId === actor.id)
      ] = {
        kind: 'CAST',
        actorId: actor.id,
        slotId: guard.id,
        targetId: hurt.id,
        reason: 'Timed protection',
      };
      continue;
    }
    const exposedEnd = targets
      .filter(
        (target) =>
          ['NEXUS', 'NEXUS_TURRET'].includes(target.type) &&
          visible.some((unit) => unit.id === target.id) &&
          distance(actor.position, target.position) < 1800 &&
          waves.some((wave) => distance(wave.position, target.position) < 1000),
      )
      .sort(
        (a, b) =>
          Number(b.type === 'NEXUS') - Number(a.type === 'NEXUS') ||
          distance(actor.position, a.position) -
            distance(actor.position, b.position),
      )[0];
    if (
      !desperate &&
      exposedEnd &&
      hp(actor) > 0.5 &&
      localAllyPower >= localEnemyPower * 0.9
    ) {
      set(
        choice(
          actor,
          now,
          'SIEGE',
          exposedEnd.position,
          'Convert observed base opening: wave arrived and defenses unlocked',
          exposedEnd.id,
        ),
      );
      continue;
    }
    const conversion = targets
      .map((target) => ({
        target,
        seen: visible.find((unit) => unit.id === target.id),
      }))
      .filter(
        ({ target, seen }) =>
          seen &&
          target.lane !== null &&
          distance(actor.position, target.position) <=
            Math.max(850, actor.attackRange + 150) &&
          waves.some((wave) => distance(wave.position, target.position) < 850),
      )
      .sort((a, b) => a.seen!.hp - b.seen!.hp)[0];
    if (
      !desperate &&
      conversion &&
      hp(actor) > 0.5 &&
      localAllyPower >= localEnemyPower &&
      (conversion.seen!.hp <= actor.attackDamage * 3 ||
        (info.siegeBuffUntilMs ?? 0) > now ||
        localEnemies.length === 0)
    ) {
      commitSiege(
        choice(
          actor,
          now,
          'SIEGE',
          conversion.target.position,
          'Convert the arrived siege wave before chasing or starting another objective',
          conversion.target.id,
        ),
        conversion.target.lane!,
        conversion.target.id,
      );
      continue;
    }
    const threat = localEnemies
      .filter(
        (unit) =>
          distance(actor.position, unit.position) <
            Math.max(actor.attackRange + 200, 800) &&
          !info.structures.some(
            (tower) =>
              tower.side !== actor.side &&
              tower.active &&
              tower.type !== 'INHIBITOR' &&
              tower.type !== 'NEXUS' &&
              distance(unit.position, tower.position) < 700 &&
              !waves.some(
                (wave) => distance(wave.position, tower.position) < 850,
              ),
          ),
      )
      .sort(
        (a, b) =>
          (coordination
            ? Number(b.id === coordination.focusTargetId) -
              Number(a.id === coordination.focusTargetId)
            : 0) ||
          hp(a) - hp(b) ||
          distance(actor.position, a.position) -
            distance(actor.position, b.position),
      )[0];
    if (threat && (desperate || localAllyPower >= localEnemyPower * 0.92)) {
      const spell = slots.find(
        (slot) =>
          ['CONTROL', 'DAMAGE'].includes(slot.kind) &&
          usable(slot) &&
          distance(actor.position, threat.position) <= slot.range &&
          hasLineOfSight(input.map, actor.position, threat.position),
      );
      set(
        choice(
          actor,
          now,
          desperate ? 'DEFEND' : 'GANK',
          threat.position,
          'Local fight: visible health, ally arrival and tower danger checked',
          threat.id,
        ),
      );
      if (spell)
        result.intents[
          result.intents.findIndex((intent) => intent.actorId === actor.id)
        ] = {
          kind: 'CAST',
          actorId: actor.id,
          slotId: spell.id,
          targetId: threat.id,
          reason: 'Local fight ability',
        };
      continue;
    }
    const defend = info.structures
      .filter((structure) => structure.side === actor.side && structure.active)
      .map((structure) => ({
        structure,
        attackers: visible.filter(
          (unit) =>
            unit.side === opposite(actor.side) &&
            distance(unit.position, structure.position) < 950,
        ),
      }))
      .filter(
        ({ attackers, structure }) =>
          attackers.length > 0 &&
          (distance(actor.position, structure.position) < 2500 ||
            (desperate && ['NEXUS', 'NEXUS_TURRET'].includes(structure.type))),
      )
      .sort(
        (a, b) =>
          (coordination && desperate && baseThreat
            ? Number(b.structure.id === baseThreat.id) -
              Number(a.structure.id === baseThreat.id)
            : 0) ||
          distance(actor.position, a.structure.position) -
            distance(actor.position, b.structure.position),
      )[0];
    if (defend && (desperate || defend.attackers.length >= 3)) {
      const closest = [...allies]
        .sort(
          (a, b) =>
            distance(a.position, defend.structure.position) -
            distance(b.position, defend.structure.position),
        )
        .slice(0, desperate ? 5 : 2);
      if (closest.some((ally) => ally.id === actor.id)) {
        const target = defend.attackers.sort(
          (a, b) =>
            distance(actor.position, a.position) -
            distance(actor.position, b.position),
        )[0];
        set(
          choice(
            actor,
            now,
            'DEFEND',
            target.position,
            desperate
              ? 'Critical base defense: preserve the actual nexus'
              : 'Catch observed wave before tower damage',
            target.id,
          ),
        );
        continue;
      }
    }
    // Available/spawn-soon global clocks are public; current monster HP is not used until seen.
    const candidate = info.objectives
      .filter(
        (objective) =>
          (!coordination ||
            coordination.tradeObjectiveId === objective.id ||
            (coordination.objectiveId === objective.id &&
              coordination.objectiveMembers.has(actor.id)) ||
            (actor.action.kind === 'ATTACK' &&
              actor.action.targetId === objective.id) ||
            slots.some(
              (slot) =>
                slot.id === 'MODEL_SMITE' &&
                usable(slot) &&
                visible.some(
                  (unit) =>
                    unit.id === objective.id &&
                    unit.hp <= 600 &&
                    distance(actor.position, unit.position) <= slot.range,
                ),
            )) &&
          objective.nextAtMs !== null &&
          objective.nextAtMs - now <= 20_000 &&
          !(
            actor.plan?.objectiveBackoff?.id === objective.id &&
            actor.plan.objectiveBackoff.untilMs > now
          ) &&
          (!macro ||
            (info.siegeBuffUntilMs ?? 0) <= now ||
            (actor.action.kind === 'ATTACK' &&
              actor.action.targetId === objective.id) ||
            slots.some(
              (slot) =>
                slot.id === 'MODEL_SMITE' &&
                usable(slot) &&
                visible.some(
                  (unit) =>
                    unit.id === objective.id &&
                    unit.hp <= 600 &&
                    distance(actor.position, unit.position) <= slot.range,
                ),
            )),
      )
      .map((objective) => ({
        objective,
        travel: reachable(input, actor.position, objective.position),
      }))
      .filter(
        ({ objective, travel }) =>
          (travel < 4300 * policy.objectivePriority ||
            (input.rules.macroAi === 'COORDINATED_V2' &&
              coordination?.objectiveId === objective.id &&
              coordination.objectiveMembers.has(actor.id))) &&
          (macro ||
            actor.input.position === 'JUNGLE' ||
            actor.input.position === 'SUPPORT' ||
            distance(actor.position, objective.position) < 2500),
      )
      .sort((a, b) => a.travel - b.travel)[0];
    if (candidate) {
      const obj = candidate.objective;
      const needed =
        obj.type === 'BARON' || obj.type === 'ELDER'
          ? 4
          : obj.type === 'HERALD'
            ? 3
            : 2;
      const joiners = allies.filter(
        (ally) =>
          (!coordination ||
            coordination.objectiveMembers.has(ally.id) ||
            (ally.action.kind === 'ATTACK' &&
              ally.action.targetId === obj.id)) &&
          hp(ally) > 0.5 &&
          ally.action.kind !== 'RECALL' &&
          !info.own[ally.id]?.busy &&
          reachable(input, ally.position, obj.position) / ally.moveSpeed <
            (input.rules.macroAi === 'COORDINATED_V2'
              ? coordinatedArrivalLimit(input, ally)
              : 15 + policy.coordination * 8),
      );
      const nearby = joiners.filter(
        (ally) => distance(ally.position, obj.position) < 1000,
      );
      const foes = enemies.filter(
        (enemy) => distance(enemy.position, obj.position) < 2400,
      );
      const uncertainty =
        (observation.estimates ?? []).filter(
          (estimate) =>
            estimate.source === 'LAST_SEEN' &&
            estimate.confidence > 0.4 &&
            !visible.some((unit) => unit.id === estimate.unitId) &&
            observation.remembered.some(
              ({ unit }) =>
                unit.id === estimate.unitId &&
                unit.kind === 'CHAMPION' &&
                unit.side === opposite(actor.side) &&
                alive(unit),
            ) &&
            distance(estimate.lastPosition, obj.position) < 2500,
        ).length * 0.25;
      const contest = foes.length + uncertainty;
      const observed = visible.find((unit) => unit.id === obj.id);
      const definition = input.rules.environment!.objectives.find(
        (value) => value.type === obj.type,
      )!;
      const finishing = (participants: ActorState[]) => {
        const dps = participants.reduce(
          (sum, ally) =>
            sum +
            (((ally.attackDamage * 1000) / ally.attackIntervalMs) * 100) /
              (100 + definition.template.armor),
          0,
        );
        const seconds =
          (observed?.hp ?? definition.template.hp) / Math.max(1, dps);
        const health = participants.reduce((sum, ally) => sum + ally.hp, 0);
        return {
          seconds,
          feasible:
            dps > 0 &&
            health >
              ((seconds * definition.template.attackDamage * 1000) /
                definition.template.attackIntervalMs) *
                1.3,
        };
      };
      const arrivedFinish = finishing(nearby);
      const canStart =
        nearby.length >= needed &&
        arrivedFinish.feasible &&
        nearby.length > contest;
      const engaged = observed
        ? allies.filter(
            (ally) =>
              ally.action.kind === 'ATTACK' &&
              ally.action.targetId === obj.id &&
              !info.own[ally.id]?.busy &&
              hp(ally) >
                tacticalPolicy(input, ally.input, input.meta)
                  .retreatThreshold &&
              distance(ally.position, observed.position) <=
                ally.attackRange + 80 &&
              hasLineOfSight(input.map, ally.position, observed.position),
          )
        : [];
      const continuingFinish = finishing(engaged);
      const smite = slots.find(
        (slot) => slot.id === 'MODEL_SMITE' && usable(slot),
      );
      if (
        smite &&
        observed &&
        observed.hp <= 600 &&
        distance(actor.position, observed.position) <= smite.range
      ) {
        set(
          choice(
            actor,
            now,
            'OBJECTIVE',
            observed.position,
            'Execute/steal only a visible in-range monster',
            observed.id,
          ),
        );
        result.intents[
          result.intents.findIndex((intent) => intent.actorId === actor.id)
        ] = {
          kind: 'CAST',
          actorId: actor.id,
          slotId: smite.id,
          targetId: observed.id,
          reason: 'Smite threshold',
        };
        continue;
      }
      // Starting numbers are not a reason to abandon a nearly secured monster.
      // Only already engaged, physically arrived allies contribute to this check.
      if (
        observed &&
        engaged.some((ally) => ally.id === actor.id) &&
        engaged.length > contest &&
        continuingFinish.feasible
      ) {
        set(
          choice(
            actor,
            now,
            'OBJECTIVE',
            observed.position,
            `Continue ${obj.type}: ${engaged.length} attacking, remaining ${Math.ceil(continuingFinish.seconds)}s, observed contest ${contest}`,
            observed.id,
          ),
        );
        continue;
      }
      const previousSetup =
        actor.plan?.kind === 'SETUP' && actor.plan.targetId === obj.id
          ? actor.plan
          : null;
      const predictedFinish = finishing(joiners);
      if (
        previousSetup &&
        !(observed && canStart) &&
        (previousSetup.expiresAtMs <= now || !predictedFinish.feasible)
      )
        result.plans[actor.id].objectiveBackoff = {
          id: obj.id,
          untilMs: now + 20_000,
        };
      if (
        joiners.length >= needed &&
        joiners.length > contest &&
        policy.objectivePriority >= 1 &&
        predictedFinish.feasible
      ) {
        if (observed && canStart) {
          set(
            choice(
              actor,
              now,
              'OBJECTIVE',
              observed.position,
              `Commit ${obj.type}: ${nearby.length} arrived, estimated ${Math.ceil(arrivedFinish.seconds)}s, observed contest ${contest}`,
              observed.id,
            ),
          );
          continue;
        }
        // Preserve one preparation deadline across travel, ward placement and
        // waiting. Re-evaluating each second must not extend an unsuccessful setup.
        const arrivalMs = Math.max(
          0,
          ...joiners.map(
            (ally) =>
              (reachable(input, ally.position, obj.position) / ally.moveSpeed) *
              1000,
          ),
        );
        const setup = choice(
          actor,
          now,
          'SETUP',
          obj.position,
          `Prepare ${obj.type}: wait for physical ally arrivals, do not solo-start`,
        );
        setup.plan.targetId = obj.id;
        setup.plan.createdAtMs = previousSetup?.createdAtMs ?? now;
        setup.plan.expiresAtMs =
          previousSetup?.expiresAtMs ??
          now +
            Math.ceil(
              Math.min(
                30_000,
                Math.max(arrivalMs, (obj.nextAtMs ?? now) - now) + 10_000,
              ) / input.rules.stepMs,
            ) *
              input.rules.stepMs;
        const canWait = setup.plan.expiresAtMs > now;
        const covered = (observation.friendlyWards ?? []).some(
          (ward) => distance(ward.position, obj.position) < 900,
        );
        if (
          input.rules.vision &&
          canWait &&
          !covered &&
          info.own[actor.id]?.wardCharges > 0 &&
          distance(actor.position, obj.position) <
            input.rules.vision.placementRange
        ) {
          setup.plan.reason = 'Spend limited vision before entering objective';
          set(setup);
          result.intents[
            result.intents.findIndex((intent) => intent.actorId === actor.id)
          ] = {
            kind: 'WARD',
            actorId: actor.id,
            point: obj.position,
            reason: 'Objective setup vision',
          };
          continue;
        }
        if (canWait) {
          if (distance(actor.position, obj.position) <= 500)
            setup.intent = {
              kind: 'HOLD',
              actorId: actor.id,
              reason: `Hold ${obj.type} setup until spawn or committed allies arrive`,
            };
          set(setup);
          continue;
        }
      } else if (
        contest >= needed &&
        macro &&
        actor.input.position !== 'SUPPORT'
      ) {
        const trade = laneScores.find(
          (lane) => lane.target && distance(lane.point, obj.position) > 3000,
        );
        if (trade) {
          commitSiege(
            choice(
              actor,
              now,
              'TRADE',
              trade.point,
              'Give contested objective; walk to a real opposite-side wave/structure (no free reward)',
            ),
            trade.lane,
            trade.target!.id,
          );
          continue;
        }
      }
    }
    // Clear detected wards with normal attacks. No permanent map reveal on scanner use.
    const ward = visible.find(
      (unit) =>
        unit.kind === 'WARD' && distance(unit.position, actor.position) < 750,
    );
    if (ward) {
      set(
        choice(
          actor,
          now,
          'SETUP',
          ward.position,
          'Remove a scanner-detected enemy ward',
          ward.id,
        ),
      );
      continue;
    }
    if (
      macro &&
      actor.input.position === 'SUPPORT' &&
      info.own[actor.id]?.scannerReady &&
      candidate &&
      distance(actor.position, candidate.objective.position) < 1000
    ) {
      result.intents[
        result.intents.findIndex((intent) => intent.actorId === actor.id)
      ] = { kind: 'SWEEP', actorId: actor.id, reason: 'Clear approach vision' };
      continue;
    }
    if (
      fallback.kind === 'RECALL' ||
      result.plans[actor.id]?.kind === 'RECOVER'
    )
      continue;
    const canUpgrade =
      actor.items.length < 6 &&
      input.rules.items.some(
        (item) =>
          !actor.items.includes(item.id) &&
          item.cost <= actor.gold &&
          item.cost >= 1500,
      );
    if (
      canUpgrade &&
      !localEnemies.length &&
      !desperate &&
      distance(actor.position, input.map.bases[actor.side]) >
        input.rules.fountainRadius
    ) {
      result.intents[
        result.intents.findIndex((intent) => intent.actorId === actor.id)
      ] = {
        kind: 'RECALL',
        actorId: actor.id,
        reason: 'Convert earned gold to actual shop inventory',
      };
      continue;
    }
    let lane = actorLane(actor.input.position);
    if (macro) {
      lane = laneScores[0].lane;
      if (splitting && laneScores[1].target) lane = laneScores[1].lane;
    }
    const ownRotation = actor.plan?.siegeLane;
    if (macro && splitting && ownRotation && ownRotation.expiresAtMs > now) {
      const previous = laneScores.find(
        (row) =>
          row.lane === ownRotation.lane &&
          row.target?.id === ownRotation.targetId,
      );
      if (
        previous &&
        laneScores.find((row) => row.lane === lane)!.score - previous.score < 1
      )
        lane = previous.lane;
    }
    const selected = laneScores.find((value) => value.lane === lane)!;
    const target = selected.target;
    if (!target) continue;
    const minions = visible.filter(
      (unit) =>
        unit.kind === 'MINION' &&
        unit.side !== actor.side &&
        distance(unit.position, actor.position) < 1500,
    );
    const ownWave = waves
      .filter(
        (unit) =>
          distance(unit.position, target.position) < 2000 &&
          (target.lane === null ||
            !unit.id.startsWith('wave:') ||
            unit.id.includes(`:${lane}:`)),
      )
      .sort(
        (a, b) =>
          distance(a.position, target.position) -
          distance(b.position, target.position),
      )[0];
    const seenTarget = visible.find((unit) => unit.id === target.id);
    if (
      seenTarget &&
      ownWave &&
      distance(ownWave.position, target.position) < 1000 &&
      !minions.length &&
      (macro || distance(actor.position, target.position) < 1800)
    ) {
      commitSiege(
        choice(
          actor,
          now,
          'SIEGE',
          target.position,
          `Siege ${lane}: legal structure chain and physical wave present`,
          target.id,
        ),
        lane,
        target.id,
      );
      continue;
    }
    const grouping =
      macro &&
      (actor.input.position !== 'JUNGLE' ||
        actor.items.length >= 5 ||
        !!actor.plan?.siegeLane ||
        allies.filter(
          (ally) =>
            (coordination
              ? ally.id !== coordination.splitActorId
              : ally.input.position !== 'TOP') &&
            ally.id !== actor.id &&
            hp(ally) > 0.5 &&
            ally.action.kind !== 'RECALL' &&
            distance(ally.position, actor.position) < 2500,
        ).length >= 2);
    if (grouping) {
      const yieldFarm = allies.some(
        (ally) =>
          ally.id !== actor.id &&
          distance(ally.position, actor.position) < 850 &&
          tacticalPolicy(input, ally.input, input.meta).resourcePriority >
            policy.resourcePriority,
      );
      const enemyWave = minions
        .filter((unit) => !yieldFarm || hp(unit) > 0.5)
        .sort((a, b) => a.hp - b.hp)[0];
      if (enemyWave) {
        commitSiege(
          choice(
            actor,
            now,
            'LANE',
            enemyWave.position,
            'Clear local finite wave on the way to assigned rotation',
            enemyWave.id,
          ),
          lane,
          target.id,
        );
        continue;
      }
      // Stop outside an undefended turret range until a real wave catches up.
      const back =
        info.structures.find(
          (unit) =>
            unit.side === actor.side && unit.lane === lane && unit.active,
        )?.position ?? input.map.bases[actor.side];
      const length = Math.max(1, distance(back, target.position));
      const staging = {
        x: target.position.x + ((back.x - target.position.x) * 1150) / length,
        y: target.position.y + ((back.y - target.position.y) * 1150) / length,
      };
      const point = ownWave
        ? ownWave.position
        : isWalkable(input.map, staging)
          ? staging
          : back;
      commitSiege(
        choice(
          actor,
          now,
          'SIEGE',
          point,
          `${splitting ? 'Side pressure' : 'Rotate with team'} to ${lane}; wave/structure state, not elapsed-minute teleport`,
        ),
        lane,
        target.id,
      );
    } else if (
      macro &&
      actor.input.position === 'JUNGLE' &&
      allies.filter((ally) => distance(ally.position, target.position) < 2200)
        .length >= 2 &&
      ownWave
    ) {
      commitSiege(
        choice(
          actor,
          now,
          'SIEGE',
          ownWave.position,
          'Join arrived teammates and real siege wave',
        ),
        lane,
        target.id,
      );
    }
  }
  for (const actor of observation.allies) {
    const plan = result.plans[actor.id];
    if (!plan || !actor.active) continue;
    const backoff = actor.plan?.objectiveBackoff;
    if (!plan.objectiveBackoff && backoff && backoff.untilMs > now)
      plan.objectiveBackoff = { ...backoff };
    const previous = actor.plan?.siegeLane;
    if (
      !plan.siegeLane &&
      previous &&
      previous.expiresAtMs > now &&
      plan.kind !== 'RECOVER' &&
      result.intents.find((intent) => intent.actorId === actor.id)?.kind !==
        'RECALL' &&
      targets.some((target) => target.id === previous.targetId)
    )
      plan.siegeLane = { ...previous };
  }
  return result;
}
