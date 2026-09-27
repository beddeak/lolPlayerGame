import { createDuelInput } from './test-fixtures';
import { createWorldState } from './world-state';
import { canonicalHash } from './seeded-rng';
import { observe } from './observation';
import { createBattleRuleset } from './battle-rules';
import { startSimulation, runUntil } from './engine';
import {
  advanceVision,
  createVisionState,
  isVisibleToTeam,
  memoryEstimate,
  MODEL_VISION_RULES,
  requestSweep,
  requestWard,
  wardDetected,
} from './vision';

function world() {
  const input = createDuelInput();
  input.rules.vision = { ...MODEL_VISION_RULES };
  const state = createWorldState(input);
  state.vision = createVisionState(
    state.actors.map((actor) => actor.id),
    input.rules.vision,
  );
  state.actors[0].position = { x: 4900, y: 5100 };
  state.actors[1].position = { x: 8000, y: 2000 };
  return state;
}

describe('physical ward resources and bounded knowledge', () => {
  it('shows an enemy within turret attack range to its team before the turret can attack', () => {
    const input = createDuelInput();
    input.rules = createBattleRuleset();
    const state = startSimulation(input);
    const tower = state.units.find(
      (unit) => unit.side === 'BLUE' && unit.structure?.type === 'OUTER',
    )!;
    tower.position = { x: 5000, y: 5000 };
    tower.origin = { ...tower.position };
    state.units = [tower];
    const enemy = state.actors[1];
    enemy.position = { x: 5800, y: 5000 };
    expect(tower.attackRange).toBe(900);
    expect(state.input.rules.environment!.towerVision).toBe(1100);
    expect(
      observe(state, 'BLUE').visible.some((unit) => unit.id === enemy.id),
    ).toBe(true);
    runUntil(state, 0);
    expect(
      state.events.some(
        (event) =>
          event.kind === 'ATTACK' &&
          event.actorId === tower.id &&
          event.targetId === enemy.id,
      ),
    ).toBe(true);
    enemy.position = { x: 5900, y: 5000 };
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(true);
    enemy.position = { x: 5901, y: 5000 };
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(true);
    enemy.position = { x: 6100, y: 5000 };
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(true);
    enemy.position = { x: 6101, y: 5000 };
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(false);
    enemy.position = { x: 5800, y: 5000 };
    tower.active = false;
    tower.hp = 0;
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(false);
  });

  it('keeps minimum attack-range vision if the configured tower sight is shorter', () => {
    const input = createDuelInput();
    input.rules = createBattleRuleset();
    input.rules.environment!.towerVision = 400;
    const state = startSimulation(input);
    const tower = state.units.find(
      (unit) => unit.side === 'BLUE' && unit.structure?.type === 'OUTER',
    )!;
    tower.position = { x: 5000, y: 5000 };
    tower.origin = { ...tower.position };
    state.units = [tower];
    const enemy = state.actors[1];
    enemy.position = { x: 5900, y: 5000 };
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(true);
    enemy.position = { x: 5901, y: 5000 };
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(false);
  });

  it('still requires line of sight for the turret attack-range vision minimum', () => {
    const input = createDuelInput();
    input.rules = createBattleRuleset();
    input.map.walls.push({ x1: 5350, x2: 5450, y1: 4980, y2: 5020 });
    const state = startSimulation(input);
    const tower = state.units.find(
      (unit) => unit.side === 'BLUE' && unit.structure?.type === 'OUTER',
    )!;
    tower.position = { x: 5000, y: 5000 };
    tower.origin = { ...tower.position };
    state.units = [tower];
    state.actors[1].position = { x: 5800, y: 5000 };
    expect(isVisibleToTeam(state, 'BLUE', state.actors[1])).toBe(false);
    runUntil(state, 0);
    expect(
      state.events.some(
        (event) => event.kind === 'ATTACK' && event.actorId === tower.id,
      ),
    ).toBe(false);
  });

  it('does not spawn instant or distant vision and consumes a real charge', () => {
    const state = world(),
      [actor] = state.actors;
    expect(requestWard(state, actor.id, { x: 8000, y: 2000 })).toBe(false);
    expect(requestWard(state, actor.id, { x: NaN, y: 0 })).toBe(false);
    expect(requestWard(state, actor.id, { x: 5100, y: 4900 })).toBe(true);
    expect(state.vision!.inventory[actor.id].charges).toBe(1);
    expect(requestWard(state, actor.id, actor.position)).toBe(false);
    expect(state.units).toHaveLength(0);
    state.simTimeMs = 200;
    advanceVision(state);
    expect(state.units).toHaveLength(0);
    state.simTimeMs = 300;
    advanceVision(state);
    expect(state.units).toHaveLength(1);
    expect(state.units[0].kind).toBe('WARD');
    expect(state.units[0].hp).toBe(3);
  });

  it('loses a placement on death and never refunds/copies the consumed charge', () => {
    const state = world(),
      [actor] = state.actors;
    requestWard(state, actor.id, actor.position);
    actor.active = false;
    state.simTimeMs = 300;
    advanceVision(state);
    expect(state.units).toHaveLength(0);
    expect(state.vision!.inventory[actor.id].charges).toBe(1);
    expect(state.events.at(-1)?.kind).toBe('WARD_CANCEL');
  });

  it('waits one full recharge from spending at the cap, even late in the clock', () => {
    const state = world(),
      [actor] = state.actors;
    state.simTimeMs = 119_000;
    advanceVision(state);
    requestWard(state, actor.id, actor.position);
    state.simTimeMs = 120_000;
    advanceVision(state);
    expect(state.vision!.inventory[actor.id].charges).toBe(1);
    state.simTimeMs = 239_000;
    advanceVision(state);
    expect(state.vision!.inventory[actor.id].charges).toBe(2);
  });

  it('reveals only from a live ward and removes its sight on expiry', () => {
    const state = world(),
      [actor, enemy] = state.actors;
    requestWard(state, actor.id, { x: 5100, y: 4900 });
    state.simTimeMs = 300;
    advanceVision(state);
    actor.position = { x: 700, y: 9300 };
    enemy.position = { x: 5500, y: 4500 };
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(true);
    state.simTimeMs = 90_300;
    advanceVision(state);
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(false);
    expect(state.units).toHaveLength(0);
  });

  it('requires local scanning to see an enemy ward and disables its vision while detected', () => {
    const state = world(),
      [actor, enemy] = state.actors;
    requestWard(state, actor.id, { x: 5100, y: 4900 });
    state.simTimeMs = 300;
    advanceVision(state);
    const ward = state.units[0];
    actor.position = { x: 700, y: 9300 };
    enemy.position = { x: 5500, y: 4500 };
    expect(isVisibleToTeam(state, 'RED', ward)).toBe(false);
    expect(requestSweep(state, enemy.id)).toBe(true);
    expect(requestSweep(state, enemy.id)).toBe(false);
    expect(wardDetected(state, 'RED', ward)).toBe(true);
    expect(isVisibleToTeam(state, 'RED', ward)).toBe(true);
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(false);
    state.simTimeMs += MODEL_VISION_RULES.scanDurationMs;
    expect(isVisibleToTeam(state, 'RED', ward)).toBe(false);
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(true);
  });

  it('read-only observation cannot refresh memories or leak enemy gold/resources/plans', () => {
    const state = world(),
      [, enemy] = state.actors;
    enemy.position = { x: 5100, y: 4900 };
    enemy.gold = 12345;
    const before = canonicalHash(state);
    const view = observe(state, 'BLUE');
    expect(canonicalHash(state)).toBe(before);
    const seen = view.visible.find((unit) => unit.id === enemy.id)!;
    expect(seen).not.toHaveProperty('gold');
    expect(seen).not.toHaveProperty('input');
    expect(seen).not.toHaveProperty('mana');
    expect(seen).not.toHaveProperty('plan');
    view.visible[0].hp = -100;
    expect(enemy.hp).toBeGreaterThan(0);
    const knowledge = memoryEstimate(10_000, 0, seen, 30_000);
    expect(knowledge.source).toBe('LAST_SEEN');
    expect(knowledge.confidence).toBeCloseTo(2 / 3);
    expect(knowledge.uncertaintyRadius).toBe(5000);
  });

  it('removes destroyed wards rather than letting zero-HP wards grant ghost vision', () => {
    const state = world(),
      [actor, enemy] = state.actors;
    requestWard(state, actor.id, actor.position);
    state.simTimeMs = 300;
    advanceVision(state);
    const ward = state.units[0];
    ward.hp = 0;
    ward.active = false;
    actor.position = { x: 700, y: 9300 };
    enemy.position = { x: 5100, y: 4900 };
    advanceVision(state);
    expect(state.vision!.wards).toHaveLength(0);
    expect(isVisibleToTeam(state, 'BLUE', enemy)).toBe(false);
  });
});
