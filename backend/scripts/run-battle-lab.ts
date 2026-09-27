import { performance } from 'node:perf_hooks';
import { createLabInput } from '../src/matches/simulation-v2/test-fixtures';
import { createBattleRuleset } from '../src/matches/simulation-v2/battle-rules';
import { startSimulation, runUntil } from '../src/matches/simulation-v2/engine';
import { projectMatch } from '../src/matches/simulation-v2/projection';
import {
  checkpoint,
  restoreCheckpoint,
} from '../src/matches/simulation-v2/world-state';
import { canonicalHash } from '../src/matches/simulation-v2/seeded-rng';
import type { EngineState } from '../src/matches/simulation-v2/contracts';

export function verifyBattleState(state: EngineState): void {
  const report = projectMatch(state);
  const invariant = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`Battle invariant: ${message}`);
  };
  canonicalHash(state); // all persisted values finite, JSON-only
  invariant(!state.error && state.status !== 'ERROR', 'error state');
  invariant(
    new Set(state.ledger.map((entry) => entry.key)).size ===
      state.ledger.length,
    'duplicate rewards',
  );
  for (const player of report.players) {
    const actor = state.actors.find((a) => a.id === player.actorId)!;
    for (const key of [
      'kills',
      'deaths',
      'assists',
      'cs',
      'damageToChampions',
      'damageTaken',
      'goldEarned',
      'goldSpent',
      'xpEarned',
    ] as const)
      invariant(
        Math.abs(actor.stats[key] - player[key]) < 0.001,
        `${actor.id} projected ${key}`,
      );
    invariant(
      Math.abs(actor.gold - player.walletGold) < 0.001 && actor.gold >= 0,
      'wallet accounting',
    );
    invariant(Math.abs(actor.xp - player.xpEarned) < 0.001, 'XP accounting');
    invariant(
      actor.hp >= 0 &&
        actor.hp <= actor.maxHp &&
        actor.mana >= 0 &&
        actor.mana <= actor.maxMana,
      'HP/resource bounds',
    );
    invariant(
      state.simTimeMs < 900_000
        ? player.gdAt15 === null
        : player.gdAt15 !== null,
      '15 minute snapshot',
    );
  }
  for (const entry of state.ledger)
    invariant(
      state.rewardKeys[entry.key] === true &&
        state.events[entry.seq - 1]?.seq === entry.seq,
      'ledger audit trail',
    );
  const endings = state.events.filter(
    (event) => event.kind === 'NEXUS_DESTROYED',
  );
  if (state.status === 'FINISHED') {
    invariant(
      endings.length === 1 && state.winnerTeamId !== null,
      'unique physical victory',
    );
    const nexus = state.units.find((unit) => unit.id === endings[0].targetId);
    invariant(
      nexus?.kind === 'NEXUS' && nexus.hp === 0 && !nexus.active,
      'nexus evidence',
    );
  } else
    invariant(
      endings.length === 0 && state.winnerTeamId === null,
      'no manufactured horizon winner',
    );
}

export function runBattle(
  seed: number,
  minutes: number,
  verifyResume = false,
  progress = false,
) {
  if (
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffff_ffff ||
    !Number.isSafeInteger(minutes) ||
    minutes < 1 ||
    minutes > 60
  )
    throw new Error('seed must be uint32; minutes 1..60');
  const input = createLabInput(seed);
  input.rules = createBattleRuleset();
  const state = startSimulation(input);
  let saved: ReturnType<typeof checkpoint> | null = null;
  const started = performance.now();
  const end = minutes * 60_000;
  const midpoint = Math.min(
    30_000,
    Math.floor(end / 2 / input.rules.stepMs) * input.rules.stepMs,
  );
  while (state.status === 'RUNNING' && state.simTimeMs < end) {
    const next = Math.min(
      end,
      state.simTimeMs + 30_000,
      verifyResume && !saved ? midpoint : end,
    );
    runUntil(state, next);
    if (verifyResume && !saved && state.simTimeMs >= midpoint)
      saved = checkpoint(state);
    if (progress && state.simTimeMs % 300_000 === 0)
      console.log(
        JSON.stringify({
          minute: state.simTimeMs / 60_000,
          status: state.status,
          kills: state.actors.map((a) => a.stats.kills),
          levels: state.actors.map((a) => a.level),
          cs: state.actors.map((a) => a.stats.cs),
          structures: state.units
            .filter((u) => u.structure && !u.active)
            .map((u) => u.id),
          objectives: state.events
            .filter((e) => e.kind === 'OBJECTIVE_CAPTURED')
            .map((e) => e.reason),
          plans: state.actors.map((a) => a.plan?.kind),
          heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
        }),
      );
  }
  const simulationMs = performance.now() - started;
  verifyBattleState(state);
  let resumedMatch: boolean | null = null;
  if (saved) {
    const resumed = restoreCheckpoint(
      JSON.parse(JSON.stringify(saved)) as typeof saved,
    );
    runUntil(resumed, state.simTimeMs);
    resumedMatch = canonicalHash(state) === canonicalHash(resumed);
    if (!resumedMatch)
      throw new Error(
        'Checkpoint continuation differs from uninterrupted battle',
      );
  }
  return {
    seed,
    status: state.status,
    winnerTeamId: state.winnerTeamId,
    minutes: state.simTimeMs / 60_000,
    simulationMs: Math.round(simulationMs),
    resumedMatch,
    kills: state.actors.map((a) => a.stats.kills),
    cs: state.actors.map((a) => a.stats.cs),
    objectives: state.events
      .filter((e) => e.kind === 'OBJECTIVE_CAPTURED')
      .map((e) => e.reason),
    destroyed: state.units
      .filter((u) => u.structure && !u.active)
      .map((u) => u.id),
    events: state.events.length,
    actors: state.actors.map((a) => ({
      id: a.id,
      level: a.level,
      hp: Math.round(a.hp),
      items: a.items,
      gold: Math.round(a.gold),
      position: a.position,
      action: a.action,
      plan: a.plan?.reason,
    })),
    ledger: state.ledger.length,
    replayMB:
      Math.round(Buffer.byteLength(JSON.stringify(state.frames)) / 10485.76) /
      100,
    stateHash: canonicalHash(state),
    ledgerHash: canonicalHash(state.ledger),
  };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const read = (flag: string, fallback: number) =>
    args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback;
  const allowed = new Set([
    '--seed',
    '--minutes',
    '--batch',
    '--verify-resume',
    '--progress',
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index]))
      throw new Error(`Unknown flag ${args[index]}`);
    if (seen.has(args[index])) throw new Error(`Repeated flag ${args[index]}`);
    seen.add(args[index]);
    if (['--seed', '--minutes', '--batch'].includes(args[index])) {
      if (!/^(0|[1-9]\d*)$/.test(args[index + 1] ?? ''))
        throw new Error(`Expected integer after ${args[index]}`);
      index++;
    }
  }
  const seed = read('--seed', 123),
    minutes = read('--minutes', 60),
    batch = read('--batch', 1);
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 20)
    throw new Error('batch must be 1..20');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff)
    throw new Error('seed must be uint32');
  for (let i = 0; i < batch; i++)
    console.log(
      JSON.stringify(
        runBattle(
          (seed + i) >>> 0,
          minutes,
          args.includes('--verify-resume'),
          args.includes('--progress'),
        ),
      ),
    );
}
