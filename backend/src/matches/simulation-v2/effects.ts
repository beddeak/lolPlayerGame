import { CHAMPIONS_BY_ID } from '../../drafts/champion-catalog';
import type {
  ActorInput,
  ActorState,
  EngineInput,
  EngineState,
  Point,
  Ruleset,
  UnitState,
} from './contracts';
import { emit } from './contracts';
import { distance, findPath, hasLineOfSight } from './map-paths';
import { isVisibleToTeam } from './vision';

/** Model behavior, NOT a recreation of the named champion's real Q/W/E/R kit. */
export interface ActionSlot {
  id: string;
  kind: 'DAMAGE' | 'CONTROL' | 'SHIELD' | 'REPOSITION' | 'SMITE';
  mana: number;
  cooldownMs: number;
  castMs: number;
  range: number;
  basePower: number;
  attackRatio: number;
  durationMs: number;
  radius: number;
}
export interface AbilityRules {
  enabled: boolean;
  modelVersion: string;
  manaRegenPerSecond: number;
  damageMultiplier: number;
}
export const MODEL_ABILITY_RULES: AbilityRules = {
  enabled: true,
  modelVersion: 'CLASS_ACTION_SLOTS_V1',
  manaRegenPerSecond: 4,
  damageMultiplier: 1,
};
export interface PendingCast {
  id: string;
  actorId: string;
  slotId: string;
  completesAtMs: number;
  targetId: string | null;
  point: Point | null;
  origin: Point;
  launched: boolean;
  impactPoint: Point | null;
  arrivesAtMs: number | null;
  power: number | null;
}
export interface ActiveEffect {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'STUN' | 'SHIELD' | 'HASTE';
  startsAtMs: number;
  expiresAtMs: number;
  amount: number;
}
export interface CombatState {
  casts: PendingCast[];
  cooldowns: Record<string, Record<string, number>>;
  effects: ActiveEffect[];
  nextCastId: number;
}
export interface AbilityHit {
  actor: ActorState;
  victim: UnitState;
  rawDamage: number;
  stunMs: number;
  sourceId: string;
  trueDamage?: boolean;
}
type EffectWorld = EngineState & {
  combat: CombatState;
  input: EngineInput & { rules: Ruleset & { abilities: AbilityRules } };
};
function hasEffects(state: EngineState): state is EffectWorld {
  return !!state.combat && !!state.input.rules.abilities?.enabled;
}

const slots = new Map<string, readonly ActionSlot[]>();
const smite: Readonly<ActionSlot> = Object.freeze({
  id: 'MODEL_SMITE',
  kind: 'SMITE',
  mana: 0,
  cooldownMs: 60_000,
  castMs: 0,
  range: 500,
  basePower: 600,
  attackRatio: 0,
  durationMs: 0,
  radius: 0,
});
export function getActorActionSlots(
  input: Pick<ActorInput, 'championId' | 'position'>,
): readonly ActionSlot[] {
  const base = getActionSlots(input.championId);
  return input.position === 'JUNGLE' ? [...base, smite] : base;
}
export function getActionSlots(championId: string): readonly ActionSlot[] {
  const cached = slots.get(championId);
  if (cached) return cached;
  const champion = CHAMPIONS_BY_ID.get(championId);
  if (!champion) throw new Error(`Unknown model champion ${championId}`);
  const mage = champion.tags.includes('Mage');
  const marksman = champion.tags.includes('Marksman');
  const result: ActionSlot[] = [
    {
      id: 'MODEL_STRIKE',
      kind: 'DAMAGE',
      mana: 35,
      cooldownMs: 6000,
      castMs: 300,
      range: mage ? 850 : marksman ? 700 : 350,
      basePower: 25 + champion.damage * 0.65,
      attackRatio: mage ? 0.6 : 1.1,
      durationMs: 0,
      radius: mage || champion.teamFight >= 90 ? 230 : 0,
    },
  ];
  if (champion.protection >= 75)
    result.push({
      id: 'MODEL_GUARD',
      kind: 'SHIELD',
      mana: 55,
      cooldownMs: 10_000,
      castMs: 200,
      range: 750,
      basePower: 50 + champion.protection * 1.4,
      attackRatio: 0,
      durationMs: 3000,
      radius: 0,
    });
  else if (champion.engage >= 60 || mage)
    result.push({
      id: 'MODEL_CONTROL',
      kind: 'CONTROL',
      mana: 65,
      cooldownMs: 12_000,
      castMs: 400,
      range: champion.frontline >= 70 ? 450 : 800,
      basePower: 30 + champion.damage * 0.4,
      attackRatio: 0.45,
      durationMs: champion.frontline >= 70 ? 1200 : 800,
      radius: 150,
    });
  if (
    champion.tags.some((tag) =>
      ['Assassin', 'Fighter', 'Marksman'].includes(tag),
    )
  )
    result.push({
      id: 'MODEL_REPOSITION',
      kind: 'REPOSITION',
      mana: 50,
      cooldownMs: 16_000,
      castMs: 200,
      range: 600,
      basePower: 0,
      attackRatio: 0,
      durationMs: 1500,
      radius: 0,
    });
  const frozen = Object.freeze(result.map((slot) => Object.freeze(slot)));
  slots.set(championId, frozen);
  return frozen;
}

