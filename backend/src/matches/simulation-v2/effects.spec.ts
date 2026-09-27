import { RIOT_CHAMPIONS } from '../../drafts/data/riot-champions';
import { createCombatProfile } from './input-adapter';
import { createDuelInput } from './test-fixtures';
import { createWorldState } from './world-state';
import { createVisionState, MODEL_VISION_RULES } from './vision';
import {
  absorbDamage,
  advanceEffects,
  applyHitControl,
  beginCast,
  cancelCast,
  collectAbilityHits,
  createCombatState,
  getActionSlots,
  getActorActionSlots,
  isCasting,
  isStunned,
  MODEL_ABILITY_RULES,
  movementMultiplier,
} from './effects';

function world(champion = 'Ahri', enemy = 'Darius') {
  const input = createDuelInput();
  input.rules.abilities = { ...MODEL_ABILITY_RULES };
  input.rules.vision = { ...MODEL_VISION_RULES };
  input.actors.forEach((actor, i) => {
    actor.championId = i ? enemy : champion;
    actor.profile = createCombatProfile(actor.championId);
  });
  const state = createWorldState(input);
  state.combat = createCombatState(state.actors.map((actor) => actor.id));
  state.vision = createVisionState(
    state.actors.map((actor) => actor.id),
    input.rules.vision,
  );
  state.actors[0].position = { x: 4900, y: 5100 };
  state.actors[1].position = { x: 5100, y: 4900 };
  return state;
}

