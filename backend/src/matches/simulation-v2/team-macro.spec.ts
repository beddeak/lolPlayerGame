import { createLabInput } from './test-fixtures';
import { createBattleRuleset } from './battle-rules';
import { createCombatProfile } from './input-adapter';
import { startSimulation } from './engine';
import { battlePublicInformation, planBattleActors } from './battle-planner';
import { coordinateMacro } from './team-macro';
import type { Observation, UnitView } from './contracts';
import { canonicalHash } from './seeded-rng';
import { careerMacroAi } from './career-input';
import { validateEngineInput } from './world-state';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';

function fixture(top = 'Malphite', mid = 'Ahri') {
  const input = createLabInput(191);
  input.rules = createBattleRuleset();
  input.rules.macroAi = 'COORDINATED_V2';
  for (const actor of input.actors.filter((entry) => entry.side === 'BLUE')) {
    if (actor.position === 'TOP') actor.championId = top;
    if (actor.position === 'MID') actor.championId = mid;
    actor.profile = createCombatProfile(actor.championId);
  }
  const state = startSimulation(input);
  state.simTimeMs = 1_500_000;
  state.actors.forEach((actor) => {
    actor.level = 14;
    actor.hp = actor.maxHp = 4000;
    actor.attackDamage = 350;
    actor.position = { x: 5000, y: 5000 };
  });
  const observed: Observation = {
    atMs: state.simTimeMs,
    side: 'BLUE',
    allies: structuredClone(
      state.actors.filter((actor) => actor.side === 'BLUE'),
    ),
    visible: [],
    remembered: [],
    friendlyMinions: [],
  };
  const info = battlePublicInformation(state, 'BLUE');
  info.objectives = [];
  Object.values(info.own).forEach((own) => {
    own.wardCharges = 0;
  });
  return { state, observed, info };
}
const view = (id: string, point = { x: 5200, y: 5000 }): UnitView => ({
  id,
  kind: 'CHAMPION',
  side: 'RED',
  position: point,
  hp: 2000,
  maxHp: 2000,
  active: true,
  attackRange: 125,
});

