import { createBattleRuleset } from './battle-rules';
import { emit, type EngineState, type SimPosition } from './contracts';
import { grantReward } from './economy-ledger';
import { queueCommand, runUntil, startSimulation } from './engine';
import { projectMatch } from './projection';
import { advanceRoleQuests, recallDuration } from './role-quests';
import { createDuelInput } from './test-fixtures';

function scenario(role: SimPosition = 'MID', target = 20) {
  const input = createDuelInput();
  input.rules = createBattleRuleset();
  input.actors[0].position = role;
  input.rules.roleQuests!.targets[role] = target;
  const state = startSimulation(input);
  state.actors[0].position = { x: 4900, y: 5100 };
  state.actors[1].position = { x: 8000, y: 2000 };
  return state;
}

function rewardCs(
  state: EngineState,
  lane: 'TOP' | 'MID' | 'BOT',
  cs: number,
  suffix = '1',
) {
  grantReward(state, {
    key: `minion-reward:${suffix}`,
    actorId: state.actors[0].id,
    sourceId: `minion:wave:${lane}:RED:${suffix}`,
    kind: 'MINION',
    gold: cs * 20,
    xp: cs * 55,
    cs,
  });
}

describe('role quests consume actual authoritative evidence', () => {
  it('does not progress from time, movement, passive income or startup wallet', () => {
    const state = scenario(),
      actor = state.actors[0];
    emit(state, { kind: 'MOVE', actorId: actor.id, position: actor.position });
    grantReward(state, {
      key: 'passive:test',
      actorId: actor.id,
      sourceId: 'PASSIVE_GOLD',
      kind: 'PASSIVE',
      gold: 10,
      xp: 0,
      cs: 0,
    });
    state.simTimeMs = 10_000;
    advanceRoleQuests(state);
    expect(state.roleQuests!.actors[actor.id].points).toBe(0);
    expect(state.roleQuests!.actors[actor.id].completedAtMs).toBeNull();
    expect(state.events.some((event) => event.kind === 'QUEST_COMPLETE')).toBe(
      false,
    );
  });

  it('counts CS evidence once and distinguishes home-lane from off-lane farming', () => {
    const state = scenario('MID', 100),
      actor = state.actors[0];
    rewardCs(state, 'MID', 1);
    advanceRoleQuests(state);
    expect(state.roleQuests!.actors[actor.id].points).toBe(10);
    advanceRoleQuests(state);
    advanceRoleQuests(state);
    expect(state.roleQuests!.actors[actor.id].points).toBe(10);
    rewardCs(state, 'BOT', 1, 'offlane');
    advanceRoleQuests(state);
    expect(state.roleQuests!.actors[actor.id].points).toBe(13);
    expect(actor.stats.cs).toBe(2);
  });

  it('grants completion rewards once and projects the same CS, wallet, gold and XP', () => {
    const state = scenario('ADC'),
      actor = state.actors[0];
    rewardCs(state, 'BOT', 2);
    advanceRoleQuests(state);
    const first = projectMatch(state).players.find(
      (player) => player.actorId === actor.id,
    )!;
    expect(state.roleQuests!.actors[actor.id].completedAtMs).toBe(0);
    expect(state.ledger.filter((entry) => entry.kind === 'QUEST')).toHaveLength(
      1,
    );
    expect(first.cs).toBe(actor.stats.cs);
    expect(first.cs).toBe(2);
    expect(first.goldEarned).toBe(340);
    expect(first.walletGold).toBe(actor.gold);
    expect(first.xpEarned).toBe(actor.stats.xpEarned);
    advanceRoleQuests(state);
    advanceRoleQuests(state);
    expect(state.ledger.filter((entry) => entry.kind === 'QUEST')).toHaveLength(
      1,
    );
    expect(actor.gold).toBe(first.walletGold);
    expect(
      state.events.filter((event) => event.kind === 'QUEST_COMPLETE'),
    ).toHaveLength(1);
  });

  it('uses a completed MID quest for actual shortened recall, never immediate healing', () => {
    const state = scenario(),
      actor = state.actors[0];
    expect(recallDuration(state, actor.id)).toBe(8000);
    rewardCs(state, 'MID', 2);
    advanceRoleQuests(state);
    expect(recallDuration(state, actor.id)).toBe(5500);
    actor.hp = 100;
    queueCommand(state, {
      id: 'recall',
      atMs: 0,
      intent: { kind: 'RECALL', actorId: actor.id, reason: 'quest recall' },
    });
    runUntil(state, 5400);
    expect(actor.action.kind).toBe('RECALL');
    runUntil(state, 5500);
    expect(actor.action.kind).toBe('IDLE');
    expect(actor.position).toEqual(state.input.map.bases.BLUE);
    expect(actor.hp).toBe(100);
    expect(
      state.events.find((event) => event.kind === 'RECALL_COMPLETE')?.atMs,
    ).toBe(5500);
  });

  it('still interrupts an empowered recall on real incoming damage', () => {
    const state = scenario(),
      [actor, enemy] = state.actors;
    enemy.position = { x: 5000, y: 5000 };
    rewardCs(state, 'MID', 2);
    advanceRoleQuests(state);
    queueCommand(state, {
      id: 'recall',
      atMs: 0,
      intent: { kind: 'RECALL', actorId: actor.id, reason: 'quest recall' },
    });
    queueCommand(state, {
      id: 'attack',
      atMs: 100,
      intent: {
        kind: 'ATTACK',
        actorId: enemy.id,
        targetId: actor.id,
        reason: 'interrupt',
      },
    });
    runUntil(state, 5500);
    expect(
      state.events.some(
        (event) => event.kind === 'RECALL_CANCEL' && event.actorId === actor.id,
      ),
    ).toBe(true);
    expect(
      state.events.some(
        (event) =>
          event.kind === 'RECALL_COMPLETE' && event.actorId === actor.id,
      ),
    ).toBe(false);
    expect(actor.position).not.toEqual(state.input.map.bases.BLUE);
  });

  it('support receives ward progress only after a physical installation completes', () => {
    const state = scenario('SUPPORT', 50),
      actor = state.actors[0];
    queueCommand(state, {
      id: 'ward',
      atMs: 0,
      intent: {
        kind: 'WARD',
        actorId: actor.id,
        point: actor.position,
        reason: 'quest ward',
      },
    });
    runUntil(state, 200);
    expect(state.roleQuests!.actors[actor.id].points).toBe(0);
    runUntil(state, 300);
    expect(state.roleQuests!.actors[actor.id].points).toBe(50);
    expect(state.vision!.inventory[actor.id].charges).toBe(1);
    expect(state.ledger.filter((entry) => entry.kind === 'QUEST')).toHaveLength(
      1,
    );
  });

  it('does not rescan old ledger rows on an unrelated new movement event', () => {
    const state = scenario('MID', 1000),
      actor = state.actors[0];
    for (let i = 0; i < 200; i++)
      grantReward(state, {
        key: `passive:${i}`,
        actorId: actor.id,
        sourceId: 'PASSIVE',
        gold: 1,
        xp: 0,
        cs: 0,
        kind: 'PASSIVE',
      });
    advanceRoleQuests(state);
    let historicalReads = 0;
    state.ledger = new Proxy(state.ledger, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property))
          historicalReads++;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    emit(state, { kind: 'MOVE', actorId: actor.id, position: actor.position });
    advanceRoleQuests(state);
    expect(historicalReads).toBe(0);
  });
});
