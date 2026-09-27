import {
  emit,
  ENGINE_VERSION,
  type ActorInput,
  type EngineState,
  type UnitState,
} from './contracts';
import { createMap } from './map-paths';
import { createRuleset } from './ruleset';
import { createCombatProfile } from './input-adapter';
import { createWorldState } from './world-state';
import { awardDeath, grantReward, purchaseItem } from './economy-ledger';

function scenario(): EngineState {
  const actors: ActorInput[] = (['BLUE', 'RED', 'BLUE'] as const).map(
    (side, index) => ({
      actorId: `actor:${index}`,
      careerPlayerId: index + 1,
      teamId: side === 'BLUE' ? 1 : 2,
      side,
      position: index === 2 ? 'SUPPORT' : 'MID',
      championId: 'Ahri',
      profile: createCombatProfile('Ahri'),
      playerStats: {
        mechanics: 80,
        gameSense: 80,
        laning: 80,
        teamFight: 80,
        macro: 80,
        teamPlay: 80,
        mental: 80,
        championPool: 80,
      },
      form: 50,
      condition: 100,
      positionProficiency: 100,
      roleProficiency: null,
      feedback: null,
      execution: 0.8,
      aggression: 0.5,
      risk: 0.5,
      teamwork: 0.8,
    }),
  );
  return createWorldState({
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    catalogVersion: 'test',
    balanceVersion: 'test',
    seed: 1,
    map: createMap(),
    rules: createRuleset(),
    actors,
    teams: [
      {
        teamId: 1,
        side: 'BLUE',
        strategy: 'BALANCED',
        strategyProficiency: 50,
        chemistry: 50,
      },
      {
        teamId: 2,
        side: 'RED',
        strategy: 'BALANCED',
        strategyProficiency: 50,
        chemistry: 50,
      },
    ],
  });
}

function minion(state: EngineState): UnitState {
  return {
    ...state.actors[1],
    id: 'minion:1',
    kind: 'MINION',
    lane: 'MID',
    generation: 1,
    position: { ...state.actors[0].position },
    active: false,
    hp: 0,
    reward: { gold: 20, xp: 55, cs: 1 },
  };
}

