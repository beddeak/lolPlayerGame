import {
  type ActorState,
  type EngineInput,
  type EngineState,
  type Intent,
  type Observation,
  type ScheduledCommand,
  type Side,
  type UnitState,
  emit,
} from './contracts';
import { createWorldState } from './world-state';
import { canonicalHash, nextRandom } from './seeded-rng';
import {
  distance,
  findPath,
  hasLineOfSight,
  isWalkable,
  moveAlongPath,
} from './map-paths';
import { observe } from './observation';
import { planActors } from './actor-planner';
import { MINION_ACQUIRE_RADIUS, nextMinionPath } from './minion-navigation';
import { UnitSpatialIndex } from './unit-spatial-index';
import { advanceResources, initializeResources } from './resources';
import { awardDeath, grantReward, purchaseItem } from './economy-ledger';
import { captureFrame } from './projection';
import {
  initializeEnvironment,
  advanceEnvironment,
  environmentTargetable,
  modifyEnvironmentDamage,
  onEnvironmentDamage,
  awardEnvironmentDeath,
} from './environment';
import {
  createVisionState,
  advanceVision,
  requestWard,
  requestSweep,
  isVisibleToTeam,
} from './vision';
import {
  createCombatState,
  beginCast,
  collectAbilityHits,
  applyHitControl,
  absorbDamage,
  advanceEffects,
  isCasting,
  isStunned,
  movementMultiplier,
  cancelCast,
  type AbilityHit,
} from './effects';
import {
  initializeRoleQuests,
  advanceRoleQuests,
  recallDuration,
} from './role-quests';
import { planBattleActors, battlePublicInformation } from './battle-planner';

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const unitsOf = (state: EngineState): UnitState[] => [
  ...state.actors,
  ...state.units,
];
const isActor = (unit: UnitState): unit is ActorState =>
  unit.kind === 'CHAMPION';
const aligned = (state: EngineState, timeMs: number) =>
  Math.ceil(timeMs / state.input.rules.stepMs) * state.input.rules.stepMs;

/** Creates a non-committing simulation: no repository, account or legacy winner calculation. */
export function startSimulation(input: EngineInput): EngineState {
  const state = createWorldState(input);
  initializeResources(state);
  initializeEnvironment(state);
  initializeRoleQuests(state);
  if (input.rules.vision)
    state.vision = createVisionState(
      state.actors.map((a) => a.id),
      input.rules.vision,
    );
  if (input.rules.abilities?.enabled)
    state.combat = createCombatState(state.actors.map((a) => a.id));
  for (const actor of state.actors) {
    grantReward(state, {
      key: `initial:${actor.id}`,
      actorId: actor.id,
      sourceId: 'INITIAL_WALLET',
      gold: input.rules.startingGold,
      xp: 0,
      cs: 0,
      kind: 'STARTING',
    });
  }
  return state;
}

