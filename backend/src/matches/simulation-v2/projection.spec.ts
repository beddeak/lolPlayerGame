import { captureFrame, projectMatch, stableStateHash } from './projection';
import { canonicalHash } from './seeded-rng';
import { ENGINE_VERSION, emit, type ActorInput } from './contracts';
import { createMap } from './map-paths';
import { createRuleset } from './ruleset';
import { createCombatProfile } from './input-adapter';
import { createWorldState } from './world-state';
import { awardDeath, grantReward, purchaseItem } from './economy-ledger';

function scenario() {
  const actors: ActorInput[] = (['BLUE', 'RED'] as const).map(
    (side, index) => ({
      actorId: `actor:${index}`,
      careerPlayerId: index + 1,
      teamId: index + 1,
      side,
      position: 'MID',
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

describe('simulation-v2 checkpoint projection', () => {
  it('reuses the single engine hash and preserves event order', () => {
    const first = { time: 2000, rng: { state: 8 }, events: [1, 2] };
    const same = { events: [1, 2], rng: { state: 8 }, time: 2000 };
    expect(stableStateHash(first)).toBe(canonicalHash(first));
    expect(stableStateHash(first)).toBe(stableStateHash(same));
    expect(stableStateHash(first)).not.toBe(
      stableStateHash({ ...same, events: [2, 1] }),
    );
    expect(stableStateHash(first)).toBe(
      stableStateHash(JSON.parse(JSON.stringify(first))),
    );
  });

  it('derives KDA, champion-only damage and wallet from event/reward sources', () => {
    const state = scenario(),
      [killer, victim] = state.actors;
    state.simTimeMs = 60_000;
    grantReward(state, {
      key: 'initial',
      sourceId: 'wallet',
      actorId: killer.id,
      kind: 'STARTING',
      gold: 500,
      xp: 0,
      cs: 0,
    });
    emit(state, {
      kind: 'DAMAGE',
      actorId: killer.id,
      targetId: 'minion',
      amount: 400,
    });
    emit(state, {
      kind: 'DAMAGE',
      actorId: killer.id,
      targetId: victim.id,
      amount: 100,
    });
    victim.hp = 0;
    victim.active = false;
    emit(state, { kind: 'DEATH', actorId: killer.id, targetId: victim.id });
    awardDeath(state, victim, killer.id, []);
    purchaseItem(state, killer.id, 'MODEL_BLADE');
    const before = structuredClone(state);
    const result = projectMatch(state);
    expect(state).toEqual(before);
    expect(result.players[0]).toMatchObject({
      kills: 1,
      deaths: 0,
      assists: 0,
      kda: 1,
      kp: 100,
      dpm: 100,
      damageToChampions: 100,
      goldEarned: 300,
      startingGold: 500,
      goldSpent: 350,
      walletGold: 450,
      gdAt15: null,
      csdAt15: null,
    });
    expect(result.players[1]).toMatchObject({ deaths: 1, damageTaken: 100 });
    expect(killer.stats.goldEarned).toBe(300);
    expect(result.players[0].walletGold).toBe(killer.gold);
    expect(result.winnerTeamId).toBeNull();
    expect(result.ledgerHash).toBe(canonicalHash(state.ledger));
  });

  it('uses only a real 15-minute sample and has safe zero denominators', () => {
    const state = scenario();
    const empty = projectMatch(state);
    expect(
      empty.players.every((player) =>
        [
          player.dpm,
          player.kda,
          player.kp,
          player.damageShare,
          player.goldShare,
        ].every(Number.isFinite),
      ),
    ).toBe(true);
    state.at15 = {
      [state.actors[0].id]: { goldEarned: 1200, cs: 80 },
      [state.actors[1].id]: { goldEarned: 1000, cs: 70 },
    };
    state.simTimeMs = 899_900;
    expect(projectMatch(state).players[0].gdAt15).toBeNull();
    state.simTimeMs = 900_000;
    expect(projectMatch(state).players[0]).toMatchObject({
      gdAt15: 200,
      csdAt15: 10,
    });
    expect(projectMatch(state).players[1]).toMatchObject({
      gdAt15: -200,
      csdAt15: -10,
    });
    state.at15 = null;
    expect(projectMatch(state).players[0].gdAt15).toBeNull();
  });

  it('captures detached frames without moving time or double-appending a timestamp', () => {
    const state = scenario();
    const initialHash = projectMatch(state).stateHash;
    state.actors[0].path = [{ x: 710, y: 9300 }];
    const frame = captureFrame(state);
    state.actors[0].path[0].x = 750;
    expect(frame.actors[0].path[0].x).toBe(710);
    expect(frame.actors[0].moveSpeed).toBe(state.actors[0].moveSpeed);
    state.actors[0].position.x += 100;
    expect(frame.actors[0].position.x).not.toBe(state.actors[0].position.x);
    captureFrame(state);
    expect(state.frames).toHaveLength(1);
    expect(state.simTimeMs).toBe(0);
    state.actors[0].position.x -= 100;
    state.actors[0].path = [];
    expect(projectMatch(state).stateHash).toBe(initialHash);
    state.simTimeMs = 2000;
    captureFrame(state);
    state.simTimeMs = 0;
    expect(() => captureFrame(state)).toThrow();
  });

  it('diagnoses duplicate reward entries instead of fabricating a valid report', () => {
    const state = scenario();
    grantReward(state, {
      key: 'passive',
      sourceId: 'time',
      actorId: state.actors[0].id,
      kind: 'PASSIVE',
      gold: 2,
      xp: 0,
      cs: 0,
    });
    state.ledger.push({ ...state.ledger[0] });
    expect(() => projectMatch(state)).toThrow('Duplicate ledger');
  });
});
