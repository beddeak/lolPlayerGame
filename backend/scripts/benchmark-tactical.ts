import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { createBattleRuleset } from '../src/matches/simulation-v2/battle-rules';
import { CURRENT_MACRO_AI } from '../src/matches/simulation-v2/contracts';
import { runUntil, startSimulation } from '../src/matches/simulation-v2/engine';
import { buildReplayArchive } from '../src/matches/simulation-v2/replay';
import { canonicalHash } from '../src/matches/simulation-v2/seeded-rng';
import { createLabInput } from '../src/matches/simulation-v2/test-fixtures';
import { checkpoint } from '../src/matches/simulation-v2/world-state';
import {
  checkpointDue,
  packTacticalCheckpoint,
} from '../src/matches/tactical-checkpoint';
import { verifyBattleState } from './run-battle-lab';

/** No DB writes. Includes the production checkpoint cadence, not just engine time. */
async function main() {
  const seed = Number(process.argv[2] ?? 123);
  const minutes = Number(process.argv[3] ?? 60);
  const flags = process.argv.slice(4);
  if (
    new Set(flags).size !== flags.length ||
    flags.some(
      (flag) => !['--legacy-checkpoints', '--coordinated'].includes(flag),
    )
  )
    throw new Error('Unknown or repeated benchmark flag');
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 60
  )
    throw new Error(
      'Usage: ts-node scripts/benchmark-tactical.ts [seed] [minutes 1..60]',
    );
  const input = createLabInput(seed);
  input.rules = createBattleRuleset();
  if (process.argv.includes('--coordinated'))
    input.rules.macroAi = CURRENT_MACRO_AI;
  const state = startSimulation(input);
  const started = performance.now();
  let simulationMs = 0;
  let checkpointMs = 0;
  let checkpoints = 0;
  let checkpointBytes = 0;
  let savedAtSimMs = 0;
  let savedAtWallMs = performance.now();
  const compress = promisify(gzip);
  while (state.status === 'RUNNING' && state.simTimeMs < minutes * 60_000) {
    let at = performance.now();
    runUntil(state, Math.min(state.simTimeMs + 60_000, minutes * 60_000));
    simulationMs += performance.now() - at;
    if (
      state.status === 'RUNNING' &&
      (process.argv.includes('--legacy-checkpoints') ||
        checkpointDue(
          state.simTimeMs - savedAtSimMs,
          performance.now() - savedAtWallMs,
        ))
    ) {
      at = performance.now();
      const packed = process.argv.includes('--legacy-checkpoints')
        ? await compress(Buffer.from(JSON.stringify(checkpoint(state))))
        : await packTacticalCheckpoint(state);
      checkpointMs += performance.now() - at;
      checkpointBytes += packed.length;
      checkpoints++;
      savedAtSimMs = state.simTimeMs;
      savedAtWallMs = performance.now();
    }
    if (state.simTimeMs % 600_000 === 0)
      console.log(
        JSON.stringify({
          progressMinutes: state.simTimeMs / 60_000,
          simulationMs: Math.round(simulationMs),
          checkpointMs: Math.round(checkpointMs),
        }),
      );
  }
  const replayAt = performance.now();
  const archive = buildReplayArchive(state);
  const replayMs = performance.now() - replayAt;
  const measuredMs = performance.now() - started;
  verifyBattleState(state);
  console.log(
    JSON.stringify({
      seed,
      status: state.status,
      simTimeMs: state.simTimeMs,
      winnerTeamId: state.winnerTeamId,
      simulationMs,
      checkpointMs,
      checkpoints,
      checkpointBytes,
      replayMs,
      measuredMs,
      chunks: archive.chunks.length,
      stateHash: canonicalHash(state),
      eventsHash: canonicalHash(state.events),
      reportHash: canonicalHash(archive.manifest.report),
    }),
  );
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