export function createCombatState(actorIds: string[]): CombatState {
  return {
    casts: [],
    effects: [],
    nextCastId: 0,
    cooldowns: Object.fromEntries(actorIds.map((id) => [id, {}])),
  };
}
export function isStunned(state: EngineState, actorId: string): boolean {
  if (!hasEffects(state)) return false;
  return state.combat.effects.some(
    (effect) =>
      effect.targetId === actorId &&
      effect.kind === 'STUN' &&
      effect.startsAtMs <= state.simTimeMs &&
      effect.expiresAtMs > state.simTimeMs,
  );
}
export function isCasting(state: EngineState, actorId: string): boolean {
  if (!hasEffects(state)) return false;
  return state.combat.casts.some(
    (cast) => cast.actorId === actorId && !cast.launched,
  );
}
export function movementMultiplier(
  state: EngineState,
  actorId: string,
): number {
  if (!hasEffects(state)) return 1;
  if (isStunned(state, actorId)) return 0;
  return state.combat.effects.some(
    (effect) =>
      effect.targetId === actorId &&
      effect.kind === 'HASTE' &&
      effect.startsAtMs <= state.simTimeMs &&
      effect.expiresAtMs > state.simTimeMs,
  )
    ? 1.75
    : 1;
}

export function cancelCast(
  state: EngineState,
  actorId: string,
  reason: string,
): void {
  if (!hasEffects(state)) return;
  for (const cast of state.combat.casts.filter(
    (candidate) => candidate.actorId === actorId && !candidate.launched,
  ))
    emit(state, { kind: 'CAST_CANCEL', actorId, sourceId: cast.id, reason });
  state.combat.casts = state.combat.casts.filter(
    (cast) => cast.actorId !== actorId || cast.launched,
  );
}

export function beginCast(
  state: EngineState,
  actorId: string,
  slotId: string,
  targetId?: string,
  point?: Point,
): boolean {
  if (!hasEffects(state)) return false;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (
    !actor?.active ||
    actor.action.kind === 'RECALL' ||
    state.vision?.inventory[actorId]?.placement ||
    isStunned(state, actorId) ||
    isCasting(state, actorId)
  )
    return false;
  const slot = getActorActionSlots(actor.input).find(
    (candidate) => candidate.id === slotId,
  );
  if (
    !slot ||
    actor.mana < slot.mana ||
    (state.combat.cooldowns[actorId][slot.id] ?? 0) > state.simTimeMs
  )
    return false;
  let target: UnitState | undefined;
  if (slot.kind === 'REPOSITION') {
    if (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      distance(actor.position, point) > slot.range ||
      !findPath(state.input.map, actor.position, point)
    )
      return false;
  } else {
    target = [...state.actors, ...state.units].find(
      (unit) => unit.id === targetId,
    );
    if (
      !target?.active ||
      target.kind === 'WARD' ||
      (slot.kind === 'SMITE' && !['CAMP', 'OBJECTIVE'].includes(target.kind)) ||
      (slot.kind === 'SHIELD'
        ? target.side !== actor.side || target.kind !== 'CHAMPION'
        : target.side === actor.side) ||
      !isVisibleToTeam(state, actor.side, target) ||
      distance(actor.position, target.position) > slot.range ||
      !hasLineOfSight(state.input.map, actor.position, target.position)
    )
      return false;
  }
  actor.mana -= slot.mana;
  state.combat.cooldowns[actorId][slot.id] = state.simTimeMs + slot.cooldownMs;
  const cast: PendingCast = {
    id: `cast:${++state.combat.nextCastId}`,
    actorId,
    slotId,
    completesAtMs: state.simTimeMs + slot.castMs,
    targetId: target?.id ?? null,
    point: point ? { ...point } : null,
    origin: { ...actor.position },
    launched: false,
    impactPoint: null,
    arrivesAtMs: null,
    power: null,
  };
  state.combat.casts.push(cast);
  actor.path = [];
  emit(state, {
    kind: 'CAST_START',
    actorId,
    sourceId: cast.id,
    ...(target ? { targetId: target.id } : {}),
    reason: slot.id,
  });
  return true;
}

