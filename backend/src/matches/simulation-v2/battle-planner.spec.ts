import type {
  EngineState,
  Observation,
  Point,
  UnitState,
  UnitView,
} from './contracts';
import { createLabInput } from './test-fixtures';
import { createWorldState } from './world-state';
import { createBattleRuleset } from './battle-rules';
import {
  advanceEnvironment,
  initializeEnvironment,
  structureId,
} from './environment';
import {
  battlePublicInformation,
  planBattleActors,
  type BattlePublicInformation,
} from './battle-planner';
import { createCombatState } from './effects';
import { observe } from './observation';
import { distance } from './map-paths';

function scenario(): EngineState {
  const input = createLabInput(191);
  input.rules = createBattleRuleset();
  const state = createWorldState(input);
  initializeEnvironment(state);
  state.combat = createCombatState(state.actors.map((actor) => actor.id));
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
    visible: [],
    remembered: [],
    friendlyMinions: [],
  };
}
function plan(
  state: EngineState,
  observed = observation(state),
  info = battlePublicInformation(state, 'BLUE'),
) {
  return planBattleActors(
    observed,
    state.input,
    structuredClone(state.rng),
    info,
  );
}
function placeTeam(state: EngineState, point: Point, level = 9): void {
  state.actors
    .filter((actor) => actor.side === 'BLUE')
    .forEach((actor, index) => {
      actor.position = { x: point.x + index * 15, y: point.y };
      actor.level = level;
    });
}
function enemy(state: EngineState, index: number, point: Point): UnitView {
  const actor = state.actors.filter((actor) => actor.side === 'RED')[index];
  return { ...view(actor), position: point };
}
function wave(point: Point, index = 0): UnitView {
  return {
    id: `test-wave:${index}`,
    kind: 'MINION',
    side: 'BLUE',
    position: { ...point },
    hp: 280,
    maxHp: 280,
    active: true,
    attackRange: 220,
  };
}

