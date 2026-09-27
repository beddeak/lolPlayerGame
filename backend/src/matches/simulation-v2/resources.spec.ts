import { ENGINE_VERSION, emit, type ActorInput } from './contracts';
import { createMap, isWalkable } from './map-paths';
import { createRuleset } from './ruleset';
import { createCombatProfile } from './input-adapter';
import { createWorldState } from './world-state';
import { awardDeath } from './economy-ledger';
import {
  advanceResources,
  getCampDefinitions,
  initializeResources,
} from './resources';

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

describe('tactical resources', () => {
  it('pins mirrored walkable camp sites and starts no camp before its ruleset time', () => {
    const state = scenario();
    const definitions = getCampDefinitions(state.input.map, state.input.rules);
    expect(definitions).toHaveLength(12);
    expect(
      definitions.every((camp) => isWalkable(state.input.map, camp.position)),
    ).toBe(true);
    initializeResources(state);
    initializeResources(state);
    expect(state.units).toHaveLength(12);
    state.simTimeMs = 54_900;
    advanceResources(state);
    expect(
      state.units.filter((unit) => unit.kind === 'CAMP' && unit.active),
    ).toHaveLength(0);
    state.simTimeMs = 55_000;
    advanceResources(state);
    expect(
      state.units.filter((unit) => unit.kind === 'CAMP' && unit.active),
    ).toHaveLength(8);
    state.simTimeMs = 67_000;
    advanceResources(state);
    expect(
      state.units.filter((unit) => unit.kind === 'CAMP' && unit.active),
    ).toHaveLength(12);
  });

  it('spawns finite wave units only once and preserves reversed red routes', () => {
    const state = scenario();
    state.simTimeMs = 29_900;
    advanceResources(state);
    expect(state.units).toHaveLength(0);
    state.simTimeMs = 30_000;
    advanceResources(state);
    advanceResources(state);
    expect(state.units).toHaveLength(36);
    expect(new Set(state.units.map((unit) => unit.id)).size).toBe(36);
    expect(
      state.units
        .find((unit) => unit.lane === 'TOP' && unit.side === 'BLUE')!
        .path.at(-1),
    ).toEqual(state.input.map.bases.RED);
    expect(
      state.units
        .find((unit) => unit.lane === 'TOP' && unit.side === 'RED')!
        .path.at(-1),
    ).toEqual(state.input.map.bases.BLUE);
    const removed = state.units[0];
    removed.active = false;
    removed.hp = 0;
    advanceResources(state);
    expect(state.units.some((unit) => unit.id === removed.id)).toBe(false);
    expect(state.ledger).toHaveLength(0);
  });

  it('requires the next camp generation before allowing another reward', () => {
    const state = scenario();
    initializeResources(state);
    state.simTimeMs = 55_000;
    advanceResources(state);
    const camp = state.units.find(
      (unit) => unit.kind === 'CAMP' && unit.active,
    )!;
    const actor = state.actors[0];
    actor.position = { ...camp.position };
    const kill = () => {
      camp.active = false;
      camp.hp = 0;
      emit(state, { kind: 'DEATH', actorId: actor.id, targetId: camp.id });
      awardDeath(state, camp, actor.id, []);
    };
    kill();
    awardDeath(state, camp, actor.id, []);
    expect(actor.stats.cs).toBe(4);
    expect(camp.respawnAtMs).toBe(190_000);
    state.simTimeMs = 189_900;
    advanceResources(state);
    expect(camp.active).toBe(false);
    state.simTimeMs = 190_000;
    advanceResources(state);
    expect(camp.active).toBe(true);
    expect(camp.generation).toBe(2);
    kill();
    expect(actor.stats.cs).toBe(8);
  });

  it('announces 8-minute grubs without enabling capture, never early Herald/Baron', () => {
    const state = scenario();
    state.simTimeMs = 479_900;
    advanceResources(state);
    expect(
      state.events.filter((event) => event.kind === 'OBJECTIVE_AVAILABLE'),
    ).toHaveLength(0);
    state.simTimeMs = 480_000;
    advanceResources(state);
    advanceResources(state);
    const objectives = state.events.filter(
      (event) => event.kind === 'OBJECTIVE_AVAILABLE',
    );
    expect(objectives).toHaveLength(1);
    expect(objectives[0].targetId).toBe('VOID_GRUBS');
    expect(objectives[0].reason).toContain('UNSUPPORTED');
    state.simTimeMs = 600_000;
    advanceResources(state);
    expect(
      state.events.some(
        (event) =>
          event.targetId === 'RIFT_HERALD' || event.targetId === 'BARON',
      ),
    ).toBe(false);
    expect(state.units.some((unit) => unit.id === 'VOID_GRUBS')).toBe(false);
    expect(state.ledger).toHaveLength(0);
  });
});
