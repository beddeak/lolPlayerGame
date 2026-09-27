import { createLabInput } from './test-fixtures';
import { createBattleRuleset } from './battle-rules';
import { startSimulation } from './engine';
import { battlePublicInformation, planBattleActors } from './battle-planner';
import type {
  EngineState,
  Observation,
  UnitState,
  UnitView,
} from './contracts';
import { distance, findPath } from './map-paths';

function fixture() {
  const input = createLabInput(191);
  input.rules = createBattleRuleset();
  const state = startSimulation(input);
  state.simTimeMs = 1_200_000;
  state.actors.forEach((actor) => {
    actor.level = 11;
    actor.position =
      actor.side === 'BLUE' ? { x: 5000, y: 5000 } : { x: 9300, y: 700 };
  });
  return state;
}
const view = (unit: UnitState): UnitView => ({
  id: unit.id,
  kind: unit.kind,
  side: unit.side,
  position: { ...unit.position },
  hp: unit.hp,
  maxHp: unit.maxHp,
  active: unit.active,
  attackRange: unit.attackRange,
});
function observe(state: EngineState): Observation {
  return {
    atMs: state.simTimeMs,
    side: 'BLUE',
    allies: structuredClone(state.actors.filter((a) => a.side === 'BLUE')),
    visible: [],
    remembered: [],
    friendlyMinions: [],
  };
}
function decide(state: EngineState, observed: Observation) {
  const info = battlePublicInformation(state, 'BLUE');
  info.objectives = [];
  return planBattleActors(
    observed,
    state.input,
    structuredClone(state.rng),
    info,
  );
}

