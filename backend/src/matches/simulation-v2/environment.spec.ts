import { emit, type EngineState, type UnitState } from './contracts';
import { createDuelInput } from './test-fixtures';
import { createWorldState } from './world-state';
import {
  createEnvironmentRules,
  validateEnvironmentRules,
} from './environment-rules';
import {
  advanceEnvironment,
  applySuperMinion,
  awardEnvironmentDeath,
  environmentTargetable,
  hasSiegeWave,
  initializeEnvironment,
  modifyEnvironmentDamage,
  nexusId,
  onEnvironmentDamage,
  structureId,
} from './environment';
import { isWalkable } from './map-paths';

function scenario() {
  const input = createDuelInput();
  input.rules.environment = createEnvironmentRules();
  input.rules.capabilities.nexusVictory = 'SUPPORTED';
  const state = createWorldState(input);
  initializeEnvironment(state);
  return state;
}
const unit = (state: EngineState, id: string) =>
  state.units.find((entry) => entry.id === id)!;
function die(state: EngineState, target: UnitState, killer = state.actors[0]) {
  target.active = false;
  target.hp = 0;
  emit(state, { kind: 'DEATH', targetId: target.id, actorId: killer.id });
  return awardEnvironmentDeath(state, target, killer);
}
function minion(state: EngineState, target: UnitState): UnitState {
  const result: UnitState = {
    ...structuredClone(target),
    id: `test-minion:${state.units.length}`,
    kind: 'MINION',
    side: 'BLUE',
    position: { ...target.position },
    origin: { ...target.position },
    active: true,
    hp: 280,
    maxHp: 280,
    attackDamage: 12,
    attackRange: 220,
    armor: 0,
    moveSpeed: 220,
    lane: target.lane ?? 'MID',
    reward: { gold: 20, xp: 55, cs: 1 },
  };
  delete result.structure;
  delete result.objective;
  state.units.push(result);
  return result;
}

