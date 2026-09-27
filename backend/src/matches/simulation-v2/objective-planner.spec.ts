import type {
  ActorState,
  EngineState,
  Observation,
  UnitState,
  UnitView,
} from './contracts';
import { createLabInput } from './test-fixtures';
import { createWorldState } from './world-state';
import { createBattleRuleset } from './battle-rules';
import { advanceEnvironment, initializeEnvironment } from './environment';
import {
  battlePublicInformation,
  planBattleActors,
  type BattlePublicInformation,
} from './battle-planner';
import { createCombatState } from './effects';

function scenario(atMs = 300_000): EngineState {
  const input = createLabInput(191);
  input.rules = createBattleRuleset();
  const state = createWorldState(input);
  initializeEnvironment(state);
  state.combat = createCombatState(state.actors.map((actor) => actor.id));
  state.simTimeMs = atMs;
  advanceEnvironment(state);
  for (const actor of state.actors.filter((value) => value.side === 'BLUE')) {
    actor.position = { x: 6300, y: 6300 };
    actor.level = 9;
  }
  return state;
}

function view(unit: UnitState): UnitView {
  return {
    id: unit.id,
    kind: unit.kind,
    side: unit.side,
    position: { ...unit.position },
    hp: unit.hp,
    maxHp: unit.maxHp,
    active: unit.active,
    attackRange: unit.attackRange,
  };
}

function observation(state: EngineState): Observation {
  return {
    atMs: state.simTimeMs,
    side: 'BLUE',
    allies: structuredClone(
      state.actors.filter((actor) => actor.side === 'BLUE'),
    ),
    visible: state.units
      .filter((unit) => unit.id === 'objective:DRAGON' && unit.active)
      .map(view),
    remembered: [],
    estimates: [],
    friendlyMinions: [],
  };
}

function plan(
  state: EngineState,
  observed = observation(state),
  overrides: Partial<BattlePublicInformation> = {},
) {
  const info = battlePublicInformation(state, 'BLUE');
  info.objectives = info.objectives.filter(
    (objective) => objective.type === 'DRAGON',
  );
  for (const own of Object.values(info.own)) own.wardCharges = 0;
  return planBattleActors(observed, state.input, structuredClone(state.rng), {
    ...info,
    ...overrides,
  });
}

function addMemory(observed: Observation, unit: UnitView): void {
  observed.remembered.push({ atMs: observed.atMs - 1000, unit });
  observed.estimates!.push({
    unitId: unit.id,
    lastPosition: { ...unit.position },
    lastSeenAtMs: observed.atMs - 1000,
    source: 'LAST_SEEN',
    confidence: 0.96,
    uncertaintyRadius: unit.active ? 500 : 0,
  });
}

