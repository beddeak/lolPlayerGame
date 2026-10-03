import { gzip } from 'node:zlib';
import type { EngineState } from './simulation-v2/contracts';
import { serializeCheckpoint } from './simulation-v2/world-state';

/** Durability cadence, never an engine clock or gameplay decision. Fast machines
 * need not repeatedly copy a growing ledger several times per real second.
 * Worst-case recomputation is ~5s plus one engine slice/serialization/DB write. */
export function checkpointDue(
  simulatedSinceSaveMs: number,
  elapsedSinceSaveMs: number,
): boolean {
  return simulatedSinceSaveMs >= 60_000 && elapsedSinceSaveMs >= 5_000;
}

export function packTacticalCheckpoint(state: EngineState): Promise<Buffer> {
  const json = serializeCheckpoint(state);
  return new Promise((resolve, reject) => {
    gzip(json, { level: 1 }, (error, data) =>
      error ? reject(error) : resolve(data),
    );
  });
}