describe('bounded macro rotation and siege conversion', () => {
  it('retains a live rotation across a tiny defender visibility-boundary change', () => {
    const state = fixture();
    const observed = observe(state);
    const top = state.units.find((u) => u.id === 'structure:RED:TOP:OUTER')!;
    const defender = view(state.actors.find((a) => a.side === 'RED')!);
    defender.position = { x: top.position.x + 1810, y: top.position.y };
    observed.visible = [defender];
    const first = decide(state, observed);
    const adc = observed.allies.find((a) => a.input.position === 'ADC')!;
    expect(first.plans[adc.id].siegeLane?.lane).toBe('TOP');
    adc.plan = first.plans[adc.id];
    observed.atMs += 1000;
    defender.position.x -= 20;
    const second = decide(state, observed);
    expect(second.plans[adc.id].siegeLane).toEqual(
      first.plans[adc.id].siegeLane,
    );
    expect(second.plans[adc.id].reason).toContain('TOP');
    observed.atMs += 30_000;
    expect(decide(state, observed).plans[adc.id].siegeLane?.lane).toBe('MID');
  });

  it('can abandon an active rotation when a different lane develops substantial real pressure', () => {
    const state = fixture();
    const observed = observe(state);
    const adc = observed.allies.find((a) => a.input.position === 'ADC')!;
    const first = decide(state, observed);
    adc.plan = first.plans[adc.id];
    const bot = state.units.find((u) => u.id === 'structure:RED:BOT:OUTER')!;
    observed.friendlyMinions = Array.from({ length: 18 }, (_, i) => ({
      ...view(bot),
      id: `wave:40:BOT:BLUE:${i}`,
      kind: 'MINION' as const,
      side: 'BLUE' as const,
      hp: 500,
      maxHp: 500,
    }));
    observed.atMs += 1000;
    expect(decide(state, observed).plans[adc.id].siegeLane?.lane).toBe('BOT');
  });

  it('keeps a fully equipped jungler rotating with the team even before a siege wave arrives', () => {
    const state = fixture();
    const observed = observe(state);
    const jungler = observed.allies.find((a) => a.input.position === 'JUNGLE')!;
    jungler.items = state.input.rules.items.map((item) => item.id);
    const result = decide(state, observed);
    expect(result.plans[jungler.id].kind).toBe('SIEGE');
    expect(result.plans[jungler.id].siegeLane).toBeDefined();
    expect(
      result.intents.find((intent) => intent.actorId === jungler.id)?.kind,
    ).toBe('MOVE');
  });

  it('converts a low-health legal structure with the arrived wave instead of chasing a nearby defender', () => {
    const state = fixture();
    const tower = state.units.find((u) => u.id === 'structure:RED:MID:OUTER')!;
    tower.hp = 30;
    const observed = observe(state);
    observed.allies.forEach((a) => {
      a.position = { x: tower.position.x - 550, y: tower.position.y + 20 };
    });
    const defender = view(state.actors.find((a) => a.side === 'RED')!);
    defender.position = { x: tower.position.x - 650, y: tower.position.y + 20 };
    observed.visible = [view(tower), defender];
    observed.friendlyMinions = [
      {
        ...view(tower),
        id: 'wave:50:MID:BLUE:0',
        kind: 'MINION',
        side: 'BLUE',
        hp: 500,
        maxHp: 500,
      },
    ];
    const adc = observed.allies.find((a) => a.input.position === 'ADC')!;
    expect(
      decide(state, observed).intents.find(
        (intent) => intent.actorId === adc.id,
      ),
    ).toMatchObject({ kind: 'ATTACK', targetId: tower.id });
    expect(state.units.find((u) => u.id === tower.id)?.hp).toBe(30);
    expect(state.winnerTeamId).toBeNull();
  });

  it('a remembered siege never overrides retreat from an unprotected live turret', () => {
    const state = fixture();
    const observed = observe(state);
    const adc = observed.allies.find((a) => a.input.position === 'ADC')!;
    adc.plan = decide(state, observed).plans[adc.id];
    const tower = state.units.find((u) => u.id === 'structure:RED:MID:OUTER')!;
    adc.position = { x: tower.position.x - 500, y: tower.position.y };
    observed.visible = [view(tower)];
    expect(decide(state, observed).plans[adc.id].kind).toBe('RETREAT');
  });

  it('immediately attacks an in-range structure when its wave arrives during movement to a staging point', () => {
    const state = fixture();
    const observed = observe(state);
    const tower = state.units.find((u) => u.id === 'structure:RED:MID:OUTER')!;
    const adc = observed.allies.find((a) => a.input.position === 'ADC')!;
    adc.position = { x: 5530, y: 4500 };
    const staging = { x: 5046.82720163547, y: 4953.17279836453 };
    adc.action = { kind: 'MOVE', goal: staging };
    adc.path = findPath(state.input.map, adc.position, staging)!;
    adc.plan = {
      kind: 'SIEGE',
      point: staging,
      targetId: null,
      reason: 'Wait outside turret range for the next wave',
      createdAtMs: observed.atMs - 1000,
      expiresAtMs: observed.atMs + 7000,
      siegeLane: {
        lane: 'MID',
        targetId: tower.id,
        createdAtMs: observed.atMs - 1000,
        expiresAtMs: observed.atMs + 24_000,
      },
    };
    observed.visible = [view(tower)];
    observed.friendlyMinions = [
      {
        ...view(tower),
        id: 'wave:50:MID:BLUE:0',
        kind: 'MINION',
        side: 'BLUE',
        hp: 500,
        maxHp: 500,
      },
    ];
    expect(distance(adc.position, tower.position)).toBeLessThan(
      adc.attackRange,
    );
    const result = decide(state, observed);
    expect(
      result.intents.find((intent) => intent.actorId === adc.id),
    ).toMatchObject({
      kind: 'ATTACK',
      targetId: tower.id,
    });
    expect(result.plans[adc.id].siegeLane).toEqual(adc.plan.siegeLane);
  });

  it('rechecks a retained route when its protecting wave disappears before the actor reaches turret range', () => {
    const state = fixture();
    const observed = observe(state);
    const tower = state.units.find((u) => u.id === 'structure:RED:MID:OUTER')!;
    const adc = observed.allies.find((a) => a.input.position === 'ADC')!;
    adc.position = { x: 5030, y: 5000 };
    const oldGoal = { x: 5700, y: 4300 };
    adc.action = { kind: 'MOVE', goal: oldGoal };
    adc.path = findPath(state.input.map, adc.position, oldGoal)!;
    adc.plan = {
      kind: 'SIEGE',
      point: oldGoal,
      targetId: null,
      reason: 'Escort a wave that was previously under the tower',
      createdAtMs: observed.atMs - 1000,
      expiresAtMs: observed.atMs + 7000,
      siegeLane: {
        lane: 'MID',
        targetId: tower.id,
        createdAtMs: observed.atMs - 1000,
        expiresAtMs: observed.atMs + 24_000,
      },
    };
    observed.visible = [view(tower)];
    observed.friendlyMinions = [];
    expect(distance(adc.position, tower.position)).toBeGreaterThan(
      tower.attackRange + 90,
    );
    expect(distance(oldGoal, tower.position)).toBeLessThan(tower.attackRange);
    const result = decide(state, observed);
    const intent = result.intents.find((value) => value.actorId === adc.id)!;
    expect(intent.kind).toBe('MOVE');
    if (intent.kind !== 'MOVE')
      throw new Error('Expected a safe staging movement');
    expect(intent.point).not.toEqual(oldGoal);
    expect(distance(intent.point, tower.position)).toBeGreaterThan(
      tower.attackRange + 90,
    );
    expect(result.plans[adc.id].siegeLane).toEqual(adc.plan.siegeLane);
  });
});