describe('observation-only battle planning', () => {
  it.each([0.05, 0.29, 0.6])(
    'holds for real fountain healing at %s HP rather than restarting recall',
    (healthFraction) => {
      const state = scenario();
      placeTeam(state, state.input.map.bases.BLUE);
      const adc = state.actors.find(
        (actor) => actor.side === 'BLUE' && actor.input.position === 'ADC',
      )!;
      adc.hp = adc.maxHp * healthFraction;
      adc.mana = adc.maxMana * 0.2;
      const result = plan(state);
      expect(
        result.intents.find((intent) => intent.actorId === adc.id)?.kind,
      ).toBe('HOLD');
      expect(result.plans[adc.id].kind).toBe('RECOVER');
      expect(adc.hp).toBe(adc.maxHp * healthFraction);
    },
  );

  it('does not recall with 1800 gold when the only unbought upgrade costs 2600, but recalls when it becomes affordable', () => {
    const state = scenario();
    placeTeam(state, { x: 5000, y: 5000 });
    const adc = state.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'ADC',
    )!;
    adc.items = state.input.rules.items
      .filter((item) => item.id !== 'MODEL_CAPSTONE')
      .map((item) => item.id);
    adc.gold = 1800;
    const result = plan(state);
    expect(
      result.intents.find((intent) => intent.actorId === adc.id)?.kind,
    ).not.toBe('RECALL');
    adc.gold = 2600;
    expect(
      plan(state).intents.find((intent) => intent.actorId === adc.id),
    ).toMatchObject({
      kind: 'RECALL',
      reason: 'Convert earned gold to actual shop inventory',
    });
  });

  it('escorts its MID wave instead of a closer TOP wave passing the same structure', () => {
    const state = scenario();
    placeTeam(state, { x: 5000, y: 5000 });
    const observed = observation(state);
    const target = state.units.find(
      (unit) => unit.id === structureId('RED', 'MID', 'OUTER'),
    )!;
    const correctPoint = {
      x: target.position.x - 900,
      y: target.position.y + 900,
    };
    observed.friendlyMinions = [
      { ...wave(target.position), id: 'wave:20:TOP:BLUE:0' },
      ...Array.from({ length: 6 }, (_, i) => ({
        ...wave(correctPoint, i),
        id: `wave:20:MID:BLUE:${i}`,
      })),
    ];
    const info = battlePublicInformation(state, 'BLUE');
    info.objectives = [];
    const result = plan(state, observed, info);
    const adc = observed.allies.find(
      (actor) => actor.input.position === 'ADC',
    )!;
    expect(result.plans[adc.id].kind).toBe('SIEGE');
    expect(result.plans[adc.id].point).toEqual(correctPoint);
    expect(result.plans[adc.id].point).not.toEqual(target.position);
    expect(result.plans[adc.id].reason).toContain('MID');
  });

  it('prioritizes an observed unlocked nexus with an arrived wave over chasing its nearby defender', () => {
    const state = scenario();
    placeTeam(state, { x: 9100, y: 800 }, 15);
    state.units
      .filter(
        (unit) =>
          unit.side === 'RED' &&
          (unit.lane === 'TOP' || unit.structure?.type === 'NEXUS_TURRET'),
      )
      .forEach((unit) => {
        unit.active = false;
        unit.hp = 0;
      });
    const nexus = state.units.find(
      (unit) => unit.id === 'structure:RED:NEXUS',
    )!;
    const observed = observation(state);
    observed.visible = [view(nexus), enemy(state, 0, { x: 9300, y: 700 })];
    observed.friendlyMinions = [wave(nexus.position)];
    const result = plan(state, observed);
    const adc = observed.allies.find(
      (actor) => actor.input.position === 'ADC',
    )!;
    expect(
      result.intents.find((intent) => intent.actorId === adc.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: nexus.id });
    expect(result.plans[adc.id].reason).toContain('base opening');
    expect(state.winnerTeamId).toBeNull();
  });

  it('makes an identical first decision and RNG transition after changing unseen enemy HP, position and cooldown', () => {
    const state = scenario();
    state.simTimeMs = 100_000;
    const initial = observe(state, 'BLUE');
    const initialInfo = battlePublicInformation(state, 'BLUE');
    const rng = structuredClone(state.rng);
    const before = planBattleActors(initial, state.input, rng, initialInfo);
    const hidden = state.actors.find((actor) => actor.side === 'RED')!;
    hidden.hp = 1;
    hidden.mana = 1;
    hidden.gold = 9000;
    hidden.position = { x: 9200, y: 900 };
    state.combat!.cooldowns[hidden.id] = { MODEL_STRIKE: 900_000 };
    const afterObservation = observe(state, 'BLUE');
    const afterInfo = battlePublicInformation(state, 'BLUE');
    expect(afterObservation).toEqual(initial);
    expect(afterInfo).toEqual(initialInfo);
    const afterRng = structuredClone(state.rng);
    expect(
      planBattleActors(afterObservation, state.input, afterRng, afterInfo),
    ).toEqual(before);
    expect(afterRng).toEqual(rng);
  });

  it('prepares by physically walking before a due objective and cannot attack its future body', () => {
    const state = scenario();
    state.simTimeMs = 280_000;
    placeTeam(state, { x: 5300, y: 6000 }, 5);
    const jungler = state.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'JUNGLE',
    )!;
    const result = plan(state);
    expect(result.plans[jungler.id].kind).toBe('SETUP');
    expect(
      result.intents.find((intent) => intent.actorId === jungler.id)?.kind,
    ).toBe('MOVE');
    expect(result.plans[jungler.id].point).toEqual({ x: 6300, y: 6300 });
    expect(state.events).toHaveLength(0);
    expect(state.environment!.teams.BLUE.dragons).toBe(0);
    expect(state.ledger).toHaveLength(0);
  });

  it('commits a visible objective only after enough healthy units physically arrive', () => {
    const state = scenario();
    state.simTimeMs = 300_000;
    advanceEnvironment(state);
    placeTeam(state, { x: 5900, y: 6300 }, 6);
    const observed = observation(state);
    const dragon = state.units.find((unit) => unit.id === 'objective:DRAGON')!;
    observed.visible.push(view(dragon));
    const jungler = observed.allies.find(
      (actor) => actor.input.position === 'JUNGLE',
    )!;
    const result = plan(state, observed);
    expect(result.plans[jungler.id].kind).toBe('OBJECTIVE');
    expect(
      result.intents.find((intent) => intent.actorId === jungler.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: dragon.id });
    expect(result.plans[jungler.id].reason).toContain('arrived');
  });

  it('does not start Baron merely because five units face four when their actual damage and health cannot finish it', () => {
    const state = scenario();
    state.simTimeMs = 1_200_000;
    advanceEnvironment(state);
    placeTeam(state, { x: 3700, y: 4500 }, 11);
    state.actors
      .filter((actor) => actor.side === 'BLUE')
      .forEach((actor) => {
        actor.hp = actor.maxHp * 0.55;
        actor.attackDamage = 1;
      });
    const observed = observation(state);
    const baron = state.units.find((unit) => unit.id === 'objective:BARON')!;
    observed.visible.push(view(baron));
    for (let i = 0; i < 4; i++)
      observed.visible.push(enemy(state, i, { x: 1800, y: 3700 + i * 20 }));
    const info = battlePublicInformation(state, 'BLUE');
    info.objectives = info.objectives.filter((entry) => entry.id === baron.id);
    const result = plan(state, observed, info);
    expect(
      result.intents.some(
        (intent) => intent.kind === 'ATTACK' && intent.targetId === baron.id,
      ),
    ).toBe(false);
    expect(state.environment!.teams.BLUE.baronUntilMs).toBe(0);
  });

  it('preserves a give-and-trade decision rather than overwriting it with default siege', () => {
    const state = scenario();
    state.simTimeMs = 300_000;
    advanceEnvironment(state);
    const adc = state.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'ADC',
    )!;
    state.actors
      .filter((actor) => actor.side === 'BLUE')
      .forEach((actor) => {
        actor.level = 10;
        actor.position = { x: 700, y: 1000 };
      });
    adc.position = { x: 5500, y: 6300 };
    const observed = observation(state);
    for (let i = 0; i < 3; i++)
      observed.visible.push(enemy(state, i, { x: 7700, y: 6000 + i * 20 }));
    const result = plan(state, observed);
    expect(result.plans[adc.id].kind).toBe('TRADE');
    expect(
      result.intents.find((intent) => intent.actorId === adc.id)?.kind,
    ).toBe('MOVE');
    expect(result.plans[adc.id].reason).toContain('no free reward');
    expect(
      distance(result.plans[adc.id].point, { x: 6300, y: 6300 }),
    ).toBeGreaterThan(3000);
    expect(state.ledger).toHaveLength(0);
  });

  it('does not fabricate an opposite objective when no valid structure trade exists', () => {
    const state = scenario();
    state.simTimeMs = 300_000;
    advanceEnvironment(state);
    placeTeam(state, { x: 5300, y: 6000 }, 9);
    const observed = observation(state);
    for (let i = 0; i < 5; i++)
      observed.visible.push(enemy(state, i, { x: 7700, y: 6000 + i * 20 }));
    const info = battlePublicInformation(state, 'BLUE');
    info.structures = [];
    const result = plan(state, observed, info);
    expect(
      Object.values(result.plans).some((value) => value.kind === 'TRADE'),
    ).toBe(false);
    expect(state.ledger).toHaveLength(0);
    expect(state.environment!.teams.BLUE.dragons).toBe(0);
  });

  it.each(['TOP', 'MID', 'BOT'] as const)(
    'selects %s from real wave pressure, not a permanent bottom-lane finish',
    (lane) => {
      const state = scenario();
      placeTeam(state, { x: 5000, y: 5000 });
      const observed = observation(state);
      const target = state.units.find(
        (unit) => unit.id === structureId('RED', lane, 'OUTER'),
      )!;
      observed.friendlyMinions = Array.from({ length: 12 }, (_, i) =>
        wave(target.position, i),
      );
      const info = battlePublicInformation(state, 'BLUE');
      info.objectives = [];
      const result = plan(state, observed, info);
      const adc = observed.allies.find(
        (actor) => actor.input.position === 'ADC',
      )!;
      expect(result.plans[adc.id].kind).toBe('SIEGE');
      expect(result.plans[adc.id].point).toEqual(target.position);
      expect(result.plans[adc.id].reason).toContain(lane);
    },
  );

  it('retreats outside a live turret without a real wave and attacks only when the wave arrives', () => {
    const state = scenario();
    const target = state.units.find(
      (unit) => unit.id === structureId('RED', 'MID', 'OUTER'),
    )!;
    placeTeam(state, {
      x: target.position.x - 500,
      y: target.position.y + 500,
    });
    const observed = observation(state);
    observed.visible.push(view(target));
    const info = battlePublicInformation(state, 'BLUE');
    info.objectives = [];
    const without = plan(state, observed, info);
    const adc = observed.allies.find(
      (actor) => actor.input.position === 'ADC',
    )!;
    expect(without.plans[adc.id].kind).toBe('RETREAT');
    observed.friendlyMinions = Array.from({ length: 6 }, (_, i) =>
      wave(target.position, i),
    );
    const withWave = plan(state, observed, info);
    expect(
      withWave.intents.find((intent) => intent.actorId === adc.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: target.id });
  });

  it('keeps a remote side-laner on a different task while a local fight resolves elsewhere', () => {
    const state = scenario();
    state.simTimeMs = 100_000;
    const top = state.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'TOP',
    )!;
    const adc = state.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'ADC',
    )!;
    const support = state.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'SUPPORT',
    )!;
    top.position = { x: 700, y: 3000 };
    adc.position = { x: 6500, y: 9300 };
    support.position = { x: 6200, y: 9300 };
    const observed = observation(state);
    observed.visible.push(enemy(state, 3, { x: 6800, y: 9300 }));
    const info: BattlePublicInformation = battlePublicInformation(
      state,
      'BLUE',
    );
    info.objectives = [];
    const result = plan(state, observed, info);
    expect(result.plans[adc.id].kind).toBe('GANK');
    expect(result.plans[top.id].kind).not.toBe('GANK');
    expect(distance(result.plans[top.id].point, adc.position)).toBeGreaterThan(
      3000,
    );
  });
});