describe('tactical economy ledger', () => {
  it('records starting assets once, separately from earned gold, even under a different retry key', () => {
    const state = scenario(),
      actor = state.actors[0];
    const reward = {
      key: 'initial',
      actorId: actor.id,
      sourceId: 'wallet',
      kind: 'STARTING' as const,
      gold: 500,
      xp: 0,
      cs: 0,
    };
    expect(grantReward(state, reward)).toBe(true);
    expect(grantReward(state, { ...reward, key: 'retry' })).toBe(false);
    expect(actor.gold).toBe(500);
    expect(actor.stats.goldEarned).toBe(0);
    expect(state.ledger).toHaveLength(1);
  });
  it('credits a finite resource once and shares XP without duplicating gold/CS', () => {
    const state = scenario(),
      victim = minion(state);
    state.simTimeMs = 90_000;
    emit(state, {
      kind: 'DEATH',
      actorId: state.actors[0].id,
      targetId: victim.id,
    });
    awardDeath(state, victim, state.actors[0].id, []);
    awardDeath(state, victim, state.actors[0].id, []);
    expect(state.actors[0].stats).toMatchObject({
      cs: 1,
      goldEarned: 20,
      xpEarned: 27.5,
    });
    expect(state.actors[2].stats).toMatchObject({
      cs: 0,
      goldEarned: 0,
      xpEarned: 27.5,
    });
    expect(state.actors[1].stats.xpEarned).toBe(0);
    expect(new Set(state.ledger.map((entry) => entry.key)).size).toBe(
      state.ledger.length,
    );
  });

  it('permits passive minion death XP nearby but no last-hit gold or off-map XP', () => {
    const state = scenario(),
      victim = minion(state);
    state.actors[2].position = { x: 9300, y: 700 };
    emit(state, { kind: 'DEATH', targetId: victim.id });
    awardDeath(state, victim, null, []);
    expect(state.actors[0].stats).toMatchObject({
      cs: 0,
      goldEarned: 0,
      xpEarned: 55,
    });
    expect(state.actors[2].stats.xpEarned).toBe(0);
  });

  it('rejects unspawned, alive and unrecorded deaths before any reward', () => {
    const state = scenario(),
      victim = minion(state);
    expect(() =>
      awardDeath(state, { ...victim, active: true }, state.actors[0].id, []),
    ).toThrow();
    expect(() =>
      awardDeath(state, { ...victim, spawnAtMs: 1 }, state.actors[0].id, []),
    ).toThrow();
    expect(() => awardDeath(state, victim, state.actors[0].id, [])).toThrow(
      'death event',
    );
    expect(state.ledger).toHaveLength(0);
  });

  it('processes champion kills and validated assists once without healing the killer', () => {
    const state = scenario(),
      [killer, victim, support] = state.actors;
    state.simTimeMs = 120_000;
    killer.hp = 10;
    victim.hp = 0;
    victim.active = false;
    state.damageContributors[victim.id] = { [support.id]: 115_000 };
    emit(state, { kind: 'DEATH', actorId: killer.id, targetId: victim.id });
    awardDeath(state, victim, killer.id, [support.id, support.id, 'missing']);
    awardDeath(state, victim, killer.id, [support.id]);
    expect(killer.stats.kills).toBe(1);
    expect(victim.stats.deaths).toBe(1);
    expect(support.stats.assists).toBe(1);
    expect(support.gold).toBe(state.input.rules.assistGold);
    expect(killer.hp).toBe(10);
    expect(killer.stats.cs).toBe(0);
  });

  it('requires actual spending in fountain before item stats apply and forbids duplicate purchases', () => {
    const state = scenario(),
      actor = state.actors[0];
    const attack = actor.attackDamage;
    grantReward(state, {
      key: 'test:gold',
      actorId: actor.id,
      sourceId: 'fixture',
      gold: 1000,
      xp: 0,
      cs: 0,
      kind: 'PASSIVE',
    });
    expect(actor.attackDamage).toBe(attack);
    actor.position = { x: 5000, y: 5000 };
    expect(purchaseItem(state, actor.id, 'MODEL_BLADE')).toBe(false);
    actor.position = { ...state.input.map.bases.BLUE };
    expect(purchaseItem(state, actor.id, 'MODEL_BLADE')).toBe(true);
    expect(actor.gold).toBe(650);
    expect(actor.attackDamage).toBe(attack + 12);
    expect(actor.stats.goldSpent).toBe(350);
    expect(purchaseItem(state, actor.id, 'MODEL_BLADE')).toBe(false);
    actor.action = { kind: 'RECALL', completesAtMs: 8000 };
    expect(purchaseItem(state, actor.id, 'MODEL_VEST')).toBe(false);
    actor.action = { kind: 'DEAD', respawnsAtMs: 8000 };
    actor.active = false;
    expect(purchaseItem(state, actor.id, 'MODEL_VEST')).toBe(false);
  });

  it('levels from cumulative XP, clamps to the model cap, and rejects invalid rewards', () => {
    const state = scenario(),
      actor = state.actors[0];
    const credit = {
      key: 'xp:one',
      actorId: actor.id,
      sourceId: 'fixture',
      gold: 0,
      xp: 660,
      cs: 0,
      kind: 'CAMP' as const,
    };
    expect(grantReward(state, credit)).toBe(true);
    expect(actor.level).toBe(3);
    expect(grantReward(state, credit)).toBe(false);
    grantReward(state, { ...credit, key: 'xp:cap', xp: 1_000_000 });
    expect(actor.level).toBe(state.input.rules.maxLevel);
    expect(() =>
      grantReward(state, { ...credit, key: 'bad', gold: NaN }),
    ).toThrow();
    expect(() =>
      grantReward(state, { ...credit, key: 'bad2', cs: 0.5 }),
    ).toThrow();
    expect(() =>
      grantReward(state, { ...credit, key: 'bad3', xp: -1 }),
    ).toThrow();
    const count = state.ledger.length;
    expect(() =>
      grantReward(state, { ...credit, key: 'overflow', xp: Number.MAX_VALUE }),
    ).toThrow();
    expect(state.ledger).toHaveLength(count);
  });
});