function attachEffect(state: EffectWorld, effect: ActiveEffect): void {
  state.combat.effects.push(effect);
  emit(state, {
    kind: 'EFFECT_APPLIED',
    actorId: effect.sourceId,
    targetId: effect.targetId,
    amount: effect.amount,
    reason: effect.kind,
  });
}

/** Produces damage for the ONE engine resolver. Never edits HP, KDA or damage statistics here. */
export function collectAbilityHits(state: EngineState): AbilityHit[] {
  if (!hasEffects(state)) return [];
  const hits: AbilityHit[] = [];
  const casts = [...state.combat.casts].sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  );
  for (const cast of casts) {
    const actor = state.actors.find(
      (candidate) => candidate.id === cast.actorId,
    );
    if (
      !actor ||
      (!cast.launched && (!actor.active || isStunned(state, cast.actorId)))
    ) {
      cancelCast(state, cast.actorId, 'Dead or controlled during wind-up');
      continue;
    }
    if (cast.completesAtMs > state.simTimeMs) continue;
    if (cast.launched && cast.arrivesAtMs! > state.simTimeMs) continue;
    const slot = getActorActionSlots(actor.input).find(
      (candidate) => candidate.id === cast.slotId,
    )!;
    const finish = () => {
      state.combat.casts = state.combat.casts.filter(
        (candidate) => candidate.id !== cast.id,
      );
    };
    if (slot.kind === 'REPOSITION') {
      const path = findPath(state.input.map, actor.position, cast.point!);
      if (path && distance(actor.position, cast.point!) <= slot.range) {
        actor.path = path;
        actor.action = { kind: 'MOVE', goal: { ...cast.point! } };
        attachEffect(state, {
          id: cast.id,
          sourceId: actor.id,
          targetId: actor.id,
          kind: 'HASTE',
          startsAtMs: state.simTimeMs,
          expiresAtMs: state.simTimeMs + slot.durationMs,
          amount: 1.75,
        });
        emit(state, {
          kind: 'CAST_COMPLETE',
          actorId: actor.id,
          sourceId: cast.id,
          reason: slot.id,
        });
      } else
        emit(state, {
          kind: 'CAST_MISS',
          actorId: actor.id,
          sourceId: cast.id,
          reason: 'Destination no longer reachable',
        });
      finish();
      continue;
    }
    const target = [...state.actors, ...state.units].find(
      (unit) => unit.id === cast.targetId,
    );
    if (
      !target?.active ||
      (cast.launched
        ? distance(cast.impactPoint!, target.position) > 180
        : !isVisibleToTeam(state, actor.side, target) ||
          distance(actor.position, target.position) > slot.range ||
          !hasLineOfSight(state.input.map, actor.position, target.position))
    ) {
      emit(state, {
        kind: 'CAST_MISS',
        actorId: actor.id,
        sourceId: cast.id,
        reason: 'Target lost, dead, blocked or out of range',
      });
      finish();
      continue;
    }
    const power =
      cast.power ??
      (slot.kind === 'SMITE'
        ? slot.basePower
        : (slot.basePower +
            actor.level * 8 +
            actor.attackDamage * slot.attackRatio) *
          (0.7 + 0.3 * actor.input.execution));
    if (!cast.launched && slot.kind === 'DAMAGE' && slot.range >= 600) {
      cast.launched = true;
      cast.origin = { ...actor.position };
      cast.impactPoint = { ...target.position };
      cast.power = power;
      cast.arrivesAtMs =
        state.simTimeMs +
        Math.max(
          state.input.rules.stepMs,
          Math.ceil(
            ((distance(actor.position, target.position) / 1800) * 1000) /
              state.input.rules.stepMs,
          ) * state.input.rules.stepMs,
        );
      emit(state, {
        kind: 'CAST_PROJECTILE',
        actorId: actor.id,
        targetId: target.id,
        sourceId: cast.id,
        position: { ...cast.impactPoint },
      });
      continue;
    }
    finish();
    emit(state, {
      kind: 'CAST_COMPLETE',
      actorId: actor.id,
      targetId: target.id,
      sourceId: cast.id,
      reason: slot.id,
    });
    if (slot.kind === 'SHIELD') {
      attachEffect(state, {
        id: cast.id,
        sourceId: actor.id,
        targetId: target.id,
        kind: 'SHIELD',
        startsAtMs: state.simTimeMs,
        expiresAtMs: state.simTimeMs + slot.durationMs,
        amount: power,
      });
      continue;
    }
    const targets = [
      target,
      ...(slot.radius
        ? [...state.actors, ...state.units].filter(
            (unit) =>
              unit !== target &&
              unit.active &&
              unit.kind !== 'WARD' &&
              unit.side !== actor.side &&
              distance(unit.position, target.position) <= slot.radius &&
              (cast.launched
                ? distance(cast.impactPoint!, unit.position) <= slot.radius &&
                  hasLineOfSight(state.input.map, cast.origin, unit.position)
                : distance(actor.position, unit.position) <= slot.range &&
                  isVisibleToTeam(state, actor.side, unit) &&
                  hasLineOfSight(
                    state.input.map,
                    actor.position,
                    unit.position,
                  )),
          )
        : []
      ).sort((a, b) => a.id.localeCompare(b.id, 'en')),
    ].slice(0, 4);
    for (const victim of targets)
      hits.push({
        actor,
        victim,
        rawDamage:
          power *
          (slot.kind === 'SMITE'
            ? 1
            : state.input.rules.abilities.damageMultiplier),
        stunMs:
          slot.kind === 'CONTROL' && victim.kind === 'CHAMPION'
            ? slot.durationMs
            : 0,
        sourceId: cast.id,
        ...(slot.kind === 'SMITE' ? { trueDamage: true } : {}),
      });
  }
  return hits;
}

