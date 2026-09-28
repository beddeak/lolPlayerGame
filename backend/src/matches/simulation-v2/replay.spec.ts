import { buildReplayArchive, MAX_REPLAY_CHUNK_BYTES } from './replay';
import { createLabInput } from './test-fixtures';
import { startSimulation, runUntil } from './engine';
import { captureFrame, projectMatch } from './projection';
import { emit } from './contracts';
import { grantReward, purchaseItem } from './economy-ledger';
import { canonicalHash } from './seeded-rng';
import {
  checkpoint,
  restoreCheckpoint,
  type SimulationCheckpoint,
} from './world-state';

describe('authoritative bounded tactical replay', () => {
  it('does not reveal later rewards, KDA, purchases or events in earlier samples', () => {
    const input = createLabInput();
    input.controlMode = 'SCRIPTED';
    const state = startSimulation(input);
    runUntil(state, 0);
    const first = state.actors[0],
      target = state.actors[5];
    state.simTimeMs = 1000;
    emit(state, { kind: 'DEATH', actorId: first.id, targetId: target.id });
    emit(state, {
      kind: 'DAMAGE',
      actorId: first.id,
      targetId: target.id,
      amount: 100,
    });
    grantReward(state, {
      key: 'test:kill',
      actorId: first.id,
      sourceId: target.id,
      kind: 'KILL',
      gold: 300,
      cs: 0,
      xp: 0,
    });
    grantReward(state, {
      key: 'test:assist',
      actorId: state.actors[1].id,
      sourceId: target.id,
      kind: 'ASSIST',
      gold: 150,
      cs: 0,
      xp: 0,
    });
    purchaseItem(state, first.id, 'MODEL_BLADE');
    captureFrame(state);
    const hash = canonicalHash(state);
    const archive = buildReplayArchive(state);
    expect(canonicalHash(state)).toBe(hash);
    const [early, later] = archive.chunks.flatMap((chunk) => chunk.frames);
    expect(early.actors[0]).toMatchObject({
      kills: 0,
      goldEarned: 0,
      damageToChampions: 0,
      items: [],
    });
    expect(later.actors[0]).toMatchObject({
      kills: 1,
      goldEarned: 300,
      damageToChampions: 100,
      items: ['MODEL_BLADE'],
    });
    expect(later.actors[1].assists).toBe(1);
    expect(later.actors[5].deaths).toBe(1);
    expect(
      archive.chunks
        .flatMap((chunk) => chunk.events)
        .filter((event) => event.atMs <= early.atMs),
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'DEATH' })]),
    );
    expect(archive.manifest.report).toEqual(projectMatch(state));
    expect(archive.manifest.interpolation).toBe('STEP');
    expect(later.actors[0]).not.toHaveProperty('path');
  });

  it('bounds payloads and keeps every frame/event once with stable original IDs', () => {
    const state = startSimulation(createLabInput());
    runUntil(state, 0);
    for (let index = 1; index <= 160; index++) {
      state.simTimeMs = index * 2000;
      emit(state, {
        kind: 'PLAN',
        actorId: state.actors[0].id,
        reason: 'test'.repeat(100),
      });
      captureFrame(state);
    }
    const archive = buildReplayArchive(state);
    expect(archive.chunks.length).toBeGreaterThan(1);
    expect(
      archive.chunks
        .flatMap((chunk) => chunk.frames)
        .map((frame) => frame.atMs),
    ).toEqual(state.frames.map((frame) => frame.atMs));
    const events = archive.chunks.flatMap((chunk) => chunk.events);
    expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
    for (const descriptor of archive.manifest.chunks) {
      const chunk = archive.chunks[descriptor.index];
      expect(descriptor.bytes).toBe(Buffer.byteLength(JSON.stringify(chunk)));
      expect(descriptor.bytes).toBeLessThanOrEqual(MAX_REPLAY_CHUNK_BYTES);
      expect(descriptor.hash).toBe(canonicalHash(chunk));
      expect(chunk.events.every((event) => event.atMs <= chunk.toMs)).toBe(
        true,
      );
    }
  });

  it('includes a non-aligned terminal sample without mutating checkpoint or replay', () => {
    const state = startSimulation(createLabInput());
    runUntil(state, 5100);
    const hash = canonicalHash(state);
    const archive = buildReplayArchive(state);
    expect(archive.chunks.at(-1)!.frames.at(-1)!.atMs).toBe(5100);
    expect(canonicalHash(state)).toBe(hash);
    const restored = restoreCheckpoint(
      JSON.parse(JSON.stringify(checkpoint(state))) as SimulationCheckpoint,
    );
    expect(buildReplayArchive(restored)).toEqual(archive);
    archive.chunks[0].frames[0].actors[0].position.x = -1;
    archive.manifest.map.bases.BLUE.x = -1;
    expect(canonicalHash(state)).toBe(hash);
  });
});
