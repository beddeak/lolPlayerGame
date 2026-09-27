import {
  ENGINE_VERSION,
  type ActorInput,
  type EngineInput,
  type Observation,
  type Point,
  type SimPosition,
  type UnitView,
} from './contracts';
import { planActors } from './actor-planner';
import { createMap, distance } from './map-paths';
import { createRandomStreams } from './seeded-rng';
import { createRuleset } from './ruleset';
import { createWorldState } from './world-state';
import { getCampDefinitions, initializeResources } from './resources';
import { observe } from './observation';

const roles: SimPosition[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function inputFixture(): EngineInput {
  const actors = (['BLUE', 'RED'] as const).flatMap((side, sideIndex) =>
    roles.map((position, index): ActorInput => ({
      actorId: `${side}-${position}`,
      careerPlayerId: sideIndex * 5 + index + 1,
      teamId: sideIndex + 1,
      side,
      position,
      championId: `any-champion-${index}`,
      profile: {
        maxHp: 1000,
        maxMana: 500,
        attackDamage: 70,
        armor: 30,
        attackRange: 550,
        attackIntervalMs: 1000,
        moveSpeed: 350,
        visionRange: 1500,
        hpPerLevel: 80,
        attackPerLevel: 3,
      },
      playerStats: {
        mechanics: 85,
        gameSense: 85,
        laning: 85,
        teamFight: 85,
        macro: 85,
        teamPlay: 85,
        mental: 85,
        championPool: 85,
      },
      form: 70,
      condition: 100,
      positionProficiency: 100,
      roleProficiency: null,
      feedback: null,
      execution: 0.85,
      aggression: 0.6,
      risk: 0.3,
      teamwork: 0.8,
    })),
  );
  return {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    catalogVersion: 'test',
    balanceVersion: 'test',
    seed: 17,
    rules: createRuleset(),
    map: createMap(),
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
  };
}

function fixture(configure?: (input: EngineInput) => void) {
  const input = inputFixture();
  configure?.(input);
  const state = createWorldState(input);
  const observation: Observation = {
    atMs: 60_000,
    side: 'BLUE',
    allies: state.actors.filter((actor) => actor.side === 'BLUE'),
    visible: [],
    remembered: [],
  };
  const actor = (position: SimPosition) =>
    observation.allies.find((a) => a.input.position === position)!;
  const run = () => planActors(observation, input, createRandomStreams(17));
  return { input, observation, actor, run };
}

function enemy(
  id: string,
  position: Point,
  hp = 1000,
  kind: UnitView['kind'] = 'CHAMPION',
): UnitView {
  return {
    id,
    kind,
    side: kind === 'CAMP' ? null : 'RED',
    position,
    hp,
    maxHp: 1000,
    active: hp > 0,
    attackRange: kind === 'MINION' ? 220 : 550,
  };
}

function freezeDeep(value: object) {
  for (const child of Object.values(value) as unknown[]) {
    if (child !== null && typeof child === 'object') freezeDeep(child);
  }
  Object.freeze(value);
}

describe('simulation-v2 observation-only actor planner', () => {
  it('enters assigned lanes along their corners; no champion identity position lock', () => {
    const { input, run } = fixture((draft) => {
      draft.actors.find(
        (a) => a.side === 'BLUE' && a.position === 'ADC',
      )!.championId = 'Lulu';
      draft.actors.find(
        (a) => a.side === 'BLUE' && a.position === 'SUPPORT',
      )!.championId = 'Jinx';
    });
    const result = run();
    expect(
      result.intents.find((intent) => intent.actorId === 'BLUE-TOP'),
    ).toMatchObject({ kind: 'MOVE', point: { x: 700, y: 1800 } });
    for (const role of ['ADC', 'SUPPORT']) {
      expect(
        result.intents.find((intent) => intent.actorId === `BLUE-${role}`),
      ).toMatchObject({ kind: 'MOVE', point: { x: 8200, y: 9300 } });
    }
    expect(result.plans['BLUE-MID'].kind).toBe('LANE');
    expect(result.plans['BLUE-JUNGLE'].kind).toBe('JUNGLE');
    expect(
      distance(result.plans['BLUE-MID'].point, input.map.bases.RED),
    ).toBeGreaterThan(5000);
  });

  it('does not mutate observation/configuration and consumes one decision draw per actor slot', () => {
    const { input, observation } = fixture();
    const initial = JSON.stringify({ input, observation });
    freezeDeep(input);
    freezeDeep(observation);
    const streams = createRandomStreams(17);
    const expected = createRandomStreams(17);
    const result = planActors(observation, input, streams);
    for (let i = 0; i < 5; i++)
      planActors(
        { ...observation, allies: [observation.allies[0]] },
        input,
        expected,
      );
    expect(streams).toEqual(expected);
    expect(JSON.stringify({ input, observation })).toBe(initial);
    result.plans['BLUE-TOP'].point.x = 999;
    expect(input.map.lanes.TOP[1].x).toBe(700);
  });

  it('emits no new commands for dead or channeling actors', () => {
    const { actor, run } = fixture();
    actor('TOP').active = false;
    actor('TOP').hp = 0;
    actor('TOP').action = { kind: 'DEAD', respawnsAtMs: 90_000 };
    actor('MID').action = { kind: 'RECALL', completesAtMs: 68_000 };
    const result = run();
    expect(result.intents).toHaveLength(3);
    expect(result.plans['BLUE-TOP']).toBeUndefined();
    expect(result.plans['BLUE-MID']).toBeUndefined();
  });

  it('keeps the opposite team RNG schedule unchanged by hidden deaths or recall channels', () => {
    const { input, observation } = fixture();
    const hiddenChanged = structuredClone(observation);
    hiddenChanged.allies[0].hp = 0;
    hiddenChanged.allies[0].active = false;
    hiddenChanged.allies[0].action = { kind: 'DEAD', respawnsAtMs: 80_000 };
    hiddenChanged.allies[2].action = { kind: 'RECALL', completesAtMs: 68_000 };
    const first = createRandomStreams(43);
    const second = createRandomStreams(43);
    planActors(observation, input, first);
    planActors(hiddenChanged, input, second);
    expect(first).toEqual(second);
    const redObservation: Observation = {
      atMs: observation.atMs,
      side: 'RED',
      allies: createWorldState(input).actors.filter(
        (actor) => actor.side === 'RED',
      ),
      visible: [],
      remembered: [],
    };
    expect(planActors(redObservation, input, first)).toEqual(
      planActors(redObservation, input, second),
    );
  });

  it('waits for fountain recovery, channels safely, or retreats under observed danger', () => {
    const { actor, observation, run } = fixture();
    const top = actor('TOP');
    top.hp = 400;
    expect(
      run().intents.find((intent) => intent.actorId === top.id)?.kind,
    ).toBe('HOLD');
    top.position = { x: 700, y: 2400 };
    top.hp = 200;
    expect(
      run().intents.find((intent) => intent.actorId === top.id)?.kind,
    ).toBe('RECALL');
    observation.visible = [enemy('red-top', { x: 700, y: 2100 })];
    top.lastDamagedAtMs = observation.atMs - 100;
    expect(
      run().intents.find((intent) => intent.actorId === top.id)?.kind,
    ).toBe('MOVE');
    expect(run().plans[top.id].kind).toBe('RETREAT');
  });

  it('targets a real visible minion and does not invent a farming target from elapsed time', () => {
    const { actor, observation, run } = fixture();
    const mid = actor('MID');
    mid.position = { x: 4900, y: 5100 };
    observation.visible = [
      enemy('wave:1:MID:RED:0', { x: 5100, y: 4900 }, 100, 'MINION'),
    ];
    expect(
      run().intents.find((intent) => intent.actorId === mid.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: 'wave:1:MID:RED:0' });
    observation.visible = [];
    expect(
      run().intents.find((intent) => intent.actorId === mid.id)?.kind,
    ).not.toBe('ATTACK');
  });

  it('walks to a shared-vision wave beyond the old fixed anchor before farming it', () => {
    const { actor, observation, run } = fixture();
    const top = actor('TOP');
    top.position = { x: 1015.8679656440355, y: 1484.1320343559646 };
    observation.friendlyMinions = [
      {
        ...enemy('own-wave', { x: 2800, y: 700 }, 280, 'MINION'),
        side: 'BLUE',
      },
    ];
    observation.visible = [
      enemy('forward-wave', { x: 3008, y: 700 }, 200, 'MINION'),
    ];
    expect(
      distance(top.position, observation.visible[0].position),
    ).toBeGreaterThan(1400);
    const approach = run();
    expect(
      approach.intents.find((intent) => intent.actorId === top.id)?.kind,
    ).toBe('MOVE');
    expect(approach.plans[top.id].reason).toMatch(/shared vision/);
    expect(approach.plans[top.id].point).not.toEqual(top.position);
    expect(top.stats.cs).toBe(0);
    top.position = { x: 2850, y: 700 };
    expect(
      run().intents.find((intent) => intent.actorId === top.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: 'forward-wave' });
  });

  it('escorts observed friendly waves without inventing a hidden enemy target or diving to base', () => {
    const { input, actor, observation, run } = fixture();
    const top = actor('TOP');
    top.position = { x: 1015.8679656440355, y: 1484.1320343559646 };
    observation.friendlyMinions = [
      {
        ...enemy('own-wave', { x: 2800, y: 700 }, 280, 'MINION'),
        side: 'BLUE',
      },
    ];
    expect(
      run().intents.find((intent) => intent.actorId === top.id)?.kind,
    ).toBe('MOVE');
    expect(run().plans[top.id].reason).toMatch(/Escort/);
    observation.friendlyMinions[0].position = { x: 8700, y: 700 };
    observation.visible = [
      enemy('unsafe-wave', { x: 8900, y: 700 }, 200, 'MINION'),
    ];
    const bounded = run();
    expect(
      bounded.intents.find((intent) => intent.actorId === top.id)?.kind,
    ).not.toBe('ATTACK');
    expect(
      distance(bounded.plans[top.id].point, input.map.bases.RED),
    ).toBeGreaterThanOrEqual(2200);
  });

  it('does not follow a distant wave into a visible numerical disadvantage', () => {
    const { actor, observation, run } = fixture();
    const top = actor('TOP');
    top.position = { x: 1015.8679656440355, y: 1484.1320343559646 };
    observation.friendlyMinions = [
      {
        ...enemy('own-wave', { x: 2800, y: 700 }, 280, 'MINION'),
        side: 'BLUE',
      },
    ];
    observation.visible = [
      enemy('forward-wave', { x: 3008, y: 700 }, 200, 'MINION'),
      enemy('red-top', { x: 3100, y: 700 }),
      enemy('red-jungle', { x: 3200, y: 700 }),
    ];
    const result = run();
    expect(
      result.intents.find((intent) => intent.actorId === top.id)?.kind,
    ).toBe('HOLD');
    expect(result.plans[top.id].point).toEqual(top.position);
  });

  it('recalls or disengages when too weak to approach the next wave instead of permanent idle', () => {
    const { actor, observation, run } = fixture();
    const top = actor('TOP');
    top.position = { x: 1015.8679656440355, y: 1484.1320343559646 };
    top.hp = 450;
    observation.friendlyMinions = [
      {
        ...enemy('own-wave', { x: 2800, y: 700 }, 280, 'MINION'),
        side: 'BLUE',
      },
    ];
    observation.visible = [
      enemy('forward-wave', { x: 3008, y: 700 }, 200, 'MINION'),
      enemy('red-top', { x: 3100, y: 700 }),
    ];
    expect(
      run().intents.find((intent) => intent.actorId === top.id)?.kind,
    ).toBe('RECALL');
    observation.visible.push(enemy('nearby-threat', { x: 1100, y: 1400 }));
    expect(run().plans[top.id].kind).toBe('RETREAT');
  });

  it('keeps support last hits for a nearby ADC but allows pressure on a healthy wave', () => {
    const { actor, observation, run } = fixture();
    actor('ADC').position = { x: 8500, y: 9000 };
    const support = actor('SUPPORT');
    support.position = { x: 8400, y: 9100 };
    observation.visible = [
      enemy('low-minion', { x: 8600, y: 8900 }, 100, 'MINION'),
    ];
    expect(
      run().intents.find((intent) => intent.actorId === support.id)?.kind,
    ).not.toBe('ATTACK');
    observation.visible[0].hp = 800;
    expect(
      run().intents.find((intent) => intent.actorId === support.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: 'low-minion' });
  });

  it('chooses only observed living camps for ATTACK and explores unknown locations with MOVE', () => {
    const { input, actor, observation, run } = fixture();
    const jungle = actor('JUNGLE');
    const camps = getCampDefinitions(input.map, input.rules).filter(
      (camp) => camp.side === 'BLUE',
    );
    jungle.position = { ...camps[0].position };
    observation.visible = camps.map((camp) =>
      enemy(camp.id, camp.position, camp.name === 'WOLVES' ? 700 : 0, 'CAMP'),
    );
    expect(
      run().intents.find((intent) => intent.actorId === jungle.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: 'camp:BLUE:WOLVES' });
    observation.visible = [];
    observation.remembered = [];
    const exploratory = run();
    expect(
      exploratory.intents.find((intent) => intent.actorId === jungle.id)?.kind,
    ).not.toBe('ATTACK');
    expect(exploratory.plans[jungle.id].reason).toMatch(/unknown/);
  });

  it('abandons a freshly depleted camp and uses remembered depletion without reading hidden respawn state', () => {
    const { input, actor, observation, run } = fixture();
    const jungle = actor('JUNGLE');
    const red = getCampDefinitions(input.map, input.rules).find(
      (camp) => camp.id === 'camp:BLUE:RED',
    )!;
    jungle.position = { ...red.position };
    jungle.plan = {
      kind: 'JUNGLE',
      targetId: red.id,
      point: red.position,
      reason: 'clear',
      createdAtMs: 59_000,
      expiresAtMs: 70_000,
    };
    observation.visible = [enemy(red.id, red.position, 0, 'CAMP')];
    expect(run().plans[jungle.id].targetId).not.toBe(red.id);
    observation.remembered = [
      { atMs: observation.atMs, unit: observation.visible[0] },
    ];
    observation.visible = [];
    expect(run().plans[jungle.id].targetId).not.toBe(red.id);
  });

  it('ganks a supported local opportunity and preserves its commitment until expiry', () => {
    const { actor, observation, run } = fixture();
    const jungle = actor('JUNGLE');
    jungle.position = { x: 4500, y: 5500 };
    actor('MID').position = { x: 4900, y: 5100 };
    observation.visible = [enemy('red-mid', { x: 5100, y: 4900 }, 400)];
    const first = run();
    expect(first.plans[jungle.id].kind).toBe('GANK');
    expect(
      first.intents.find((intent) => intent.actorId === jungle.id),
    ).toMatchObject({ kind: 'ATTACK', targetId: 'red-mid' });
    jungle.plan = first.plans[jungle.id];
    observation.atMs += 1000;
    observation.visible.push(enemy('red-other', { x: 5700, y: 4300 }, 300));
    const second = run();
    expect(second.plans[jungle.id].targetId).toBe('red-mid');
    expect(second.plans[jungle.id].expiresAtMs).toBe(
      first.plans[jungle.id].expiresAtMs,
    );
  });

  it('covers an observed pressured ally but does not send an isolated jungler into superior numbers', () => {
    const { actor, observation, run } = fixture();
    const jungle = actor('JUNGLE');
    jungle.position = { x: 4500, y: 5500 };
    actor('MID').position = { x: 4900, y: 5100 };
    actor('MID').lastDamagedAtMs = observation.atMs - 500;
    observation.visible = [enemy('red-mid', { x: 5100, y: 4900 }, 600)];
    expect(run().plans[jungle.id].kind).toBe('COVER');
    actor('MID').position = { x: 700, y: 9300 };
    observation.visible.push(enemy('red-jungle', { x: 5200, y: 4800 }, 600));
    expect(run().plans[jungle.id].kind).toBe('JUNGLE');
  });

  it('does not abandon a costly wave or an endangered ADC to force a roam', () => {
    const { actor, observation, run } = fixture();
    const mid = actor('MID');
    mid.position = { x: 4500, y: 5500 };
    actor('JUNGLE').position = { x: 4900, y: 5100 };
    observation.visible = [
      enemy('red-mid', { x: 5100, y: 4900 }, 300),
      ...Array.from({ length: 6 }, (_, index) =>
        enemy(`wave-${index}`, { x: 4800 + index, y: 5200 }, 500, 'MINION'),
      ),
    ];
    expect(run().plans[mid.id].kind).toBe('LANE');
    const support = actor('SUPPORT');
    support.position = { x: 4500, y: 5500 };
    actor('ADC').hp = 300;
    expect(run().plans[support.id].kind).not.toBe('GANK');
  });

  it('produces identical first decisions for equal observations with different hidden worlds', () => {
    const input = inputFixture();
    const a = createWorldState(input);
    const b = createWorldState(input);
    initializeResources(a);
    initializeResources(b);
    a.simTimeMs = b.simTimeMs = 60_000;
    for (const actor of b.actors.filter((actor) => actor.side === 'RED')) {
      actor.hp = 1;
      actor.gold = 10000;
      actor.action = { kind: 'MOVE', goal: { x: 8000, y: 2000 } };
    }
    for (const camp of b.units) {
      camp.hp = 1;
      camp.active = true;
    }
    const first = observe(a, 'BLUE');
    const second = observe(b, 'BLUE');
    expect(first).toEqual(second);
    expect(planActors(first, input, createRandomStreams(9))).toEqual(
      planActors(second, input, createRandomStreams(9)),
    );
  });

  it('does not attack remembered enemies as though their stale positions were live', () => {
    const { actor, observation, run } = fixture();
    const mid = actor('MID');
    mid.position = { x: 4900, y: 5100 };
    observation.remembered = [
      { atMs: 59_000, unit: enemy('missing-mid', { x: 5100, y: 4900 }, 1) },
    ];
    expect(
      run().intents.find((intent) => intent.actorId === mid.id)?.kind,
    ).not.toBe('ATTACK');
  });
});