describe('versioned model action slots and effects', () => {
  it('covers all 173 real champions without mutating or inventing real spell names', () => {
    expect(RIOT_CHAMPIONS).toHaveLength(173);
    for (const champion of RIOT_CHAMPIONS) {
      const slots = getActionSlots(champion.id);
      expect(slots.length).toBeGreaterThanOrEqual(1);
      expect(Object.isFrozen(slots)).toBe(true);
      for (const slot of slots) {
        expect(slot.id.startsWith('MODEL_')).toBe(true);
        expect(slot.cooldownMs).toBeGreaterThan(0);
        expect(slot.mana).toBeGreaterThanOrEqual(0);
      }
    }
    expect(() => getActionSlots('invented')).toThrow();
  });

  it('is disabled in legacy/early laboratory inputs', () => {
    const state = createWorldState(createDuelInput());
    expect(
      beginCast(state, state.actors[0].id, 'MODEL_STRIKE', state.actors[1].id),
    ).toBe(false);
    expect(collectAbilityHits(state)).toEqual([]);
    expect(absorbDamage(state, state.actors[0].id, 77)).toBe(77);
    expect(movementMultiplier(state, state.actors[0].id)).toBe(1);
  });

  it('validates range, target, mana and cooldown before spending resources', () => {
    const state = world(),
      [actor, target] = state.actors;
    const initial = actor.mana;
    expect(beginCast(state, actor.id, 'MODEL_STRIKE', actor.id)).toBe(false);
    target.position = { x: 8000, y: 2000 };
    expect(beginCast(state, actor.id, 'MODEL_STRIKE', target.id)).toBe(false);
    expect(actor.mana).toBe(initial);
    target.position = { x: 5100, y: 4900 };
    actor.mana = 1;
    expect(beginCast(state, actor.id, 'MODEL_STRIKE', target.id)).toBe(false);
    actor.mana = initial;
    expect(beginCast(state, actor.id, 'MODEL_STRIKE', target.id)).toBe(true);
    expect(actor.mana).toBe(initial - 35);
    expect(beginCast(state, actor.id, 'MODEL_STRIKE', target.id)).toBe(false);
    cancelCast(state, actor.id, 'Test interruption');
    expect(beginCast(state, actor.id, 'MODEL_STRIKE', target.id)).toBe(false);
  });

  it('waits for physical projectile travel and preserves launched damage after caster death', () => {
    const state = world(),
      [actor, target] = state.actors;
    expect(beginCast(state, actor.id, 'MODEL_STRIKE', target.id)).toBe(true);
    state.simTimeMs = 200;
    expect(collectAbilityHits(state)).toEqual([]);
    state.simTimeMs = 300;
    expect(collectAbilityHits(state)).toEqual([]);
    expect(isCasting(state, actor.id)).toBe(false);
    expect(state.combat!.casts[0].launched).toBe(true);
    const arrival = state.combat!.casts[0].arrivesAtMs!;
    expect(arrival).toBeGreaterThan(state.simTimeMs);
    actor.active = false;
    actor.hp = 0;
    cancelCast(state, actor.id, 'Death');
    state.simTimeMs = arrival;
    const before = target.hp;
    const hits = collectAbilityHits(state);
    expect(hits).toHaveLength(1);
    expect(hits[0].victim.id).toBe(target.id);
    expect(hits[0].rawDamage).toBeGreaterThan(0);
    expect(target.hp).toBe(before); // HP is exclusively owned by the common resolver.
    expect(collectAbilityHits(state)).toHaveLength(0);
  });

  it('cancels death during wind-up, but lets targets dodge launched projectiles', () => {
    const state = world(),
      [actor, target] = state.actors;
    beginCast(state, actor.id, 'MODEL_STRIKE', target.id);
    actor.active = false;
    state.simTimeMs = 300;
    expect(collectAbilityHits(state)).toHaveLength(0);
    expect(state.combat!.casts).toHaveLength(0);
    const second = world(),
      [caster, enemy] = second.actors;
    beginCast(second, caster.id, 'MODEL_STRIKE', enemy.id);
    second.simTimeMs = 300;
    collectAbilityHits(second);
    second.simTimeMs = second.combat!.casts[0].arrivesAtMs!;
    enemy.position = { x: 5500, y: 4500 };
    expect(collectAbilityHits(second)).toHaveLength(0);
    expect(second.events.at(-1)?.kind).toBe('CAST_MISS');
  });

  it('CC stops movement and interrupts recall/casting without fabricating damage or kill rewards', () => {
    const state = world('Nautilus'),
      [actor, target] = state.actors;
    target.action = { kind: 'RECALL', completesAtMs: 8000 };
    expect(beginCast(state, actor.id, 'MODEL_CONTROL', target.id)).toBe(true);
    state.simTimeMs = 400;
    const [hit] = collectAbilityHits(state);
    expect(hit.stunMs).toBeGreaterThan(0);
    applyHitControl(state, hit);
    expect(isStunned(state, target.id)).toBe(true);
    expect(movementMultiplier(state, target.id)).toBe(0);
    expect(target.action.kind).toBe('IDLE');
    expect(beginCast(state, target.id, 'MODEL_STRIKE', actor.id)).toBe(false);
    expect(state.ledger).toHaveLength(0);
    state.simTimeMs += hit.stunMs;
    advanceEffects(state);
    expect(isStunned(state, target.id)).toBe(false);
  });

  it('shield absorbs a finite budget, then expires; it never heals HP', () => {
    const state = world('Lulu'),
      [actor] = state.actors;
    actor.hp = 100;
    expect(beginCast(state, actor.id, 'MODEL_GUARD', actor.id)).toBe(true);
    state.simTimeMs = 200;
    expect(collectAbilityHits(state)).toEqual([]);
    const shield = state.combat!.effects[0].amount;
    expect(absorbDamage(state, actor.id, shield + 30)).toBeCloseTo(30);
    expect(actor.hp).toBe(100);
    expect(absorbDamage(state, actor.id, 50)).toBe(50);
    advanceEffects(state);
    expect(state.combat!.effects).toHaveLength(0);
    expect(() => absorbDamage(state, actor.id, NaN)).toThrow();
  });

  it('reposition creates a route and temporary speed, never teleports', () => {
    const state = world('Garen'),
      [actor] = state.actors;
    const before = { ...actor.position };
    expect(
      beginCast(state, actor.id, 'MODEL_REPOSITION', undefined, {
        x: 5200,
        y: 5000,
      }),
    ).toBe(true);
    state.simTimeMs = 200;
    collectAbilityHits(state);
    expect(actor.position).toEqual(before);
    expect(actor.path.length).toBeGreaterThan(0);
    expect(movementMultiplier(state, actor.id)).toBe(1.75);
    state.simTimeMs = 1700;
    advanceEffects(state);
    expect(movementMultiplier(state, actor.id)).toBe(1);
  });

  it('restricts smite to assigned junglers and visible monsters, with a real cooldown', () => {
    const input = createDuelInput();
    input.rules.abilities = { ...MODEL_ABILITY_RULES };
    input.actors[0].position = 'JUNGLE';
    const state = createWorldState(input);
    state.combat = createCombatState(state.actors.map((actor) => actor.id));
    const actor = state.actors[0];
    const monster = {
      ...structuredClone(state.actors[1]),
      id: 'camp:test',
      kind: 'CAMP' as const,
      side: null,
      position: { ...actor.position },
      hp: 500,
      maxHp: 500,
    };
    state.units.push(monster);
    expect(
      getActorActionSlots(actor.input).some(
        (slot) => slot.id === 'MODEL_SMITE',
      ),
    ).toBe(true);
    expect(
      beginCast(state, state.actors[1].id, 'MODEL_SMITE', monster.id),
    ).toBe(false);
    expect(beginCast(state, actor.id, 'MODEL_SMITE', state.actors[1].id)).toBe(
      false,
    );
    expect(beginCast(state, actor.id, 'MODEL_SMITE', monster.id)).toBe(true);
    const [hit] = collectAbilityHits(state);
    expect(hit.rawDamage).toBe(600);
    expect(hit.trueDamage).toBe(true);
    expect(beginCast(state, actor.id, 'MODEL_SMITE', monster.id)).toBe(false);
  });
});