/** Developer-only scripted actions. Career coaching remains a between-set decision. */
export function queueCommand(
  state: EngineState,
  command: ScheduledCommand,
): boolean {
  canonicalHash(command);
  if (
    typeof command.id !== 'string' ||
    !command.id.length ||
    command.id.length > 160 ||
    !command.intent ||
    typeof command.intent.actorId !== 'string' ||
    typeof command.intent.reason !== 'string' ||
    command.intent.reason.length > 2000
  ) {
    throw new Error('Invalid simulation command payload');
  }
  if (
    ((command.intent.kind === 'MOVE' || command.intent.kind === 'WARD') &&
      (!command.intent.point ||
        !Number.isFinite(command.intent.point.x) ||
        !Number.isFinite(command.intent.point.y))) ||
    (command.intent.kind === 'ATTACK' &&
      (typeof command.intent.targetId !== 'string' || !command.intent.targetId))
  ) {
    throw new Error('Invalid simulation command target');
  }
  if (
    command.intent.kind === 'CAST' &&
    (typeof command.intent.slotId !== 'string' ||
      !command.intent.slotId ||
      (command.intent.targetId !== undefined &&
        typeof command.intent.targetId !== 'string') ||
      (command.intent.point !== undefined &&
        (!Number.isFinite(command.intent.point.x) ||
          !Number.isFinite(command.intent.point.y))))
  )
    throw new Error('Invalid simulation cast payload');
  if (Object.hasOwn(state.commandIds, command.id)) return false;
  if (
    !command.id ||
    !Number.isSafeInteger(command.atMs) ||
    command.atMs % state.input.rules.stepMs !== 0 ||
    command.atMs < state.simTimeMs ||
    (state.started && command.atMs === state.simTimeMs) ||
    command.atMs > state.input.rules.maxHorizonMs ||
    state.status !== 'RUNNING'
  ) {
    throw new Error('Invalid simulation command time or lifecycle');
  }
  if (!state.actors.some((a) => a.id === command.intent.actorId))
    throw new Error('Unknown command actor');
  if (
    !['MOVE', 'ATTACK', 'RECALL', 'HOLD', 'WARD', 'SWEEP', 'CAST'].includes(
      command.intent.kind,
    )
  )
    throw new Error('Unknown command kind');
  Object.defineProperty(state.commandIds, command.id, {
    value: true,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  state.commands.push(structuredClone(command));
  state.commands.sort(
    (a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id, 'en'),
  );
  return true;
}

function cancelRecall(
  state: EngineState,
  actor: ActorState,
  reason: string,
): void {
  if (actor.action.kind !== 'RECALL') return;
  actor.action = { kind: 'IDLE' };
  emit(state, { kind: 'RECALL_CANCEL', actorId: actor.id, reason });
}

function setPath(
  state: EngineState,
  actor: ActorState,
  point: { x: number; y: number },
): boolean {
  const last = actor.path.at(-1);
  if (last && distance(last, point) < 80) return true;
  const path = findPath(state.input.map, actor.position, point);
  if (!path) return false;
  actor.path = path;
  return true;
}

function applyIntent(
  state: EngineState,
  intent: Intent,
  observations: Record<Side, Observation>,
): void {
  const actor = state.actors.find((a) => a.id === intent.actorId);
  const reject = (reason: string) =>
    emit(state, { kind: 'REJECTED', actorId: intent.actorId, reason });
  if (!actor || !actor.active) {
    reject('Actor is dead or missing');
    return;
  }
  if (isStunned(state, actor.id) || isCasting(state, actor.id)) return;
  if (intent.kind === 'CAST') {
    if (
      !beginCast(state, actor.id, intent.slotId, intent.targetId, intent.point)
    )
      reject('Cast unavailable, out of range or target invalid');
    return;
  }
  if (intent.kind === 'WARD') {
    if (!requestWard(state, actor.id, intent.point))
      reject('Ward unavailable or position invalid');
    return;
  }
  if (intent.kind === 'SWEEP') {
    if (!requestSweep(state, actor.id)) reject('Scanner unavailable');
    return;
  }
  if (intent.kind === 'ATTACK') {
    const seen = observations[actor.side].visible.find(
      (u) => u.id === intent.targetId && u.active,
    );
    if (!seen || seen.side === actor.side) {
      reject('Target is not an observed opponent');
      return;
    }
    if (!setPath(state, actor, seen.position)) {
      reject('No legal route to attack target');
      return;
    }
    cancelRecall(state, actor, 'Issued attack');
    actor.action = { kind: 'ATTACK', targetId: intent.targetId };
    if (
      distance(actor.position, seen.position) <= actor.attackRange &&
      hasLineOfSight(state.input.map, actor.position, seen.position)
    )
      actor.path = [];
  } else if (intent.kind === 'MOVE') {
    if (
      !isWalkable(state.input.map, intent.point) ||
      !setPath(state, actor, intent.point)
    ) {
      reject('Destination is blocked');
      return;
    }
    cancelRecall(state, actor, 'Issued movement');
    actor.action = { kind: 'MOVE', goal: { ...intent.point } };
    emit(state, {
      kind: 'MOVE',
      actorId: actor.id,
      position: { ...intent.point },
      reason: intent.reason,
    });
  } else if (intent.kind === 'RECALL') {
    if (actor.action.kind === 'RECALL') return;
    actor.path = [];
    actor.action = {
      kind: 'RECALL',
      completesAtMs: state.simTimeMs + recallDuration(state, actor.id),
    };
    emit(state, {
      kind: 'RECALL_START',
      actorId: actor.id,
      reason: intent.reason,
    });
  } else {
    cancelRecall(state, actor, 'Issued hold');
    actor.action = { kind: 'IDLE' };
    actor.path = [];
  }
}

function visibleToTeam(
  state: EngineState,
  side: Side,
  target: UnitState,
  all = unitsOf(state),
): boolean {
  return isVisibleToTeam(state, side, target, all);
}

function npcTarget(
  state: EngineState,
  unit: UnitState,
  all: UnitState[],
  nearby?: UnitState[],
): UnitState | undefined {
  if (unit.kind === 'CAMP' || unit.kind === 'OBJECTIVE') {
    const contributors = state.damageContributors[unit.id] ?? {};
    return all
      .filter(isActor)
      .filter(
        (a) =>
          a.active &&
          contributors[a.id] !== undefined &&
          state.simTimeMs - contributors[a.id] <=
            state.input.rules.assistWindowMs &&
          distance(unit.origin, a.position) <=
            (unit.kind === 'OBJECTIVE'
              ? state.input.rules.environment!.objectiveLeashRadius
              : state.input.rules.campLeashRadius),
      )
      .sort(
        (a, b) =>
          distance(unit.position, a.position) -
          distance(unit.position, b.position),
      )[0];
  }
  return (nearby ?? all)
    .filter(
      (other) =>
        other.active &&
        other.kind !== 'WARD' &&
        other.side !== null &&
        other.side !== unit.side &&
        distance(unit.position, other.position) <= unit.attackRange &&
        hasLineOfSight(state.input.map, unit.position, other.position) &&
        environmentTargetable(state, other),
    )
    .sort(
      (a, b) =>
        (unit.kind === 'TURRET'
          ? Number(turretAggro(state, unit, b)) -
            Number(turretAggro(state, unit, a))
          : 0) ||
        Number(a.kind === 'CHAMPION') - Number(b.kind === 'CHAMPION') ||
        distance(unit.position, a.position) -
          distance(unit.position, b.position),
    )[0];
}

function turretAggro(
  state: EngineState,
  tower: UnitState,
  target: UnitState,
): boolean {
  return (
    isActor(target) &&
    tower.turretAggro?.targetId === target.id &&
    tower.turretAggro.untilMs > state.simTimeMs
  );
}

function moveAndRecover(state: EngineState): void {
  const elapsed = state.input.rules.stepMs / 1000;
  const all = unitsOf(state);
  const previous = all.map((unit) => ({
    ...unit,
    position: { ...unit.position },
  }));
  const spatial = new UnitSpatialIndex(previous);
  for (const unit of all) {
    if (!unit.active) continue;
    if (isActor(unit)) {
      if (
        unit.action.kind === 'RECALL' ||
        isCasting(state, unit.id) ||
        isStunned(state, unit.id) ||
        state.vision?.inventory[unit.id]?.placement
      )
        continue;
      if (unit.action.kind === 'ATTACK') {
        const targetId = unit.action.targetId;
        const target = previous.find((other) => other.id === targetId);
        if (
          target?.active &&
          visibleToTeam(state, unit.side, target, previous)
        ) {
          if (
            distance(unit.position, target.position) <= unit.attackRange &&
            hasLineOfSight(state.input.map, unit.position, target.position)
          )
            unit.path = [];
          else setPath(state, unit, target.position);
        }
      }
    } else {
      const nearby = spatial.within(
        unit.position,
        unit.kind === 'MINION' && state.input.rules.environment
          ? Math.max(unit.attackRange, MINION_ACQUIRE_RADIUS)
          : unit.attackRange,
      );
      const target = npcTarget(state, unit, previous, nearby);
      if (unit.kind === 'MINION' && state.input.rules.environment)
        unit.path = nextMinionPath(state, unit, previous, nearby);
      if (unit.kind === 'MINION' && target) continue;
      if (unit.kind === 'CAMP' || unit.kind === 'OBJECTIVE') {
        if (target) {
          unit.path =
            distance(unit.position, target.position) <= unit.attackRange
              ? []
              : (findPath(state.input.map, unit.position, target.position) ??
                []);
        } else if (distance(unit.position, unit.origin) > 0.001) {
          unit.path =
            findPath(state.input.map, unit.position, unit.origin) ?? [];
        } else if (unit.hp < unit.maxHp) {
          unit.hp = unit.maxHp;
          delete state.damageContributors[unit.id];
          emit(state, {
            kind: unit.kind === 'OBJECTIVE' ? 'OBJECTIVE_RESET' : 'CAMP_RESET',
            targetId: unit.id,
            reason: 'No engaged attacker inside leash',
          });
        }
      }
    }
    const hadPath = unit.path.length > 0;
    const next = moveAlongPath(
      unit.position,
      unit.path,
      unit.moveSpeed *
        elapsed *
        (isActor(unit) ? movementMultiplier(state, unit.id) : 1),
    );
    unit.position = next.position;
    unit.path = next.path;
    if (hadPath && !unit.path.length && isActor(unit)) {
      if (unit.action.kind === 'MOVE') unit.action = { kind: 'IDLE' };
      emit(state, {
        kind: 'ARRIVE',
        actorId: unit.id,
        position: { ...unit.position },
      });
    }
    if (
      isActor(unit) &&
      distance(unit.position, state.input.map.bases[unit.side]) <=
        state.input.rules.fountainRadius
    ) {
      unit.hp = round(
        Math.min(
          unit.maxHp,
          unit.hp + state.input.rules.fountainHpPerSecond * elapsed,
        ),
      );
      unit.mana = round(
        Math.min(
          unit.maxMana,
          unit.mana + state.input.rules.fountainManaPerSecond * elapsed,
        ),
      );
    }
  }
}

function resolveAttacks(state: EngineState): void {
  const all = unitsOf(state).filter((u) => u.active);
  const spatial = new UnitSpatialIndex(all);
  const attacks: Array<{
    actor: UnitState;
    victim: UnitState;
    damage: number;
    priority: string;
    ability?: AbilityHit;
  }> = [];
  for (const unit of all) {
    if (unit.nextAttackAtMs > state.simTimeMs || unit.attackDamage <= 0)
      continue;
    let target: UnitState | undefined;
    if (isActor(unit)) {
      if (
        unit.action.kind !== 'ATTACK' ||
        isCasting(state, unit.id) ||
        isStunned(state, unit.id) ||
        state.vision?.inventory[unit.id]?.placement
      )
        continue;
      const targetId = unit.action.targetId;
      target = all.find((other) => other.id === targetId);
    } else
      target = npcTarget(
        state,
        unit,
        all,
        spatial.within(unit.position, unit.attackRange),
      );
    if (
      !target ||
      !environmentTargetable(state, target) ||
      target === unit ||
      (target.side !== null && target.side === unit.side) ||
      (isActor(unit) && !visibleToTeam(state, unit.side, target)) ||
      distance(unit.position, target.position) > unit.attackRange ||
      !hasLineOfSight(state.input.map, unit.position, target.position)
    )
      continue;
    attacks.push({
      actor: unit,
      victim: target,
      damage: 0,
      priority: canonicalHash([
        state.input.seed,
        state.simTimeMs,
        unit.id,
        target.id,
      ]),
    });
  }
  for (const hit of collectAbilityHits(state)) {
    if (!hit.victim.active || !environmentTargetable(state, hit.victim))
      continue;
    attacks.push({
      actor: hit.actor,
      victim: hit.victim,
      damage: 0,
      priority: canonicalHash([
        state.input.seed,
        state.simTimeMs,
        hit.actor.id,
        hit.victim.id,
        hit.sourceId,
      ]),
      ability: hit,
    });
  }
  // Resolve from one snapshot; arrays/team IDs never decide who survives to attack first.
  attacks.sort((a, b) => a.priority.localeCompare(b.priority, 'en'));
  for (const hit of attacks) {
    const execution = isActor(hit.actor)
      ? 0.7 + 0.3 * hit.actor.input.execution
      : 1;
    hit.damage = hit.ability?.trueDamage
      ? hit.ability.rawDamage
      : round(
          ((hit.ability
            ? hit.ability.rawDamage
            : hit.actor.attackDamage * execution) *
            (0.94 + 0.12 * nextRandom(state.rng, 'combat')) *
            100) /
            (hit.ability?.trueDamage ? 100 : 100 + hit.victim.armor),
        );
    hit.damage =
      hit.victim.kind === 'WARD'
        ? hit.ability
          ? 0
          : 1
        : hit.ability?.trueDamage
          ? hit.damage
          : modifyEnvironmentDamage(
              state,
              hit.actor,
              hit.victim,
              hit.damage,
              !hit.ability,
            );
    if (!Number.isFinite(hit.damage)) {
      throw new Error('Non-finite combat damage');
    }
    if (!hit.ability)
      hit.actor.nextAttackAtMs =
        state.simTimeMs + aligned(state, hit.actor.attackIntervalMs);
    emit(state, {
      kind: 'ATTACK',
      actorId: hit.actor.id,
      targetId: hit.victim.id,
      position: { ...hit.actor.position },
      amount: hit.damage,
      ...(hit.ability
        ? { sourceId: hit.ability.sourceId, reason: 'ABILITY' }
        : {}),
    });
  }
  const byVictim = new Map<string, typeof attacks>();
  for (const hit of attacks) {
    if (!byVictim.has(hit.victim.id)) byVictim.set(hit.victim.id, []);
    byVictim.get(hit.victim.id)!.push(hit);
  }
  const deaths: Array<{ victim: UnitState; killer: UnitState | null }> = [];
  for (const hits of byVictim.values()) {
    const victim = hits[0].victim;
    const total = hits.reduce((sum, hit) => sum + hit.damage, 0);
    // Rounded/fully mitigated zero damage neither wounds nor interrupts recall.
    if (total <= 0) continue;
    const beforeHp = victim.hp;
    if (isActor(victim)) {
      for (const hit of hits) {
        if (
          !isActor(hit.actor) ||
          hit.damage <= 0 ||
          hit.actor.side === victim.side
        )
          continue;
        for (const tower of state.units) {
          if (
            tower.kind === 'TURRET' &&
            tower.side === victim.side &&
            tower.active &&
            distance(tower.position, victim.position) <= tower.attackRange &&
            distance(tower.position, hit.actor.position) <= tower.attackRange
          )
            tower.turretAggro = {
              targetId: hit.actor.id,
              untilMs: state.simTimeMs + 3000,
            };
        }
      }
    }
    const dealt = Math.min(absorbDamage(state, victim.id, total), beforeHp);
    let remaining = dealt;
    hits.forEach((hit, index) => {
      const actual =
        index === hits.length - 1
          ? remaining
          : Math.min(remaining, round((dealt * hit.damage) / total));
      remaining = round(remaining - actual);
      emit(state, {
        kind: 'DAMAGE',
        actorId: hit.actor.id,
        targetId: victim.id,
        amount: actual,
      });
      if (isActor(hit.actor) && actual > 0) {
        state.damageContributors[victim.id] ??= {};
        state.damageContributors[victim.id][hit.actor.id] = state.simTimeMs;
        if (isActor(victim))
          hit.actor.stats.damageToChampions = round(
            hit.actor.stats.damageToChampions + actual,
          );
      }
    });
    for (const hit of hits)
      if (hit.ability && hit.damage > 0) applyHitControl(state, hit.ability);
    victim.hp = round(Math.max(0, beforeHp - dealt));
    onEnvironmentDamage(state, victim, beforeHp);
    if (isActor(victim)) {
      victim.stats.damageTaken = round(victim.stats.damageTaken + dealt);
      victim.lastDamagedAtMs = state.simTimeMs;
      cancelRecall(state, victim, 'Incoming damage');
    }
    if (victim.hp === 0) {
      // Highest lethal-window contribution; seed-shuffled ties have no fixed side priority.
      const strongest = [...hits].sort((a, b) => b.damage - a.damage)[0];
      deaths.push({ victim, killer: strongest?.actor ?? null });
    }
  }
  // Mark every simultaneous death before rewarding; dead champions cannot share proximity XP.
  if (deaths.filter(({ victim }) => victim.kind === 'NEXUS').length > 1)
    throw new Error(
      'Simultaneous nexus destruction requires adjudication; no winner committed',
    );
  for (const { victim } of deaths) {
    victim.active = false;
    victim.path = [];
    if (isActor(victim)) {
      cancelCast(state, victim.id, 'Caster died');
      const rules = state.input.rules;
      const delay = aligned(
        state,
        rules.respawnBaseMs +
          victim.level * rules.respawnPerLevelMs +
          Math.floor(state.simTimeMs / 60_000) * rules.respawnPerMinuteMs,
      );
      victim.action = { kind: 'DEAD', respawnsAtMs: state.simTimeMs + delay };
      victim.respawnAtMs = state.simTimeMs + delay;
      victim.plan = null;
    }
  }
  for (const { victim, killer } of deaths) {
    const killerId = killer && isActor(killer) ? killer.id : null;
    const assists = Object.entries(state.damageContributors[victim.id] ?? {})
      .filter(
        ([id, time]) =>
          id !== killerId &&
          state.simTimeMs - time <= state.input.rules.assistWindowMs &&
          state.actors.some((a) => a.id === id && a.side === killer?.side),
      )
      .map(([id]) => id);
    emit(state, {
      kind: 'DEATH',
      targetId: victim.id,
      ...(killerId ? { actorId: killerId } : {}),
    });
    if (!awardEnvironmentDeath(state, victim, killer) && victim.kind !== 'WARD')
      awardDeath(state, victim, killerId, assists);
    delete state.damageContributors[victim.id];
  }
}

function lifecycle(state: EngineState): void {
  for (const actor of state.actors) {
    if (
      actor.action.kind === 'DEAD' &&
      actor.action.respawnsAtMs <= state.simTimeMs
    ) {
      actor.active = true;
      actor.hp = actor.maxHp;
      actor.mana = actor.maxMana;
      actor.position = { ...state.input.map.bases[actor.side] };
      actor.origin = { ...actor.position };
      actor.path = [];
      actor.plan = null;
      actor.generation++;
      actor.action = { kind: 'IDLE' };
      actor.respawnAtMs = null;
      emit(state, {
        kind: 'RESPAWN',
        actorId: actor.id,
        position: { ...actor.position },
      });
    }
  }
}

function completeRecalls(state: EngineState): void {
  for (const actor of state.actors) {
    if (
      !actor.active ||
      actor.action.kind !== 'RECALL' ||
      actor.action.completesAtMs > state.simTimeMs
    )
      continue;
    actor.position = { ...state.input.map.bases[actor.side] };
    actor.path = [];
    actor.action = { kind: 'IDLE' };
    actor.plan = null;
    // No instant heal: the next physical step applies fountain regeneration.
    emit(state, {
      kind: 'RECALL_COMPLETE',
      actorId: actor.id,
      position: { ...actor.position },
    });
  }
}

function processTime(state: EngineState, withMovement: boolean): void {
  advanceEffects(state);
  if (withMovement) moveAndRecover(state);
  lifecycle(state);
  advanceResources(state);
  advanceEnvironment(state);
  advanceVision(state);
  let observations: Record<Side, Observation> | null = null;
  const currentObservations = () => {
    if (!observations) {
      observations = {
        BLUE: observe(state, 'BLUE'),
        RED: observe(state, 'RED'),
      };
      // Only authoritative decision/command ticks advance team knowledge.
      // Read-only previews and replay refreshes cannot create extra memories.
      for (const side of ['BLUE', 'RED'] as const) {
        state.observations[side] = Object.fromEntries(
          observations[side].remembered.map((entry) => [
            entry.unit.id,
            structuredClone(entry),
          ]),
        );
      }
    }
    return observations;
  };
  if (state.nextDecisionAtMs <= state.simTimeMs) {
    state.nextDecisionAtMs += state.input.rules.decisionIntervalMs;
    if (state.input.controlMode !== 'SCRIPTED') {
      const observed = currentObservations();
      const actions = (['BLUE', 'RED'] as const).map((side) =>
        state.input.rules.environment
          ? planBattleActors(
              observed[side],
              state.input,
              state.rng,
              battlePublicInformation(state, side),
            )
          : planActors(observed[side], state.input, state.rng),
      );
      for (const result of actions) {
        for (const [id, plan] of Object.entries(result.plans)) {
          const actor = state.actors.find((a) => a.id === id)!;
          if (
            actor.plan?.kind !== plan.kind ||
            actor.plan?.targetId !== plan.targetId ||
            actor.plan?.siegeLane?.lane !== plan.siegeLane?.lane
          ) {
            emit(state, {
              kind: 'PLAN',
              actorId: id,
              position: { ...plan.point },
              reason: plan.reason,
            });
          }
          actor.plan = structuredClone(plan);
        }
        for (const intent of result.intents)
          applyIntent(state, intent, observed);
      }
      // Spending at the shop is an explicit action, not a wallet-to-power multiplier.
      for (const actor of state.actors) {
        if (
          !actor.active ||
          distance(actor.position, state.input.map.bases[actor.side]) >
            state.input.rules.fountainRadius
        )
          continue;
        const priority =
          actor.input.position === 'SUPPORT'
            ? ['MODEL_VITALITY', 'MODEL_VEST', 'MODEL_BLADE']
            : ['MODEL_BLADE', 'MODEL_VITALITY', 'MODEL_VEST'];
        if (state.input.rules.environment)
          priority.push('MODEL_WEAPON', 'MODEL_ARMOR', 'MODEL_CAPSTONE');
        for (const itemId of priority) {
          if (purchaseItem(state, actor.id, itemId)) break;
        }
      }
    }
  }
  while (state.commands[0] && state.commands[0].atMs <= state.simTimeMs) {
    const command = state.commands.shift()!;
    applyIntent(state, command.intent, currentObservations());
  }
  resolveAttacks(state);
  advanceRoleQuests(state);
  completeRecalls(state);
  if (state.nextPassiveGoldAtMs <= state.simTimeMs) {
    for (const actor of state.actors)
      grantReward(state, {
        key: `passive:${actor.id}:${state.nextPassiveGoldAtMs}`,
        actorId: actor.id,
        sourceId: 'PASSIVE_GOLD',
        gold: state.input.rules.passiveGoldPerSecond,
        xp: 0,
        cs: 0,
        kind: 'PASSIVE',
      });
    state.nextPassiveGoldAtMs += 1000;
  }
  if (state.simTimeMs === 900_000)
    state.at15 = Object.fromEntries(
      state.actors.map((actor) => [
        actor.id,
        { goldEarned: actor.stats.goldEarned, cs: actor.stats.cs },
      ]),
    );
  if (
    state.nextSnapshotAtMs <= state.simTimeMs ||
    state.status === 'FINISHED'
  ) {
    captureFrame(state);
    state.nextSnapshotAtMs += state.input.rules.snapshotIntervalMs;
  }
}

/** Playback speed/batch size never changes the authoritative 100ms model. */
export function runUntil(state: EngineState, untilMs: number): EngineState {
  if (
    !Number.isSafeInteger(untilMs) ||
    untilMs < state.simTimeMs ||
    untilMs > state.input.rules.maxHorizonMs ||
    untilMs % state.input.rules.stepMs !== 0
  ) {
    throw new Error(
      'Simulation horizon must be an aligned time inside the supported window',
    );
  }
  if (state.status === 'ERROR')
    throw new Error(`Simulation is in error: ${state.error}`);
  if (state.status === 'HORIZON_REACHED' || state.status === 'FINISHED')
    return state;
  try {
    if (!state.started) {
      processTime(state, false);
      state.started = true;
    }
    while (state.simTimeMs < untilMs && state.status === 'RUNNING') {
      state.simTimeMs += state.input.rules.stepMs;
      processTime(state, true);
    }
    if (
      state.simTimeMs === state.input.rules.maxHorizonMs &&
      state.status === 'RUNNING'
    )
      state.status = 'HORIZON_REACHED';
    return state;
  } catch (error) {
    state.status = 'ERROR';
    state.error =
      error instanceof Error ? error.message : 'Unknown simulation error';
    throw error;
  }
}
