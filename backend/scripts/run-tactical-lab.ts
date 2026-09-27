import { performance } from 'node:perf_hooks';
import type { EngineState } from '../src/matches/simulation-v2/contracts';
import { startSimulation, runUntil } from '../src/matches/simulation-v2/engine';
import { projectMatch } from '../src/matches/simulation-v2/projection';
import { canonicalHash } from '../src/matches/simulation-v2/seeded-rng';
import { createLabInput } from '../src/matches/simulation-v2/test-fixtures';
import {
  checkpoint,
  restoreCheckpoint,
  type SimulationCheckpoint,
} from '../src/matches/simulation-v2/world-state';

export interface LabOptions {
  seed: number;
  minutes: number;
  batch: number;
  verifyResume: boolean;
}

const USAGE =
  'Usage: npm run sim:lab -- [--seed 0..4294967295] [--minutes 1..10] [--batch 1..100] [--verify-resume]';
const CHUNK_MS = 30_000;
const UINT32_SIZE = 0x1_0000_0000;
const rounded = (value: number) => Math.round(value * 100) / 100;

/** Reject mistakes before starting CPU work; never loads the Nest app or a datasource. */
export function parseLabOptions(args: string[]): LabOptions {
  const options: LabOptions = {
    seed: 123,
    minutes: 10,
    batch: 1,
    verifyResume: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--seed', '--minutes', '--batch', '--verify-resume'].includes(flag))
      throw new Error(`Unknown argument: ${flag}\n${USAGE}`);
    if (seen.has(flag)) throw new Error(`Repeated argument: ${flag}\n${USAGE}`);
    seen.add(flag);
    if (flag === '--verify-resume') {
      options.verifyResume = true;
      continue;
    }
    const raw = args[++index];
    if (raw === undefined || !/^(0|[1-9]\d*)$/.test(raw))
      throw new Error(`Expected an integer after ${flag}\n${USAGE}`);
    const value = Number(raw);
    const [min, max] =
      flag === '--seed'
        ? [0, UINT32_SIZE - 1]
        : flag === '--minutes'
          ? [1, 10]
          : [1, 100];
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${flag} must be between ${min} and ${max}\n${USAGE}`);
    if (flag === '--seed') options.seed = value;
    else if (flag === '--minutes') options.minutes = value;
    else options.batch = value;
  }
  return options;
}

function requireInvariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Simulation invariant failed: ${message}`);
}

function equalAmount(actual: number, expected: number, message: string): void {
  requireInvariant(
    Number.isFinite(actual) &&
      Number.isFinite(expected) &&
      Math.abs(actual - expected) < 0.0001,
    `${message}: ${actual} != ${expected}`,
  );
}

function verifyFiniteTree(value: unknown): void {
  if (typeof value === 'number')
    requireInvariant(Number.isFinite(value), 'NaN/Infinity in state');
  else if (value !== null && typeof value === 'object')
    Object.values(value).forEach(verifyFiniteTree);
}