/** Call only for resolver-accepted impacts; shield absorption does not block CC. */
export function applyHitControl(state: EngineState, hit: AbilityHit): void {
  if (!hasEffects(state)) return;
  if (!hit.stunMs || !hit.victim.active || hit.victim.kind !== 'CHAMPION')
    return;
  attachEffect(state, {
    id: `${hit.sourceId}:${hit.victim.id}`,
    sourceId: hit.actor.id,
    targetId: hit.victim.id,
    kind: 'STUN',
    startsAtMs: state.simTimeMs,
    expiresAtMs: state.simTimeMs + hit.stunMs,
    amount: 1,
  });
  hit.victim.path = [];
  cancelCast(state, hit.victim.id, 'Crowd control');
  const actor = hit.victim as ActorState;
  if (actor.action.kind === 'RECALL') {
    actor.action = { kind: 'IDLE' };
    emit(state, {
      kind: 'RECALL_CANCEL',
      actorId: actor.id,
      reason: 'Crowd control',
    });
  }
}

export function absorbDamage(
  state: EngineState,
  targetId: string,
  damage: number,
): number {
  if (!Number.isFinite(damage) || damage < 0)
    throw new Error('Invalid damage for shielding');
  if (!hasEffects(state)) return damage;
  let remaining = damage;
  const shields = state.combat.effects
    .filter(
      (effect) =>
        effect.targetId === targetId &&
        effect.kind === 'SHIELD' &&
        effect.startsAtMs <= state.simTimeMs &&
        effect.expiresAtMs > state.simTimeMs,
    )
    .sort(
      (a, b) => a.expiresAtMs - b.expiresAtMs || a.id.localeCompare(b.id, 'en'),
    );
  for (const shield of shields) {
    const absorbed = Math.min(remaining, shield.amount);
    if (absorbed <= 0) continue;
    shield.amount -= absorbed;
    remaining -= absorbed;
    emit(state, {
      kind: 'SHIELD_ABSORBED',
      actorId: shield.sourceId,
      targetId,
      amount: absorbed,
      sourceId: shield.id,
    });
  }
  return remaining;
}

export function advanceEffects(state: EngineState): void {
  if (!hasEffects(state)) return;
  state.combat.effects = state.combat.effects.filter((effect) => {
    const active =
      effect.expiresAtMs > state.simTimeMs &&
      effect.amount > 0 &&
      state.actors.some(
        (actor) => actor.id === effect.targetId && actor.active,
      );
    if (!active)
      emit(state, {
        kind: 'EFFECT_EXPIRED',
        targetId: effect.targetId,
        reason: effect.kind,
      });
    return active;
  });
  for (const actor of state.actors)
    if (actor.active && state.started)
      actor.mana = Math.min(
        actor.maxMana,
        actor.mana +
          (state.input.rules.abilities.manaRegenPerSecond *
            state.input.rules.stepMs) /
            1000,
      );
}
