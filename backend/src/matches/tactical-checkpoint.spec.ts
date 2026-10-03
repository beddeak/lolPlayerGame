import { gunzipSync } from 'node:zlib';
import { checkpointDue, packTacticalCheckpoint } from './tactical-checkpoint';
import {
  checkpoint,
  restoreCheckpoint,
  serializeCheckpoint,
  type SimulationCheckpoint,
} from './simulation-v2/world-state';
import { createLabInput } from './simulation-v2/test-fixtures';
import { runUntil, startSimulation } from './simulation-v2/engine';
import { canonicalHash } from './simulation-v2/seeded-rng';

describe('lossless bounded tactical checkpoint cost', () => {
  it('requires both real computation time and simulated progress, independently of lease heartbeats', () => {
    expect(checkpointDue(60_000, 4_999)).toBe(false);
    expect(checkpointDue(59_999, 10_000)).toBe(false);
    expect(checkpointDue(60_000, 5_000)).toBe(true);
    expect(checkpointDue(600_000, 5_001)).toBe(true);
  });

  it('produces the same v1 snapshot without cloning, preserves decimals and resumes exactly', async () => {
    const state = startSimulation(createLabInput(123));
    runUntil(state, 60_000);
    const expected = JSON.stringify(checkpoint(state));
    expect(serializeCheckpoint(state)).toBe(expected);
    const packed = await packTacticalCheckpoint(state);
    expect(gunzipSync(packed).toString()).toBe(expected);
    const resumed = restoreCheckpoint(
      JSON.parse(expected) as SimulationCheckpoint,
    );
    runUntil(state, 120_000);
    runUntil(resumed, 120_000);
    expect(canonicalHash(resumed)).toBe(canonicalHash(state));
    const corrupt = JSON.parse(expected) as SimulationCheckpoint;
    corrupt.state.actors[0].hp += 0.0000001;
    expect(() => restoreCheckpoint(corrupt)).toThrow(/Corrupt/);
  });

  it('still rejects non-finite state instead of silently serializing it as null', () => {
    const state = startSimulation(createLabInput());
    state.actors[0].hp = NaN;
    expect(() => serializeCheckpoint(state)).toThrow(/non-finite/);
  });
});
