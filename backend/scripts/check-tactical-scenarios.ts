import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { startSimulation, runUntil } from '../src/matches/simulation-v2/engine';
import { createLabInput } from '../src/matches/simulation-v2/test-fixtures';
import { verifyLabState } from './run-tactical-lab';

const SCENARIOS = [
  { seed: 1003, actorIndex: 0, startAtMs: 420_000 },
  { seed: 1027, actorIndex: 5, startAtMs: 420_000 },
  { seed: 1034, actorIndex: 2, startAtMs: 360_000 },
] as const;
const END_AT_MS = 600_000;

/** Normal AUTO runs: no injected world state, database, network or file writes. */
export function checkTacticalScenarios() {
  const scenarios = SCENARIOS.map(({ seed, actorIndex, startAtMs }) => {
    const started = performance.now();
    const state = startSimulation(createLabInput(seed));
    runUntil(state, startAtMs);
    const actor = state.actors[actorIndex];
    const beforeCs = actor.stats.cs;
    runUntil(state, END_AT_MS);

    assert.ok(
      actor.stats.cs > beforeCs + 2,
      `Seed ${seed}: ${actor.id} did not resume farming (${beforeCs} -> ${actor.stats.cs})`,
    );
    const ledgerCs = state.ledger
      .filter((entry) => entry.actorId === actor.id)
      .reduce((total, entry) => total + entry.cs, 0);
    assert.equal(ledgerCs, actor.stats.cs, `Seed ${seed}: CS ledger mismatch`);
    assert.ok(
      state.events.some(
        (event) =>
          event.actorId === actor.id &&
          event.kind === 'MOVE' &&
          /wave/.test(event.reason ?? ''),
      ),
      `Seed ${seed}: no observed-wave approach or escort`,
    );
    // Includes exact horizon/status, deaths/kill events, independent ledger
    // projection, reward uniqueness, actor counters, wallet and finite values.
    verifyLabState(state, END_AT_MS);

    return {
      seed,
      actorId: actor.id,
      startAtMs,
      endAtMs: state.simTimeMs,
      beforeCs,
      afterCs: actor.stats.cs,
      ledgerCs,
      status: state.status,
      invariantsPassed: true,
      elapsedMs: Math.round(performance.now() - started),
    };
  });
  return { passed: true, scenarios };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(checkTacticalScenarios())}\n`);
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({ passed: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  }
}