/** Compare independently projected events/ledger with the running counters and wallet. */
export function verifyLabState(state: EngineState, targetMs: number) {
  requireInvariant(
    state.simTimeMs === targetMs,
    'requested end time was not reached',
  );
  requireInvariant(
    state.winnerTeamId === null,
    'development horizon must not manufacture a winner',
  );
  requireInvariant(
    state.status ===
      (targetMs === state.input.rules.maxHorizonMs
        ? 'HORIZON_REACHED'
        : 'RUNNING'),
    'unexpected lifecycle status',
  );
  requireInvariant(state.error === null, 'engine has an error');
  verifyFiniteTree(state);
  const report = projectMatch(state);
  const actors = new Map(state.actors.map((actor) => [actor.id, actor]));
  const deathEvents = state.events.filter(
    (event) => event.kind === 'DEATH' && actors.has(event.targetId ?? ''),
  );
  const championKills = deathEvents.filter((event) => {
    const killer = actors.get(event.actorId ?? '');
    return killer && killer.side !== actors.get(event.targetId!)!.side;
  }).length;
  requireInvariant(
    new Set(state.ledger.map((entry) => entry.key)).size ===
      state.ledger.length,
    'duplicate ledger keys',
  );
  for (const entry of state.ledger) {
    requireInvariant(
      state.rewardKeys[entry.key] === true,
      `untracked ledger reward ${entry.key}`,
    );
    const event = state.events[entry.seq - 1];
    requireInvariant(
      !!event && event.seq === entry.seq && event.atMs === entry.atMs,
      `ledger event sequence mismatch ${entry.key}`,
    );
  }
  for (const player of report.players) {
    const actor = actors.get(player.actorId)!;
    equalAmount(actor.gold, player.walletGold, `${actor.id} wallet`);
    equalAmount(actor.xp, player.xpEarned, `${actor.id} XP`);
    for (const key of [
      'kills',
      'deaths',
      'assists',
      'cs',
      'goldEarned',
      'goldSpent',
      'xpEarned',
      'damageToChampions',
      'damageTaken',
    ] as const)
      equalAmount(actor.stats[key], player[key], `${actor.id} ${key}`);
    requireInvariant(
      actor.gold >= 0 && actor.hp >= 0 && actor.hp <= actor.maxHp,
      `${actor.id} negative wallet or HP outside max`,
    );
    requireInvariant(
      actor.level >= 1 && actor.level <= state.input.rules.maxLevel,
      `${actor.id} invalid level`,
    );
    requireInvariant(
      player.gdAt15 === null && player.csdAt15 === null,
      'pre-15-minute statistics must be null',
    );
  }
  equalAmount(
    report.players.reduce((sum, player) => sum + player.deaths, 0),
    deathEvents.length,
    'total deaths',
  );
  equalAmount(
    report.players.reduce((sum, player) => sum + player.kills, 0),
    championKills,
    'total credited kills',
  );
  // Neutral/minion kills can cause player deaths without granting a champion kill.
  requireInvariant(
    championKills <= deathEvents.length,
    'more champion kills than player deaths',
  );
  equalAmount(
    report.teams.reduce((sum, team) => sum + team.kills, 0),
    championKills,
    'team kill totals',
  );
  return report;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function runLab(options: LabOptions) {
  // Re-validate programmatic callers as well as CLI strings.
  parseLabOptions([
    '--seed',
    String(options.seed),
    '--minutes',
    String(options.minutes),
    '--batch',
    String(options.batch),
  ]);
  requireInvariant(
    typeof options.verifyResume === 'boolean',
    'verifyResume must be boolean',
  );
  const beforeMemory = process.memoryUsage();
  let sampledMaxHeap = beforeMemory.heapUsed;
  let sampledMaxRss = beforeMemory.rss;
  let memorySamples = 1;
  const sampleMemory = () => {
    const sample = process.memoryUsage();
    sampledMaxHeap = Math.max(sampledMaxHeap, sample.heapUsed);
    sampledMaxRss = Math.max(sampledMaxRss, sample.rss);
    memorySamples++;
  };
  const advance = (state: EngineState, targetMs: number): EngineState => {
    while (state.simTimeMs < targetMs) {
      runUntil(state, Math.min(targetMs, state.simTimeMs + CHUNK_MS));
      sampleMemory();
    }
    return state;
  };
  const targetMs = options.minutes * 60_000;
  const batchStarted = performance.now();
  const runs = Array.from({ length: options.batch }, (_, index) => {
    const seed = (options.seed + index) % UINT32_SIZE;
    const started = performance.now();
    const input = createLabInput(seed);
    requireInvariant(
      targetMs <= input.rules.maxHorizonMs && targetMs <= 600_000,
      'unsupported simulation horizon',
    );
    const state = startSimulation(input);
    sampleMemory();
    advance(state, targetMs);
    const simulationMs = performance.now() - started;
    const report = verifyLabState(state, targetMs);
    const stateHash = canonicalHash(state);
    const replayJsonBytes = Buffer.byteLength(
      JSON.stringify({ frames: state.frames, events: state.events }),
      'utf8',
    );
    const checkpointJsonBytes = Buffer.byteLength(
      JSON.stringify(checkpoint(state)),
      'utf8',
    );
    sampleMemory();
    let resume: {
      verified: boolean;
      verificationMs: number;
      midpointMs: number;
      checkpointJsonBytes: number;
    } | null = null;
    if (options.verifyResume) {
      const resumeStarted = performance.now();
      const interrupted = startSimulation(input);
      const midpointMs =
        Math.floor(targetMs / 2 / input.rules.stepMs) * input.rules.stepMs;
      advance(interrupted, midpointMs);
      const serialized = JSON.stringify(checkpoint(interrupted));
      const restored = restoreCheckpoint(
        JSON.parse(serialized) as SimulationCheckpoint,
      );
      advance(restored, targetMs);
      const restoredReport = verifyLabState(restored, targetMs);
      requireInvariant(
        canonicalHash(restored) === stateHash,
        'checkpoint resume changed full state hash',
      );
      requireInvariant(
        restoredReport.stateHash === report.stateHash,
        'checkpoint resume changed report state hash',
      );
      requireInvariant(
        restoredReport.ledgerHash === report.ledgerHash,
        'checkpoint resume changed ledger hash',
      );
      resume = {
        verified: true,
        verificationMs: rounded(performance.now() - resumeStarted),
        midpointMs,
        checkpointJsonBytes: Buffer.byteLength(serialized, 'utf8'),
      };
      sampleMemory();
    }
    return {
      seed,
      simulatedMinutes: options.minutes,
      status: state.status,
      winnerTeamId: state.winnerTeamId,
      simulationMs: rounded(simulationMs),
      eventCount: state.events.length,
      ledgerCount: state.ledger.length,
      frameCount: state.frames.length,
      unitCount: state.units.length,
      replayJsonBytes,
      checkpointJsonBytes,
      stateHash,
      ledgerHash: report.ledgerHash,
      invariantsPassed: true,
      resume,
      players: report.players.map((player) => ({
        side: player.side,
        position: player.position,
        champion: player.championId,
        kda: `${player.kills}/${player.deaths}/${player.assists}`,
        cs: player.cs,
        level: state.actors.find((actor) => actor.id === player.actorId)!.level,
        wallet: player.walletGold,
        earned: player.goldEarned,
        spent: player.goldSpent,
        damageToChampions: rounded(player.damageToChampions),
      })),
    };
  });
  sampleMemory();
  const timings = runs.map((run) => run.simulationMs);
  return {
    mode: 'NON_COMMITTING_TACTICAL_LAB',
    options,
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    timings: {
      batchWallMs: rounded(performance.now() - batchStarted),
      p50SimulationMs: percentile(timings, 0.5),
      p95SimulationMs: percentile(timings, 0.95),
      maxSimulationMs: Math.max(...timings),
      method:
        'Nearest-rank percentiles; simulation includes input construction and 30s simulation chunks, excludes projection/hashing/JSON/resume checks; batch wall includes all work. No warm-up exclusion.',
    },
    memory: {
      baselineHeapBytes: beforeMemory.heapUsed,
      sampledMaxHeapBytes: sampledMaxHeap,
      sampledMaxRssBytes: sampledMaxRss,
      sampleCount: memorySamples,
      method:
        'Entire CLI process memory sampled after initialization, each 30s of simulation, reporting and resume checks. These are sampled maxima, not allocation peaks or isolated per-game memory; GC is not forced.',
    },
    totals: {
      runs: runs.length,
      events: runs.reduce((sum, run) => sum + run.eventCount, 0),
      maxReplayJsonBytes: Math.max(...runs.map((run) => run.replayJsonBytes)),
      maxCheckpointJsonBytes: Math.max(
        ...runs.map((run) => run.checkpointJsonBytes),
      ),
      databaseWrites: 0,
    },
    scope:
      'Synthetic fixtures only. No DB, network or filesystem writes. Approximate early-game laboratory, not a complete match or full Riot champion abilities. Sequential uint32 seeds wrap at 4294967295.',
    runs,
  };
}

if (require.main === module) {
  try {
    const result = runLab(parseLabOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