describe('bounded objective decisions', () => {
  it('preserves an interrupted setup deadline until its original expiry and then backs off', () => {
    const state = scenario();
    const actors = state.actors.filter((actor) => actor.side === 'BLUE');
    for (const actor of actors) actor.position = { x: 5300, y: 6000 };
    const adc = actors.find((actor) => actor.input.position === 'ADC')!;
    adc.position = { x: 6300, y: 6300 };
    const first = plan(state);
    expect(first.plans[adc.id].kind).toBe('SETUP');
    adc.plan = first.plans[adc.id];
    const initial = structuredClone(adc.plan);
    state.simTimeMs += 9000;
    const own = battlePublicInformation(state, 'BLUE').own;
    own[adc.id].busy = true;
    const blocked = plan(state, observation(state), { own });
    expect(blocked.plans[adc.id]).toBeUndefined();
    expect(blocked.intents.some((intent) => intent.actorId === adc.id)).toBe(
      false,
    );
    expect(adc.plan).toEqual(initial);
    state.simTimeMs += 1000;
    const resumed = plan(state);
    expect(resumed.plans[adc.id]).toMatchObject({
      kind: 'SETUP',
      createdAtMs: initial.createdAtMs,
      expiresAtMs: initial.expiresAtMs,
    });
    adc.plan = resumed.plans[adc.id];
    state.simTimeMs = initial.expiresAtMs;
    const blockedAtExpiry = plan(state, observation(state), { own });
    expect(blockedAtExpiry.plans[adc.id]).toBeUndefined();
    state.simTimeMs += 1000;
    const expired = plan(state);
    expect(expired.plans[adc.id].kind).not.toBe('SETUP');
    expect(expired.plans[adc.id].objectiveBackoff).toEqual({
      id: 'objective:DRAGON',
      untilMs: state.simTimeMs + 20_000,
    });
    adc.plan = expired.plans[adc.id];
    state.simTimeMs += 1000;
    expect(plan(state).plans[adc.id].kind).not.toBe('SETUP');
  });

  it('omits busy siege replacements without changing the fixed actor RNG draw schedule', () => {
    const state = scenario(280_000);
    const actor = state.actors.find((value) => value.side === 'BLUE')!;
    actor.plan = {
      kind: 'SIEGE',
      point: { x: 5000, y: 5000 },
      targetId: 'structure:RED:MID:OUTER',
      reason: 'Existing lane rotation',
      createdAtMs: 275_000,
      expiresAtMs: 300_000,
      siegeLane: {
        lane: 'MID',
        targetId: 'structure:RED:MID:OUTER',
        createdAtMs: 275_000,
        expiresAtMs: 300_000,
      },
      objectiveBackoff: { id: 'objective:DRAGON', untilMs: 295_000 },
    };
    const prior = structuredClone(actor.plan);
    const observed = observation(state);
    const freeRng = structuredClone(state.rng);
    const busyRng = structuredClone(state.rng);
    const info = battlePublicInformation(state, 'BLUE');
    planBattleActors(observed, state.input, freeRng, info);
    info.own[actor.id].busy = true;
    const result = planBattleActors(observed, state.input, busyRng, info);
    expect(result.plans[actor.id]).toBeUndefined();
    expect(result.intents.some((intent) => intent.actorId === actor.id)).toBe(
      false,
    );
    expect(actor.plan).toEqual(prior);
    expect(busyRng).toEqual(freeRng);
  });

  it('holds an arrived setup through repeated decisions without extending its spawn deadline', () => {
    const state = scenario(280_000);
    const first = plan(state);
    expect(first.intents.every((intent) => intent.kind === 'HOLD')).toBe(true);
    for (const actor of state.actors.filter((value) => value.side === 'BLUE')) {
      expect(first.plans[actor.id]).toMatchObject({
        kind: 'SETUP',
        targetId: 'objective:DRAGON',
        createdAtMs: 280_000,
        expiresAtMs: 310_000,
      });
      actor.plan = first.plans[actor.id];
    }
    state.simTimeMs = 285_000;
    const second = plan(state);
    expect(second.intents.every((intent) => intent.kind === 'HOLD')).toBe(true);
    expect(
      Object.values(second.plans).every(
        (value) => value.expiresAtMs === 310_000,
      ),
    ).toBe(true);
    state.simTimeMs = 300_000;
    advanceEnvironment(state);
    expect(
      Object.values(plan(state).plans).every(
        (value) => value.kind === 'OBJECTIVE',
      ),
    ).toBe(true);
  });

  it('abandons expired setup instead of refreshing its preparation deadline', () => {
    const state = scenario(280_000);
    for (const actor of state.actors.filter((value) => value.side === 'BLUE'))
      actor.plan = {
        kind: 'SETUP',
        point: { x: 6300, y: 6300 },
        targetId: 'objective:DRAGON',
        reason: 'Prior unfulfilled setup',
        createdAtMs: 250_000,
        expiresAtMs: 280_000,
      };
    const expired = plan(state);
    expect(
      Object.values(expired.plans).every((value) => value.kind !== 'SETUP'),
    ).toBe(true);
    for (const actor of state.actors.filter((value) => value.side === 'BLUE')) {
      expect(expired.plans[actor.id].objectiveBackoff).toEqual({
        id: 'objective:DRAGON',
        untilMs: 300_000,
      });
      actor.plan = expired.plans[actor.id];
    }
    state.simTimeMs += 1000;
    expect(
      Object.values(plan(state).plans).every((value) => value.kind !== 'SETUP'),
    ).toBe(true);
  });

  it('does not prepare when even all predicted joiners cannot survive the estimated objective damage', () => {
    const state = scenario(280_000);
    for (const actor of state.actors.filter((value) => value.side === 'BLUE'))
      actor.attackDamage = 1;
    expect(
      Object.values(plan(state).plans).every((value) => value.kind !== 'SETUP'),
    ).toBe(true);
  });

  it('ignores remembered non-champions, dead champions and friendly champions when estimating contest', () => {
    const state = scenario();
    const observed = observation(state);
    const expected = plan(state, observed);
    for (let index = 0; index < 24; index++)
      addMemory(observed, {
        id: `remembered:${index}`,
        kind:
          index < 6
            ? 'MINION'
            : index < 12
              ? 'CAMP'
              : index < 18
                ? 'CHAMPION'
                : 'TURRET',
        side: index < 12 ? 'RED' : index < 18 ? 'BLUE' : 'RED',
        position: { x: 6300, y: 6300 },
        hp: 200,
        maxHp: 200,
        active: true,
        attackRange: 200,
      });
    addMemory(observed, {
      ...view(state.actors.find((actor) => actor.side === 'RED')!),
      position: { x: 6300, y: 6300 },
      hp: 0,
      active: false,
    });
    expect(plan(state, observed)).toEqual(expected);
  });

  it('counts a living unseen enemy champion once and does not count its currently visible memory twice', () => {
    const state = scenario();
    const observed = observation(state);
    const enemy = {
      ...view(state.actors.find((actor) => actor.side === 'RED')!),
      position: { x: 8400, y: 6300 },
    };
    addMemory(observed, enemy);
    const unseen = plan(state, observed);
    expect(
      Object.values(unseen.plans).every((value) =>
        value.reason.includes('contest 0.25'),
      ),
    ).toBe(true);
    observed.visible.push(enemy);
    const seen = plan(state, observed);
    expect(
      Object.values(seen.plans).every((value) =>
        value.reason.endsWith('contest 1'),
      ),
    ).toBe(true);
  });

  function continuingScenario(): {
    state: EngineState;
    participants: ActorState[];
  } {
    const state = scenario();
    const participants = state.actors.filter(
      (actor) =>
        actor.side === 'BLUE' &&
        ['ADC', 'SUPPORT'].includes(actor.input.position),
    );
    for (const actor of state.actors.filter((value) => value.side === 'BLUE')) {
      actor.position = { ...state.input.map.bases.BLUE };
      if (!participants.includes(actor)) continue;
      actor.position = { x: 6200, y: 6300 };
      actor.hp =
        actor.maxHp * (actor.input.position === 'SUPPORT' ? 0.49 : 0.7);
      actor.action = { kind: 'ATTACK', targetId: 'objective:DRAGON' };
      actor.plan = {
        kind: 'OBJECTIVE',
        targetId: 'objective:DRAGON',
        point: { x: 6300, y: 6300 },
        reason: 'Prior objective attack',
        createdAtMs: state.simTimeMs - 1000,
        expiresAtMs: state.simTimeMs + 7000,
      };
    }
    state.units.find((unit) => unit.id === 'objective:DRAGON')!.hp = 100;
    return { state, participants };
  }

  it('finishes a safe observed objective when an engaged participant crosses the starting health threshold', () => {
    const { state, participants } = continuingScenario();
    const result = plan(state);
    for (const actor of participants) {
      expect(
        result.intents.find((intent) => intent.actorId === actor.id),
      ).toMatchObject({
        kind: 'ATTACK',
        targetId: 'objective:DRAGON',
      });
      expect(result.plans[actor.id].reason).toContain('Continue DRAGON');
    }
  });

  it('does not retain an objective attack when the observed remaining fight is no longer survivable', () => {
    const { state, participants } = continuingScenario();
    state.units.find((unit) => unit.id === 'objective:DRAGON')!.hp = 4200;
    for (const actor of participants) actor.attackDamage = 1;
    const result = plan(state);
    for (const actor of participants)
      expect(result.plans[actor.id].kind).not.toBe('OBJECTIVE');
  });

  it('converts an active siege buff instead of beginning another objective setup or attack', () => {
    for (const atMs of [280_000, 300_000]) {
      const state = scenario(atMs);
      const result = plan(state, observation(state), {
        siegeBuffUntilMs: atMs + 120_000,
      });
      expect(
        Object.values(result.plans).every(
          (value) => !['SETUP', 'OBJECTIVE'].includes(value.kind),
        ),
      ).toBe(true);
    }
  });

  it('allows finishing an already engaged monster and immediate Smite during a siege buff', () => {
    const { state, participants } = continuingScenario();
    const result = plan(state, observation(state), {
      siegeBuffUntilMs: state.simTimeMs + 120_000,
    });
    for (const actor of participants)
      expect(result.plans[actor.id].kind).toBe('OBJECTIVE');
    const jungler = state.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'JUNGLE',
    )!;
    jungler.position = { x: 6300, y: 6300 };
    const smite = plan(state, observation(state), {
      siegeBuffUntilMs: state.simTimeMs + 120_000,
    });
    expect(
      smite.intents.find((intent) => intent.actorId === jungler.id),
    ).toMatchObject({
      kind: 'CAST',
      slotId: 'MODEL_SMITE',
      targetId: 'objective:DRAGON',
    });
  });
});
