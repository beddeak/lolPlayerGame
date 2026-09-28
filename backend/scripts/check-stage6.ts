import { cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createBattleRuleset } from '../src/matches/simulation-v2/battle-rules';
import {
  ENGINE_VERSION,
  type EngineState,
} from '../src/matches/simulation-v2/contracts';
import { runUntil, startSimulation } from '../src/matches/simulation-v2/engine';
import { projectMatch } from '../src/matches/simulation-v2/projection';
import { canonicalHash } from '../src/matches/simulation-v2/seeded-rng';
import { createLabInput } from '../src/matches/simulation-v2/test-fixtures';
import {
  checkpoint,
  restoreCheckpoint,
  type SimulationCheckpoint,
} from '../src/matches/simulation-v2/world-state';
import { verifyBattleState } from './run-battle-lab';
import { buildReplayArchive } from '../src/matches/simulation-v2/replay';

export interface Stage6Options {
  seed: number;
  minutes: number;
  batch: number;
  verifyModes: boolean;
  verifySamples: number;
}

const USAGE =
  'Usage: npm run test:sim:stage6 -- [--seed 0..4294967295] [--minutes 1..60] [--batch 1..100] [--verify-modes] [--verify-samples 1..batch]';

export function parseStage6Options(args: string[]): Stage6Options {
  const options: Stage6Options = {
    seed: 123,
    minutes: 1,
    batch: 20,
    verifyModes: false,
    verifySamples: 1,
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (
      ![
        '--seed',
        '--minutes',
        '--batch',
        '--verify-modes',
        '--verify-samples',
      ].includes(flag)
    )
      throw new Error(`Unknown argument ${flag}. ${USAGE}`);
    if (seen.has(flag)) throw new Error(`Repeated argument ${flag}. ${USAGE}`);
    seen.add(flag);
    if (flag === '--verify-modes') {
      options.verifyModes = true;
      continue;
    }
    const raw = args[++index];
    if (!/^(0|[1-9]\d*)$/.test(raw ?? ''))
      throw new Error(`Expected integer for ${flag}. ${USAGE}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(USAGE);
    if (flag === '--seed' && value <= 0xffff_ffff) options.seed = value;
    else if (flag === '--minutes' && value >= 1 && value <= 60)
      options.minutes = value;
    else if (flag === '--batch' && value >= 1 && value <= 100)
      options.batch = value;
    else if (flag === '--verify-samples' && value >= 1 && value <= 100)
      options.verifySamples = value;
    else throw new Error(`Out-of-range ${flag}. ${USAGE}`);
  }
  if (options.verifySamples > options.batch)
    throw new Error(`verify-samples must not exceed batch. ${USAGE}`);
  if (seen.has('--verify-samples') && !options.verifyModes)
    throw new Error(`verify-samples requires verify-modes. ${USAGE}`);
  return options;
}

/** Nearest-rank percentiles: no inferred distribution or fixed machine SLA. */
export function summarizeMeasurements(values: number[]) {
  if (values.length === 0) return null;
  if (values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Measurements must be finite and nonnegative');
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
  };
}

type Phase = 'INITIALIZE' | 'SIMULATE' | 'INVARIANTS' | 'STORAGE' | 'MODES';
interface Hashes {
  state: string;
  events: string;
  ledger: string;
  report: string;
}
interface ModeVerification {
  direct: Hashes;
  quick: Hashes;
  fast: Hashes;
  resumed: Hashes;
  checkpointAtMs: number;
  checkpointJsonBytes: number;
}
interface Sample {
  index: number;
  seed: number;
  passed: boolean;
  status: EngineState['status'] | null;
  winnerTeamId: number | null;
  simulatedMs: number;
  simulationWallMs: number;
  elapsedWallMs: number;
  memory: {
    heapBeforeBytes: number;
    heapAfterBytes: number;
    sampledPeakHeapBytes: number;
    rssBeforeBytes: number;
    rssAfterBytes: number;
    sampledPeakRssBytes: number;
  };
  eventCount: number;
  ledgerCount: number;
  frameCount: number;
  rawFrameJsonBytes: number | null;
  replayBytes: number | null;
  replayChunkCount: number | null;
  largestReplayChunkBytes: number | null;
  hashes: Hashes | null;
  modes: ModeVerification | null;
  failure: {
    phase: Phase;
    message: string;
    engineError: string | null;
    inputHash: string | null;
    lastEvents: Array<{ seq: number; atMs: number; kind: string }>;
    reproduce: string;
  } | null;
}

function hashes(state: EngineState): Hashes {
  return {
    state: canonicalHash(state),
    events: canonicalHash(state.events),
    ledger: canonicalHash(state.ledger),
    report: canonicalHash(projectMatch(state)),
  };
}

const roundMs = (value: number) => Math.round(value * 100) / 100;

function runSample(options: Stage6Options, index: number): Sample {
  const seed = (options.seed + index) >>> 0;
  const verifyModes = options.verifyModes && index < options.verifySamples;
  const before = process.memoryUsage();
  let peakHeap = before.heapUsed;
  let peakRss = before.rss;
  const observeMemory = () => {
    const usage = process.memoryUsage();
    peakHeap = Math.max(peakHeap, usage.heapUsed);
    peakRss = Math.max(peakRss, usage.rss);
    return usage;
  };
  const started = performance.now();
  let state: EngineState | null = null;
  let phase: Phase = 'INITIALIZE';
  let simulationWallMs = 0;
  let rawFrameJsonBytes: number | null = null;
  let replayBytes: number | null = null;
  let replayChunkCount: number | null = null;
  let largestReplayChunkBytes: number | null = null;
  let resultHashes: Hashes | null = null;
  let modes: ModeVerification | null = null;
  let failure: Sample['failure'] = null;
  try {
    const input = createLabInput(seed);
    input.rules = createBattleRuleset();
    state = startSimulation(input);
    const target = options.minutes * 60_000;
    let saved: SimulationCheckpoint | null = null;
    let checkpointJsonBytes = 0;
    phase = 'SIMULATE';
    // Fast is the measured baseline. Snapshot once, before continuing the same
    // live state; only selected seeds incur the three additional continuations.
    while (state.status === 'RUNNING' && state.simTimeMs < target) {
      const tickStart = performance.now();
      try {
        runUntil(state, Math.min(target, state.simTimeMs + 30_000));
      } finally {
        simulationWallMs += performance.now() - tickStart;
        observeMemory();
      }
      if (verifyModes && saved === null && state.simTimeMs < target) {
        const json = JSON.stringify(checkpoint(state));
        checkpointJsonBytes = Buffer.byteLength(json);
        saved = JSON.parse(json) as SimulationCheckpoint;
        observeMemory();
      }
    }
    phase = 'INVARIANTS';
    verifyBattleState(state);
    resultHashes = hashes(state);
    observeMemory();
    phase = 'STORAGE';
    rawFrameJsonBytes = Buffer.byteLength(JSON.stringify(state.frames));
    const archive = buildReplayArchive(state);
    replayBytes =
      Buffer.byteLength(JSON.stringify(archive.manifest)) +
      archive.manifest.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    replayChunkCount = archive.chunks.length;
    largestReplayChunkBytes = Math.max(
      ...archive.manifest.chunks.map((chunk) => chunk.bytes),
    );
    observeMemory();
    if (verifyModes) {
      phase = 'MODES';
      const runMode = (chunkMs: number): Hashes => {
        const candidate = startSimulation(input);
        while (candidate.status === 'RUNNING' && candidate.simTimeMs < target) {
          runUntil(candidate, Math.min(target, candidate.simTimeMs + chunkMs));
          observeMemory();
        }
        verifyBattleState(candidate);
        const candidateHashes = hashes(candidate);
        observeMemory();
        if (canonicalHash(candidateHashes) !== canonicalHash(resultHashes))
          throw new Error(`Mode hashes differ for chunk size ${chunkMs} ms`);
        return candidateHashes;
      };
      const direct = runMode(target); // Exactly one runUntil call.
      const quick = runMode(1000);
      if (!saved) throw new Error('No continuation checkpoint was captured');
      const resumed = restoreCheckpoint(saved);
      runUntil(resumed, target);
      verifyBattleState(resumed);
      const resumedHashes = hashes(resumed);
      observeMemory();
      if (canonicalHash(resumedHashes) !== canonicalHash(resultHashes))
        throw new Error('JSON checkpoint continuation hashes differ');
      modes = {
        direct,
        quick,
        fast: resultHashes,
        resumed: resumedHashes,
        checkpointAtMs: saved.state.simTimeMs,
        checkpointJsonBytes,
      };
    }
  } catch (error: unknown) {
    failure = {
      phase,
      message: error instanceof Error ? error.message : String(error),
      engineError: state?.error ?? null,
      inputHash: state?.inputHash ?? null,
      lastEvents: (state?.events.slice(-5) ?? []).map(
        ({ seq, atMs, kind }) => ({
          seq,
          atMs,
          kind,
        }),
      ),
      reproduce: `npm run test:sim:stage6 -- --seed ${seed} --minutes ${options.minutes} --batch 1${verifyModes ? ' --verify-modes' : ''}`,
    };
  }
  const after = observeMemory();
  return {
    index,
    seed,
    passed: failure === null,
    status: state?.status ?? null,
    winnerTeamId: state?.winnerTeamId ?? null,
    simulatedMs: state?.simTimeMs ?? 0,
    simulationWallMs: roundMs(simulationWallMs),
    elapsedWallMs: roundMs(performance.now() - started),
    memory: {
      heapBeforeBytes: before.heapUsed,
      heapAfterBytes: after.heapUsed,
      sampledPeakHeapBytes: peakHeap,
      rssBeforeBytes: before.rss,
      rssAfterBytes: after.rss,
      sampledPeakRssBytes: peakRss,
    },
    eventCount: state?.events.length ?? 0,
    ledgerCount: state?.ledger.length ?? 0,
    frameCount: state?.frames.length ?? 0,
    rawFrameJsonBytes,
    replayBytes,
    replayChunkCount,
    largestReplayChunkBytes,
    hashes: resultHashes,
    modes,
    failure,
  };
}

/** Synthetic fixtures only. No DB access or filesystem/network writes. */
export function runStage6Regression(
  options: Stage6Options,
  onSample?: (sample: Sample) => void,
) {
  if (typeof options.verifyModes !== 'boolean')
    throw new Error('verifyModes must be boolean');
  const verified = parseStage6Options([
    '--seed',
    String(options.seed),
    '--minutes',
    String(options.minutes),
    '--batch',
    String(options.batch),
    ...(options.verifyModes
      ? ['--verify-modes', '--verify-samples', String(options.verifySamples)]
      : []),
  ]);
  if (options.verifySamples !== verified.verifySamples)
    throw new Error('verifySamples requires verifyModes and must be 1..batch');
  const started = performance.now();
  const samples: Sample[] = [];
  for (let index = 0; index < verified.batch; index++) {
    const sample = runSample(verified, index);
    samples.push(sample);
    onSample?.(sample);
  }
  const successful = samples.filter((sample) => sample.passed);
  return {
    schemaVersion: 1,
    mode: 'NON_COMMITTING_STAGE6_REGRESSION',
    engineVersion: ENGINE_VERSION,
    options: verified,
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      architecture: process.arch,
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    passed: successful.length,
    failed: samples.length - successful.length,
    finished: samples.filter((sample) => sample.status === 'FINISHED').length,
    unfinished: samples.filter((sample) =>
      ['RUNNING', 'HORIZON_REACHED'].includes(sample.status ?? ''),
    ).length,
    verifiedModeSamples: samples.filter((sample) => sample.modes !== null)
      .length,
    elapsedWallMs: roundMs(performance.now() - started),
    measurements: {
      simulationWallMs: summarizeMeasurements(
        successful.map((s) => s.simulationWallMs),
      ),
      elapsedWallMs: summarizeMeasurements(
        successful.map((s) => s.elapsedWallMs),
      ),
      sampledPeakHeapBytes: summarizeMeasurements(
        samples.map((s) => s.memory.sampledPeakHeapBytes),
      ),
      sampledPeakRssBytes: summarizeMeasurements(
        samples.map((s) => s.memory.sampledPeakRssBytes),
      ),
      eventCount: summarizeMeasurements(successful.map((s) => s.eventCount)),
      ledgerCount: summarizeMeasurements(successful.map((s) => s.ledgerCount)),
      rawFrameJsonBytes: summarizeMeasurements(
        successful.map((s) => s.rawFrameJsonBytes!),
      ),
    },
    replayMeasurements: {
      bytes: summarizeMeasurements(successful.map((s) => s.replayBytes!)),
      chunks: summarizeMeasurements(successful.map((s) => s.replayChunkCount!)),
      largestChunkBytes: summarizeMeasurements(
        successful.map((s) => s.largestReplayChunkBytes!),
      ),
    },
    databaseWrites: 0,
    notes: [
      'All samples are sequential in one process; first sample is cold, no forced GC. Percentiles use nearest rank.',
      'simulationWallMs measures baseline runUntil calls; elapsedWallMs also includes validation, serialization and selected mode verification.',
      'Heap/RSS are process-wide samples at chunk and validation boundaries, not continuous high-water marks or per-game allocation.',
      'Direct/Quick/Fast use identical input and AUTO decisions at one call / 1 second / 30 second chunks. They do not test browser FPS or delegated coach decisions.',
      'A horizon without nexus destruction is unfinished, never a manufactured winner. Passing invariants does not imply a completed match.',
      'Raw frame JSON bytes measure serialized frames, not database row bytes. No persistence latency or hardware-independent SLA is asserted.',
    ],
    samples,
  };
}

if (require.main === module) {
  try {
    const result = runStage6Regression(
      parseStage6Options(process.argv.slice(2)),
      (sample) =>
        process.stderr.write(
          `[${sample.index + 1}] seed=${sample.seed} ${sample.passed ? 'PASS' : 'FAIL'} status=${sample.status} sim=${sample.simulationWallMs}ms events=${sample.eventCount}\n`,
        ),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed > 0) process.exitCode = 1;
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