describe('authoritative objective and structure model', () => {
  it('is opt-in and creates unique walkable mirrored structures without revealing monsters early', () => {
    const legacy = createWorldState(createDuelInput());
    initializeEnvironment(legacy);
    expect(legacy.environment).toBeUndefined();
    expect(legacy.units).toHaveLength(0);
    const state = scenario();
    initializeEnvironment(state);
    expect(state.units).toHaveLength(37);
    expect(new Set(state.units.map((entry) => entry.id)).size).toBe(37);
    expect(
      state.units.every((entry) => isWalkable(state.input.map, entry.position)),
    ).toBe(true);
    expect(
      state.units.filter((entry) => entry.objective && entry.active),
    ).toHaveLength(0);
    expect(
      state.units.filter((entry) => entry.structure && entry.active),
    ).toHaveLength(30);
  });

  it('spawns only due objectives and closes each void-pit generation without fabricated rewards', () => {
    const state = scenario();
    state.simTimeMs = 299_900;
    advanceEnvironment(state);
    expect(unit(state, 'objective:DRAGON').active).toBe(false);
    state.simTimeMs = 300_000;
    advanceEnvironment(state);
    expect(unit(state, 'objective:DRAGON').active).toBe(true);
    state.simTimeMs = 480_000;
    advanceEnvironment(state);
    expect(
      state.units.filter(
        (entry) => entry.objective?.type === 'GRUB' && entry.active,
      ),
    ).toHaveLength(3);
    state.simTimeMs = 885_000;
    advanceEnvironment(state);
    expect(
      state.units.filter(
        (entry) => entry.objective?.type === 'GRUB' && entry.active,
      ),
    ).toHaveLength(0);
    state.simTimeMs = 900_000;
    advanceEnvironment(state);
    expect(unit(state, 'objective:HERALD').active).toBe(true);
    state.simTimeMs = 1_200_000;
    advanceEnvironment(state);
    expect(unit(state, 'objective:HERALD').active).toBe(false);
    expect(unit(state, 'objective:BARON').active).toBe(true);
    expect(state.ledger).toHaveLength(0);
    expect(
      state.events.filter((event) => event.kind === 'OBJECTIVE_CAPTURED'),
    ).toHaveLength(0);
  });

  it('never rewards a living objective and records three independent grub kills exactly once without healing', () => {
    const state = scenario();
    state.simTimeMs = 480_000;
    advanceEnvironment(state);
    const killer = state.actors[0];
    killer.hp = 90;
    const grubs = state.units.filter(
      (entry) => entry.objective?.type === 'GRUB',
    );
    expect(() => awardEnvironmentDeath(state, grubs[0], killer)).toThrow(
      'real death',
    );
    for (const grub of grubs) {
      die(state, grub);
      awardEnvironmentDeath(state, grub, killer);
    }
    expect(state.environment!.teams.BLUE.grubs).toBe(3);
    expect(killer.gold).toBe(90);
    expect(killer.xp).toBe(195);
    expect(killer.stats.cs).toBe(0);
    expect(killer.hp).toBe(90);
    expect(
      state.events.filter((event) => event.kind === 'OBJECTIVE_CAPTURED'),
    ).toHaveLength(3);
    state.simTimeMs = 700_000;
    advanceEnvironment(state);
    expect(grubs.every((grub) => !grub.active && grub.generation === 1)).toBe(
      true,
    );
  });

  it('starts each dragon respawn from its actual death and spawns Elder only after earned soul', () => {
    const state = scenario();
    const dragon = unit(state, 'objective:DRAGON');
    const elder = unit(state, 'objective:ELDER');
    state.simTimeMs = 300_000;
    advanceEnvironment(state);
    for (let index = 0; index < 4; index++) {
      expect(dragon.active).toBe(true);
      state.simTimeMs += 12_300;
      die(state, dragon);
      if (index < 3) {
        const due = state.simTimeMs + 300_000;
        expect(dragon.respawnAtMs).toBe(due);
        state.simTimeMs = due - 100;
        advanceEnvironment(state);
        expect(dragon.active).toBe(false);
        state.simTimeMs = due;
        advanceEnvironment(state);
      }
    }
    expect(state.environment!.soulSide).toBe('BLUE');
    expect(dragon.respawnAtMs).toBeNull();
    const due = state.simTimeMs + 360_000;
    expect(state.environment!.elderAvailableAtMs).toBe(due);
    state.simTimeMs = due - 100;
    advanceEnvironment(state);
    expect(elder.active).toBe(false);
    state.simTimeMs = due;
    advanceEnvironment(state);
    expect(elder.active).toBe(true);
    expect(dragon.active).toBe(false);
    expect(dragon.generation).toBe(4);
  });

  it('gives Baron only to living recipients and empowers minions only with a living nearby recipient', () => {
    const state = scenario();
    state.simTimeMs = 1_200_000;
    advanceEnvironment(state);
    const baron = unit(state, 'objective:BARON');
    const own = state.actors[0];
    const enemy = state.actors[1];
    own.position = { x: 5000, y: 5000 };
    enemy.position = { x: 5001, y: 5000 };
    die(state, baron);
    const wave = minion(state, enemy);
    expect(modifyEnvironmentDamage(state, wave, enemy, 100)).toBe(180);
    own.position = { x: 900, y: 900 };
    expect(modifyEnvironmentDamage(state, wave, enemy, 100)).toBe(100);
    own.active = false;
    advanceEnvironment(state);
    own.active = true;
    own.position = { ...wave.position };
    expect(modifyEnvironmentDamage(state, wave, enemy, 100)).toBe(100);
    expect(state.environment!.teams.BLUE.baronRecipients).toHaveLength(0);
  });

  it('locks every deeper structure until the protecting structure actually dies', () => {
    const state = scenario();
    const ids = ['OUTER', 'INNER', 'BASE', 'INHIBITOR'] as const;
    ids.forEach((type, index) => {
      const target = unit(state, structureId('RED', 'TOP', type));
      expect(environmentTargetable(state, target)).toBe(index === 0);
    });
    ids.forEach((type) => {
      const target = unit(state, structureId('RED', 'TOP', type));
      expect(environmentTargetable(state, target)).toBe(true);
      die(state, target);
    });
    const nexus = unit(state, nexusId('RED'));
    expect(environmentTargetable(state, nexus)).toBe(false);
    for (let i = 0; i < 2; i++) {
      const tower = unit(state, `structure:RED:NEXUS_TURRET:${i}`);
      expect(environmentTargetable(state, tower)).toBe(true);
      die(state, tower);
    }
    expect(environmentTargetable(state, nexus)).toBe(true);
    die(state, nexus);
    awardEnvironmentDeath(state, nexus, state.actors[0]);
    expect(state.status).toBe('FINISHED');
    expect(state.winnerTeamId).toBe(1);
    expect(
      state.events.filter((event) => event.kind === 'NEXUS_DESTROYED'),
    ).toHaveLength(1);
  });

  it('rejects illegal nexus death without partially issuing a reward or winner', () => {
    const state = scenario();
    const nexus = unit(state, nexusId('RED'));
    const keys = Object.keys(state.rewardKeys);
    expect(() => die(state, nexus)).toThrow('Illegal nexus');
    expect(state.winnerTeamId).toBeNull();
    expect(state.status).toBe('RUNNING');
    expect(Object.keys(state.rewardKeys)).toEqual(keys);
    expect(state.ledger).toHaveLength(0);
  });

  it('preserves backdoor protection unless a real enemy minion is in range, and blocks a protected structure', () => {
    const state = scenario();
    const own = state.actors[0];
    const outer = unit(state, structureId('RED', 'TOP', 'OUTER'));
    const inner = unit(state, structureId('RED', 'TOP', 'INNER'));
    expect(modifyEnvironmentDamage(state, own, inner, 100)).toBe(0);
    expect(hasSiegeWave(state, outer)).toBe(false);
    expect(modifyEnvironmentDamage(state, own, outer, 100)).toBe(18);
    const wave = minion(state, outer);
    expect(modifyEnvironmentDamage(state, own, outer, 100)).toBe(120);
    expect(modifyEnvironmentDamage(state, wave, outer, 100)).toBe(60);
    wave.active = false;
    expect(modifyEnvironmentDamage(state, own, outer, 100)).toBe(18);
  });

  it('claims permanent threshold plates only once and reduces outer value without dropping them at 14 minutes', () => {
    const state = scenario();
    const own = state.actors[0];
    const outer = unit(state, structureId('RED', 'TOP', 'OUTER'));
    own.position = { ...outer.position };
    outer.hp = 8100;
    onEnvironmentDamage(state, outer, 9000);
    onEnvironmentDamage(state, outer, 9000);
    expect(own.gold).toBe(120);
    outer.hp = 9000;
    onEnvironmentDamage(state, outer, 8100);
    outer.hp = 8100;
    onEnvironmentDamage(state, outer, 9000);
    expect(own.gold).toBe(120);
    state.simTimeMs = 840_000;
    advanceEnvironment(state);
    outer.hp = 0;
    onEnvironmentDamage(state, outer, 8100);
    expect(own.gold).toBe(440); // one early 120 + four late 80
    expect(outer.structure!.platesClaimed).toBe(5);
    expect(outer.armor).toBe(0);
    expect(
      state.ledger.every((entry) => entry.kind === 'PLATE' && entry.cs === 0),
    ).toBe(true);
  });

  it('does not bank plate gold when nobody is near the actual damage event', () => {
    const state = scenario();
    const outer = unit(state, structureId('RED', 'TOP', 'OUTER'));
    outer.hp = 8000;
    onEnvironmentDamage(state, outer, 9000);
    state.actors[0].position = { ...outer.position };
    onEnvironmentDamage(state, outer, 9000);
    expect(state.actors[0].gold).toBe(0);
    expect(outer.structure!.platesClaimed).toBe(1);
  });

  it('suppresses mid-push overgrowth, fires only with a wave and real attack, then consumes it once', () => {
    const state = scenario();
    const own = state.actors[0];
    const outer = unit(state, structureId('RED', 'TOP', 'OUTER'));
    advanceEnvironment(state);
    state.simTimeMs = 90_000;
    own.position = { ...outer.position };
    advanceEnvironment(state);
    expect(outer.structure!.overgrowthActive).toBe(false);
    own.position = { ...state.input.map.bases.BLUE };
    advanceEnvironment(state);
    expect(outer.structure!.overgrowthActive).toBe(true);
    own.position = { ...outer.position };
    expect(modifyEnvironmentDamage(state, own, outer, 100)).toBe(18);
    minion(state, outer);
    expect(modifyEnvironmentDamage(state, own, outer, 100, false)).toBe(120);
    expect(modifyEnvironmentDamage(state, own, outer, 100)).toBe(300);
    expect(modifyEnvironmentDamage(state, own, outer, 100)).toBe(120);
    expect(
      state.events.filter((event) => event.kind === 'OVERGROWTH'),
    ).toHaveLength(1);
  });

  it('requires acquired Herald, close attack range and a siege wave before spending its charge', () => {
    const state = scenario();
    const own = state.actors[0];
    const outer = unit(state, structureId('RED', 'TOP', 'OUTER'));
    state.simTimeMs = 900_000;
    advanceEnvironment(state);
    die(state, unit(state, 'objective:HERALD'));
    expect(state.environment!.teams.BLUE.heraldCharges).toBe(1);
    minion(state, outer);
    modifyEnvironmentDamage(state, own, outer, 100);
    expect(state.environment!.teams.BLUE.heraldCharges).toBe(1);
    own.position = { ...outer.position };
    expect(
      modifyEnvironmentDamage(state, own, outer, 100),
    ).toBeGreaterThanOrEqual(1920);
    expect(state.environment!.teams.BLUE.heraldCharges).toBe(0);
    expect(
      state.events.filter((event) => event.kind === 'HERALD_CHARGE'),
    ).toHaveLength(1);
  });

  it('spawns real super-minion pressure only while that lane inhibitor is down and restores it on the timer', () => {
    const state = scenario();
    const inhibitor = unit(state, structureId('RED', 'TOP', 'INHIBITOR'));
    const regular = minion(state, inhibitor);
    applySuperMinion(state, regular, 0);
    expect(regular.maxHp).toBe(280);
    die(state, inhibitor);
    const superUnit = minion(state, inhibitor);
    applySuperMinion(state, superUnit, 0);
    expect(superUnit.hp).toBe(840);
    expect(superUnit.attackDamage).toBe(36);
    state.simTimeMs = 299_900;
    advanceEnvironment(state);
    expect(inhibitor.active).toBe(false);
    state.simTimeMs = 300_000;
    advanceEnvironment(state);
    expect(inhibitor.active).toBe(true);
    const after = minion(state, inhibitor);
    applySuperMinion(state, after, 0);
    expect(after.hp).toBe(280);
  });

  it('respawns nexus turrets at 40% HP without new plate or repeated structure rewards', () => {
    const state = scenario();
    const tower = unit(state, 'structure:RED:NEXUS_TURRET:0');
    const own = state.actors[0];
    own.position = { ...tower.position };
    tower.hp = 0;
    onEnvironmentDamage(state, tower, tower.maxHp);
    die(state, tower);
    const awarded = own.gold;
    state.simTimeMs = 180_000;
    advanceEnvironment(state);
    expect(tower.hp).toBe(1400);
    expect(tower.active).toBe(true);
    expect(tower.generation).toBe(2);
    die(state, tower);
    expect(own.gold).toBe(awarded);
    expect(state.ledger.some((entry) => entry.kind === 'PLATE')).toBe(false);
  });

  it('validates environment values and lifecycle constraints before accepting configuration', () => {
    const state = scenario();
    const rules = createEnvironmentRules();
    expect(() =>
      validateEnvironmentRules(rules, state.input.map, 100),
    ).not.toThrow();
    rules.outerDecayStepMs = 0;
    expect(() => validateEnvironmentRules(rules, state.input.map, 100)).toThrow(
      'bounds',
    );
    rules.outerDecayStepMs = 60_000;
    rules.objectives[0].respawnDelayMs = 25;
    expect(() => validateEnvironmentRules(rules, state.input.map, 100)).toThrow(
      'Unaligned',
    );
    rules.objectives[0].respawnDelayMs = 300_000;
    rules.structures.OUTER.hp = NaN;
    expect(() => validateEnvironmentRules(rules, state.input.map, 100)).toThrow(
      'number',
    );
  });

  it.each([
    'plateGold',
    'firstTurretGold',
    'outerGoldDecay',
    'outerMaxGoldDecay',
  ] as const)(
    'rejects fractional %s before integer local-gold distribution can mint extra gold',
    (key) => {
      const input = structuredClone(scenario().input);
      input.rules.environment![key] = 0.1;
      expect(() => createWorldState(input)).toThrow('integer environment gold');
      input.rules.environment![key] = 0;
      expect(() => createWorldState(input)).not.toThrow();
    },
  );

  it.each(['GRUB', 'HERALD'] as const)(
    'rejects a repeating %s lifecycle in the pinned non-respawning model',
    (type) => {
      const input = structuredClone(scenario().input);
      const definition = input.rules.environment!.objectives.find(
        (entry) => entry.type === type,
      )!;
      definition.respawnDelayMs = input.rules.stepMs;
      expect(() => createWorldState(input)).toThrow('cannot respawn');
      definition.respawnDelayMs = null;
      expect(() => createWorldState(input)).not.toThrow();
    },
  );
});
