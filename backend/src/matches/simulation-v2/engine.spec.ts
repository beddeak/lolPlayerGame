import { startSimulation, queueCommand, runUntil } from './engine';
import { createDuelInput, createLabInput } from './test-fixtures';
import { checkpoint, restoreCheckpoint } from './world-state';
import { canonicalHash } from './seeded-rng';
import { distance, hasLineOfSight } from './map-paths';
import { observe } from './observation';
import type { ScheduledCommand } from './contracts';
import type { SimulationCheckpoint } from './world-state';

function duel() {
  const state = startSimulation(createDuelInput());
  state.actors[0].position = { x: 4900, y: 5100 };
  state.actors[1].position = { x: 5000, y: 5000 };
  return state;
}

describe('tactical engine foundations (non-committing lab)', () => {
  it('rejects malformed input and preserves a detached pinned input', () => {
    const input = createDuelInput();
    const state = startSimulation(input);
    input.actors[0].profile.maxHp = 1;
    expect(state.actors[0].maxHp).toBeGreaterThan(1);
    const invalid = createDuelInput();
    invalid.actors[0].profile.moveSpeed = Infinity;
    expect(() => startSimulation(invalid)).toThrow();
    const duplicate = createDuelInput();
    duplicate.actors[1].actorId = duplicate.actors[0].actorId;
    expect(() => startSimulation(duplicate)).toThrow(/duplicate actor/);
  });

  it('requires time-aligned commands and rejects duplicate command IDs', () => {
    const state = duel(),
      actorId = state.actors[0].id;
    const command = {
      id: 'hold',
      atMs: 0,
      intent: { kind: 'HOLD' as const, actorId, reason: 'test' },
    };
    expect(queueCommand(state, command)).toBe(true);
    expect(queueCommand(state, command)).toBe(false);
    expect(() =>
      queueCommand(state, { ...command, id: 'invalid', atMs: 17 }),
    ).toThrow();
    runUntil(state, 100);
    expect(queueCommand(state, command)).toBe(false);
    expect(() =>
      queueCommand(state, { ...command, id: 'past', atMs: 0 }),
    ).toThrow();
    expect(() => runUntil(state, 101)).toThrow();
  });

  it('does not attack outside range, then damages only after legal travel', () => {
    const state = duel();
    state.actors[0].position = { x: 5500, y: 4500 };
    state.actors[1].position = { x: 6000, y: 4000 };
    const initialHp = state.actors[1].hp;
    queueCommand(state, {
      id: 'attack',
      atMs: 0,
      intent: {
        kind: 'ATTACK',
        actorId: state.actors[0].id,
        targetId: state.actors[1].id,
        reason: 'range test',
      },
    });
    runUntil(state, 1000);
    expect(state.actors[1].hp).toBe(initialHp);
    runUntil(state, 3000);
    expect(state.actors[1].hp).toBeLessThan(initialHp);
    expect(
      distance(state.actors[0].position, state.actors[1].position),
    ).toBeLessThanOrEqual(state.actors[0].attackRange);
  });

  it('rejects incomplete command payloads before changing the queue or ID registry', () => {
    const state = duel();
    const malformed = {
      id: 'missing-point',
      atMs: 0,
      intent: {
        kind: 'MOVE',
        actorId: state.actors[0].id,
        reason: 'Malformed input',
      },
    } as ScheduledCommand;
    expect(() => queueCommand(state, malformed)).toThrow(/command target/);
    expect(state.commands).toHaveLength(0);
    expect(state.commandIds).toEqual({});
    expect(state.status).toBe('RUNNING');
  });

  it('uses actual path distance, not a straight jump through a wall', () => {
    const state = duel(),
      actor = state.actors[0];
    actor.position = { x: 2000, y: 5500 };
    queueCommand(state, {
      id: 'move',
      atMs: 0,
      intent: {
        kind: 'MOVE',
        actorId: actor.id,
        point: { x: 3400, y: 5500 },
        reason: 'walk around the wall',
      },
    });
    let previous = { ...actor.position };
    for (let at = 100; at <= 5000; at += 100) {
      runUntil(state, at);
      expect(distance(previous, actor.position)).toBeLessThanOrEqual(
        actor.moveSpeed * 0.1 + 0.000001,
      );
      // A short step can consume a corner; endpoint tests do not claim straight rendering is the path.
      if (actor.path.length === 1)
        expect(
          hasLineOfSight(state.input.map, actor.position, actor.path[0]),
        ).toBe(true);
      previous = { ...actor.position };
    }
    expect(actor.position).not.toEqual({ x: 3400, y: 5500 });
    expect(state.events.filter((e) => e.kind === 'DAMAGE')).toHaveLength(0);
  });

  it('stops attacks when an initially visible target leaves team vision', () => {
    const input = createDuelInput();
    input.actors[0].profile.attackRange = 2000;
    input.actors[0].profile.visionRange = 50;
    input.actors[0].profile.attackDamage = 10;
    const state = startSimulation(input);
    const [a, b] = state.actors;
    a.position = { x: 5000, y: 5000 };
    b.position = { x: 5010, y: 5000 };
    queueCommand(state, {
      id: 'seen',
      atMs: 0,
      intent: {
        kind: 'ATTACK',
        actorId: a.id,
        targetId: b.id,
        reason: 'Initially visible',
      },
    });
    queueCommand(state, {
      id: 'escape',
      atMs: 0,
      intent: {
        kind: 'MOVE',
        actorId: b.id,
        point: { x: 6000, y: 5000 },
        reason: 'Leave vision',
      },
    });
    runUntil(state, 0);
    const healthAfterVisibleHit = b.hp;
    expect(healthAfterVisibleHit).toBeLessThan(b.maxHp);
    runUntil(state, 2000);
    expect(distance(a.position, b.position)).toBeGreaterThan(50);
    expect(distance(a.position, b.position)).toBeLessThan(a.attackRange);
    expect(b.hp).toBe(healthAfterVisibleHit);
    expect(
      state.events.filter((e) => e.kind === 'DAMAGE' && e.targetId === b.id),
    ).toHaveLength(1);
  });

  it('does not move newly spawned resources before their spawn time', () => {
    const state = startSimulation(createDuelInput());
    runUntil(state, state.input.rules.waveStartMs);
    const minions = state.units.filter((u) => u.kind === 'MINION');
    expect(minions.length).toBe(36);
    for (const minion of minions)
      expect(minion.position).toEqual(minion.origin);
    runUntil(state, state.simTimeMs + 100);
    expect(minions.every((u) => distance(u.position, u.origin) > 0)).toBe(true);
  });

  it('rejects commands for dead actors and never turns a lab horizon into a win', () => {
    const input = createDuelInput();
    input.rules.maxHorizonMs = 1000;
    const state = startSimulation(input);
    const [a, b] = state.actors;
    a.position = { x: 4900, y: 5100 };
    b.position = { x: 5000, y: 5000 };
    b.hp = 1;
    queueCommand(state, {
      id: 'kill',
      atMs: 0,
      intent: {
        kind: 'ATTACK',
        actorId: a.id,
        targetId: b.id,
        reason: 'Kill',
      },
    });
    queueCommand(state, {
      id: 'dead-move',
      atMs: 100,
      intent: {
        kind: 'MOVE',
        actorId: b.id,
        point: { x: 6000, y: 5000 },
        reason: 'Cannot move',
      },
    });
    runUntil(state, 1000);
    expect(b.position).toEqual({ x: 5000, y: 5000 });
    expect(
      state.events.some((e) => e.kind === 'REJECTED' && e.actorId === b.id),
    ).toBe(true);
    expect(state.status).toBe('HORIZON_REACHED');
    expect(state.winnerTeamId).toBeNull();
    expect(state.at15).toBeNull();
    expect(() =>
      queueCommand(state, {
        id: 'late',
        atMs: 1000,
        intent: {
          kind: 'HOLD',
          actorId: a.id,
          reason: 'Finished lab',
        },
      }),
    ).toThrow();
  });

  it('recall must finish its channel; completion itself does not refill health', () => {
    const state = duel(),
      actor = state.actors[0];
    actor.hp = 100;
    queueCommand(state, {
      id: 'recall',
      atMs: 0,
      intent: { kind: 'RECALL', actorId: actor.id, reason: 'recover' },
    });
    runUntil(state, 7900);
    expect(actor.position).toEqual({ x: 4900, y: 5100 });
    expect(actor.hp).toBe(100);
    runUntil(state, 8000);
    expect(actor.position).toEqual(state.input.map.bases.BLUE);
    expect(actor.hp).toBe(100);
    runUntil(state, 8100);
    expect(actor.hp).toBeGreaterThan(100);
  });

  it('incoming damage cancels recall at the completion boundary', () => {
    const state = duel(),
      [a, b] = state.actors;
    queueCommand(state, {
      id: 'recall',
      atMs: 0,
      intent: { kind: 'RECALL', actorId: a.id, reason: 'recover' },
    });
    queueCommand(state, {
      id: 'interrupt',
      atMs: 8000,
      intent: {
        kind: 'ATTACK',
        actorId: b.id,
        targetId: a.id,
        reason: 'interrupt',
      },
    });
    runUntil(state, 8000);
    expect(state.events.some((e) => e.kind === 'RECALL_CANCEL')).toBe(true);
    expect(state.events.some((e) => e.kind === 'RECALL_COMPLETE')).toBe(false);
    expect(a.position).not.toEqual(state.input.map.bases.BLUE);
  });

  it('zero-damage simultaneous hits neither produce NaN nor interrupt recall', () => {
    const input = createLabInput();
    input.controlMode = 'SCRIPTED';
    input.actors[0].profile.attackDamage = 1e-12;
    input.actors[1].profile.attackDamage = 1e-12;
    const state = startSimulation(input);
    const attackers = state.actors.slice(0, 2);
    const target = state.actors.find((a) => a.side === 'RED')!;
    target.position = { x: 5000, y: 5000 };
    for (const actor of attackers) {
      actor.position = { x: 5010, y: 5000 };
      queueCommand(state, {
        id: actor.id,
        atMs: 0,
        intent: {
          kind: 'ATTACK',
          actorId: actor.id,
          targetId: target.id,
          reason: 'Zero rounded hit',
        },
      });
    }
    queueCommand(state, {
      id: 'recall-zero-damage',
      atMs: 0,
      intent: {
        kind: 'RECALL',
        actorId: target.id,
        reason: 'Not wounded',
      },
    });
    runUntil(state, 8000);
    expect(target.hp).toBe(target.maxHp);
    expect(state.events.filter((e) => e.kind === 'DAMAGE')).toHaveLength(0);
    expect(state.events.filter((e) => e.kind === 'RECALL_CANCEL')).toHaveLength(
      0,
    );
    expect(
      state.events.filter((e) => e.kind === 'RECALL_COMPLETE'),
    ).toHaveLength(1);
    expect(state.status).toBe('RUNNING');
  });

  it('records a death and bounty once, does not heal a killer, respawns at the fountain', () => {
    const state = duel(),
      [a, b] = state.actors;
    a.hp = 100;
    b.hp = 1;
    queueCommand(state, {
      id: 'kill',
      atMs: 0,
      intent: { kind: 'ATTACK', actorId: a.id, targetId: b.id, reason: 'kill' },
    });
    runUntil(state, 0);
    expect(b.active).toBe(false);
    expect(a.hp).toBe(100);
    expect(a.stats.kills).toBe(1);
    expect(b.stats.deaths).toBe(1);
    const deadline = b.respawnAtMs!;
    runUntil(state, deadline - 100);
    expect(b.active).toBe(false);
    expect(
      state.events.filter((e) => e.kind === 'DEATH' && e.targetId === b.id),
    ).toHaveLength(1);
    runUntil(state, deadline);
    expect(b.active).toBe(true);
    expect(b.position).toEqual(state.input.map.bases.RED);
    expect(b.hp).toBe(b.maxHp);
  });

  it('resolves simultaneous lethal attacks without giving the first array side priority', () => {
    for (const reverse of [false, true]) {
      const state = duel();
      state.actors.forEach((a) => {
        a.hp = 1;
      });
      const [a, b] = state.actors;
      for (const [actor, target] of [
        [a, b],
        [b, a],
      ])
        queueCommand(state, {
          id: actor.id,
          atMs: 0,
          intent: {
            kind: 'ATTACK',
            actorId: actor.id,
            targetId: target.id,
            reason: 'trade',
          },
        });
      if (reverse) state.actors.reverse();
      runUntil(state, 0);
      expect(state.actors.every((a) => !a.active)).toBe(true);
      expect(state.actors.map((a) => a.stats.kills)).toEqual([1, 1]);
      expect(state.actors.map((a) => a.stats.deaths)).toEqual([1, 1]);
    }
  });

  it('omits unseen enemy health/position changes and stores detached past observations', () => {
    const state = duel(),
      [a, b] = state.actors;
    queueCommand(state, {
      id: 'record-vision',
      atMs: 0,
      intent: {
        kind: 'HOLD',
        actorId: a.id,
        reason: 'Observe on an authoritative tick',
      },
    });
    runUntil(state, 0);
    const first = observe(state, 'BLUE');
    const old = first.visible.find((v) => v.id === b.id)!;
    const lastKnownHp = old.hp;
    old.hp = 1;
    old.position.x = 0;
    b.position = { ...state.input.map.bases.RED };
    b.hp = 7;
    const second = observe(state, 'BLUE');
    expect(second.visible.some((v) => v.id === b.id)).toBe(false);
    expect(second.remembered.find((v) => v.unit.id === b.id)!.unit.hp).toBe(
      lastKnownHp,
    );
    expect(
      second.remembered.find((v) => v.unit.id === b.id)!.unit.position.x,
    ).not.toBe(0);
    expect(second.allies.some((v) => v.id !== a.id)).toBe(false);
  });

  it('keeps checkpoint/resume, direct execution and chunked execution identical', () => {
    const input = createLabInput(42);
    const direct = runUntil(startSimulation(input), 60_000);
    const split = runUntil(startSimulation(input), 27_000);
    const restored = restoreCheckpoint(
      JSON.parse(JSON.stringify(checkpoint(split))) as SimulationCheckpoint,
    );
    for (let at = 28_000; at <= 60_000; at += 1000) runUntil(restored, at);
    expect(canonicalHash(restored)).toBe(canonicalHash(direct));
    const broken = checkpoint(split);
    broken.state.actors[0].hp++;
    expect(() => restoreCheckpoint(broken)).toThrow(/Corrupt/);
  });

  it('viewing observations between decisions never changes subsequent simulation', () => {
    const input = createLabInput(41);
    const direct = runUntil(startSimulation(input), 60_000);
    const inspected = startSimulation(input);
    for (let at = 500; at <= 60_000; at += 500) {
      runUntil(inspected, at);
      observe(inspected, 'BLUE');
      observe(inspected, 'RED');
    }
    expect(canonicalHash(inspected)).toBe(canonicalHash(direct));
  });

  it.each(['RECALL', 'DEAD'] as const)(
    'restores an in-flight %s transition and queued future command exactly once',
    (transition) => {
      const state = duel();
      const [a, b] = state.actors;
      if (transition === 'RECALL') {
        queueCommand(state, {
          id: 'recall',
          atMs: 0,
          intent: {
            kind: 'RECALL',
            actorId: b.id,
            reason: 'Pending channel',
          },
        });
      } else {
        b.hp = 1;
        queueCommand(state, {
          id: 'kill',
          atMs: 0,
          intent: {
            kind: 'ATTACK',
            actorId: a.id,
            targetId: b.id,
            reason: 'Pending respawn',
          },
        });
      }
      queueCommand(state, {
        id: 'after-transition',
        atMs: 9000,
        intent: {
          kind: 'HOLD',
          actorId: b.id,
          reason: 'Restored future command',
        },
      });
      runUntil(state, 3000);
      expect(b.action.kind).toBe(transition);
      const restored = restoreCheckpoint(
        JSON.parse(JSON.stringify(checkpoint(state))) as SimulationCheckpoint,
      );
      runUntil(state, 10_000);
      runUntil(restored, 10_000);
      expect(canonicalHash(restored)).toBe(canonicalHash(state));
      expect(restored.commands).toHaveLength(0);
      expect(
        restored.events.filter(
          (e) =>
            e.kind ===
            (transition === 'RECALL' ? 'RECALL_COMPLETE' : 'RESPAWN'),
        ),
      ).toHaveLength(1);
    },
  );

  it('never invents CS for idle players, grants only real finite resource deaths', () => {
    const state = startSimulation(createDuelInput());
    runUntil(state, 60_000);
    expect(state.actors.every((a) => a.stats.cs === 0)).toBe(true);
    expect(state.units.some((u) => u.kind === 'MINION')).toBe(true);
    const observed = observe(state, 'BLUE');
    expect(observed.friendlyMinions!.length).toBeGreaterThan(0);
    expect(
      observed.friendlyMinions!.every((u) => u.side === 'BLUE' && u.active),
    ).toBe(true);
    const first = observed.friendlyMinions![0];
    first.position.x = -1;
    expect(
      state.units.find((u) => u.id === first.id)!.position.x,
    ).toBeGreaterThanOrEqual(0);
    expect(state.winnerTeamId).toBeNull();
    expect(state.at15).toBeNull();
  });
});