describe('coordinated observation-only macro AI', () => {
  it('groups engage TOP with the carries instead of always sending TOP to the second lane', () => {
    const { state, observed, info } = fixture();
    const result = planBattleActors(
      observed,
      state.input,
      structuredClone(state.rng),
      info,
    );
    const top = observed.allies.find(
      (actor) => actor.input.position === 'TOP',
    )!;
    const adc = observed.allies.find(
      (actor) => actor.input.position === 'ADC',
    )!;
    expect(result.plans[top.id].siegeLane?.lane).toBe(
      result.plans[adc.id].siegeLane?.lane,
    );
    expect(result.plans[top.id].reason).toContain('Rotate with team');
  });

  it('assigns a suitable MID split champion, not the engage TOP; groups when a siege buff is active', () => {
    const { state, observed, info } = fixture('Malphite', 'Fiora');
    const mid = observed.allies.find(
      (actor) => actor.input.position === 'MID',
    )!;
    expect(
      coordinateMacro(observed, state.input, info, true).splitActorId,
    ).toBe(mid.id);
    const result = planBattleActors(
      observed,
      state.input,
      structuredClone(state.rng),
      info,
    );
    expect(result.plans[mid.id].reason).toContain('Side pressure');
    info.siegeBuffUntilMs = observed.atMs + 60_000;
    expect(
      coordinateMacro(observed, state.input, info, true).splitActorId,
    ).toBeNull();
  });

  it('selects one viable team objective rather than separate nearest targets and physically gathers its members', () => {
    const { state, observed, info } = fixture();
    info.objectives = [
      {
        id: 'objective:DRAGON',
        type: 'DRAGON',
        position: { x: 5500, y: 5500 },
        available: true,
        nextAtMs: observed.atMs,
      },
      {
        id: 'objective:BARON',
        type: 'BARON',
        position: { x: 4500, y: 4500 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    const before = canonicalHash({ observed, info, input: state.input });
    const order = coordinateMacro(observed, state.input, info, true);
    expect(order.objectiveId).not.toBeNull();
    expect(order.objectiveMembers.size).toBeGreaterThanOrEqual(2);
    const result = planBattleActors(
      observed,
      state.input,
      structuredClone(state.rng),
      info,
    );
    const setups = Object.values(result.plans).filter(
      (plan) => plan.kind === 'SETUP',
    );
    expect(setups.length).toBeGreaterThanOrEqual(2);
    expect(new Set(setups.map((plan) => plan.targetId))).toEqual(
      new Set([order.objectiveId]),
    );
    expect(canonicalHash({ observed, info, input: state.input })).toBe(before);
    expect(state.winnerTeamId).toBeNull();
  });

  it('does not count recalling, dead, low-health or unreachable teammates as a Baron group', () => {
    const { state, observed, info } = fixture();
    info.objectives = [
      {
        id: 'objective:BARON',
        type: 'BARON',
        position: { x: 4500, y: 4500 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    observed.allies[0].action = {
      kind: 'RECALL',
      completesAtMs: observed.atMs + 8000,
    };
    observed.allies[1].active = false;
    observed.allies[2].hp = 200;
    observed.allies[3].position = { x: 700, y: 9300 };
    observed.allies[3].moveSpeed = 1;
    expect(
      coordinateMacro(observed, state.input, info, true).objectiveId,
    ).toBeNull();
  });

  it('makes every designated long-distance Baron member follow the team arrival order', () => {
    const { state, observed, info } = fixture();
    observed.allies.forEach((actor, index) => {
      actor.position = index < 2 ? { x: 3700, y: 3700 } : { x: 7700, y: 7300 };
    });
    info.objectives = [
      {
        id: 'objective:BARON',
        type: 'BARON',
        position: { x: 3700, y: 3700 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    const order = coordinateMacro(observed, state.input, info, true);
    expect(order.objectiveMembers.size).toBeGreaterThanOrEqual(4);
    const result = planBattleActors(
      observed,
      state.input,
      structuredClone(state.rng),
      info,
    );
    for (const id of order.objectiveMembers) {
      expect(result.plans[id]).toMatchObject({
        kind: 'SETUP',
        targetId: 'objective:BARON',
      });
    }
    const savedV1 = structuredClone(state.input);
    savedV1.rules.macroAi = 'COORDINATED_V1';
    const prior = planBattleActors(
      observed,
      savedV1,
      structuredClone(state.rng),
      info,
    );
    expect(
      Object.values(prior.plans).filter((plan) => plan.kind === 'SETUP'),
    ).toHaveLength(2);
  });

  it('does not promise arrivals outside the actual teammates coordination tolerance', () => {
    const { state, observed, info } = fixture();
    const input = structuredClone(state.input);
    input.teams[0].strategyProficiency = 0;
    observed.allies.forEach((actor, index) => {
      actor.input.teamwork = 0;
      actor.moveSpeed = 280;
      actor.position = index < 2 ? { x: 3700, y: 3700 } : { x: 7700, y: 7300 };
    });
    info.objectives = [
      {
        id: 'objective:BARON',
        type: 'BARON',
        position: { x: 3700, y: 3700 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    expect(coordinateMacro(observed, input, info, true).objectiveId).toBeNull();
  });

  it('trades an uncontestable visible dragon for a real opposite-side structure instead of the preferred nearby lane', () => {
    const { state, observed, info } = fixture();
    const input = structuredClone(state.input);
    input.teams[0].strategy = TeamStrategy.MID_CARRY;
    observed.allies.forEach((actor) => {
      actor.position = { x: 700, y: 1000 };
    });
    const adc = observed.allies.find(
      (actor) => actor.input.position === 'ADC',
    )!;
    adc.position = { x: 5500, y: 6300 };
    info.objectives = [
      {
        id: 'objective:DRAGON',
        type: 'DRAGON',
        position: { x: 6300, y: 6300 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    observed.visible = Array.from({ length: 3 }, (_, index) =>
      view(`dragon-foe:${index}`, { x: 7700, y: 6000 + index * 20 }),
    );
    const initialLedger = structuredClone(state.ledger);
    const result = planBattleActors(
      observed,
      input,
      structuredClone(state.rng),
      info,
    );
    expect(result.plans[adc.id]).toMatchObject({
      kind: 'TRADE',
      siegeLane: { lane: 'TOP' },
    });
    expect(state.ledger).toEqual(initialLedger);
    expect(state.winnerTeamId).toBeNull();
    const savedV1 = structuredClone(input);
    savedV1.rules.macroAi = 'COORDINATED_V1';
    const prior = planBattleActors(
      observed,
      savedV1,
      structuredClone(state.rng),
      info,
    );
    expect(prior.plans[adc.id]).toMatchObject({
      kind: 'SIEGE',
      siegeLane: { lane: 'MID' },
    });
    info.structures = [];
    const noTrade = planBattleActors(
      observed,
      input,
      structuredClone(state.rng),
      info,
    );
    expect(
      Object.values(noTrade.plans).some((plan) => plan.kind === 'TRADE'),
    ).toBe(false);
  });

  it('abandons new objectives and splitting to preserve a visibly threatened base', () => {
    const { state, observed, info } = fixture('Fiora');
    info.objectives = [
      {
        id: 'objective:DRAGON',
        type: 'DRAGON',
        position: { x: 5000, y: 5000 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    const nexus = info.structures.find(
      (structure) => structure.side === 'BLUE' && structure.type === 'NEXUS',
    )!;
    observed.visible.push(view('base-attacker', nexus.position));
    const order = coordinateMacro(observed, state.input, info, true);
    expect(order.objectiveId).toBeNull();
    expect(order.splitActorId).toBeNull();
  });

  it('critical base defenders return to the actual nexus threat instead of clearing a closer outer-lane wave', () => {
    const { state, observed, info } = fixture();
    const outer = info.structures.find(
      (structure) =>
        structure.side === 'BLUE' &&
        structure.lane === 'MID' &&
        structure.type === 'OUTER',
    )!;
    const nexus = info.structures.find(
      (structure) => structure.side === 'BLUE' && structure.type === 'NEXUS',
    )!;
    observed.allies.forEach((actor) => {
      actor.position = { ...outer.position };
    });
    observed.visible = [
      view('nexus-attacker', nexus.position),
      ...Array.from({ length: 3 }, (_, index) => ({
        ...view(`outer-wave:${index}`, outer.position),
        kind: 'MINION' as const,
      })),
    ];
    const result = planBattleActors(
      observed,
      state.input,
      structuredClone(state.rng),
      info,
    );
    expect(result.intents).toHaveLength(5);
    for (const intent of result.intents) {
      expect(intent).toMatchObject({
        kind: 'ATTACK',
        targetId: 'nexus-attacker',
      });
      expect(result.plans[intent.actorId].kind).toBe('DEFEND');
    }
  });

  it('focuses the carry diver instead of chasing a distant low-HP enemy and ignores hidden world changes', () => {
    const { state, observed, info } = fixture();
    observed.visible = [
      view('diver'),
      { ...view('bait', { x: 8000, y: 8000 }), hp: 1 },
    ];
    const order = coordinateMacro(observed, state.input, info, true);
    expect(order.focusTargetId).toBe('diver');
    state.actors
      .filter((actor) => actor.side === 'RED')
      .forEach((actor) => {
        actor.position = { x: 700, y: 9300 };
        actor.hp = 1;
      });
    expect(coordinateMacro(observed, state.input, info, true)).toEqual(order);
  });

  it('never starts another endless setup while all eligible members are on backoff', () => {
    const { state, observed, info } = fixture();
    info.objectives = [
      {
        id: 'objective:DRAGON',
        type: 'DRAGON',
        position: { x: 5000, y: 5000 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    observed.allies.forEach((actor) => {
      actor.plan = {
        kind: 'LANE',
        targetId: null,
        point: actor.position,
        createdAtMs: observed.atMs,
        expiresAtMs: observed.atMs + 8000,
        reason: 'After abandoned setup',
        objectiveBackoff: {
          id: 'objective:DRAGON',
          untilMs: observed.atMs + 20_000,
        },
      };
    });
    expect(
      coordinateMacro(observed, state.input, info, true).objectiveId,
    ).toBeNull();
  });

  it('does not recruit members who the local planner must hold for fountain recovery', () => {
    const { state, observed, info } = fixture();
    observed.allies.forEach((actor, index) => {
      actor.position =
        index < 2 ? { x: 3700, y: 3700 } : { ...state.input.map.bases.BLUE };
      if (index >= 2) {
        actor.hp = actor.maxHp * 0.8;
        actor.mana = 0;
        actor.maxMana = 1000;
      }
    });
    info.objectives = [
      {
        id: 'objective:BARON',
        type: 'BARON',
        position: { x: 3700, y: 3700 },
        available: true,
        nextAtMs: observed.atMs,
      },
    ];
    const savedV1 = structuredClone(state.input);
    savedV1.rules.macroAi = 'COORDINATED_V1';
    expect(coordinateMacro(observed, savedV1, info, true).objectiveId).toBe(
      'objective:BARON',
    );
    expect(
      coordinateMacro(observed, state.input, info, true).objectiveId,
    ).toBeNull();
    const result = planBattleActors(
      observed,
      state.input,
      structuredClone(state.rng),
      info,
    );
    expect(
      Object.values(result.plans).some((plan) => plan.kind === 'SETUP'),
    ).toBe(false);
    for (const actor of observed.allies.slice(2)) {
      expect(result.plans[actor.id].kind).toBe('RECOVER');
    }
  });

  it('pins new versus ongoing series policies and rejects mixed or unsupported policies', () => {
    const legacy = createLabInput();
    legacy.rules = createBattleRuleset();
    const newer = structuredClone(legacy);
    newer.rules.macroAi = 'COORDINATED_V1';
    expect(careerMacroAi([])).toBe('COORDINATED_V2');
    expect(careerMacroAi([legacy, legacy])).toBe('LEGACY');
    expect(careerMacroAi([newer, newer])).toBe('COORDINATED_V1');
    expect(() => careerMacroAi([legacy, newer])).toThrow(/incompatible/);
    Object.assign(newer.rules, { macroAi: 'UNKNOWN' });
    expect(() => validateEngineInput(newer)).toThrow(/macro AI/);
    expect(() => careerMacroAi([newer])).toThrow(/incompatible/);
  });
});
