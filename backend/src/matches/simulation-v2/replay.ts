import type { EngineState, ReplayFrame, Side, SimEvent } from './contracts';
import { projectFrame, projectMatch } from './projection';
import { canonicalHash } from './seeded-rng';

export const REPLAY_VERSION = 'tactical-replay-1';
export const MAX_REPLAY_CHUNK_BYTES = 256 * 1024;

export interface ReplayActorScore {
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  damageToChampions: number;
  items: string[];
}

export interface TacticalReplayFrame {
  atMs: number;
  eventSeq: number;
  actors: Array<
    Omit<ReplayFrame['actors'][number], 'path' | 'moveSpeed'> & ReplayActorScore
  >;
  units: Array<Omit<ReplayFrame['units'][number], 'path' | 'moveSpeed'>>;
  teams: Array<{
    teamId: number;
    side: Side;
    kills: number;
    goldEarned: number;
    objectives: number;
    structures: number;
  }>;
}

export interface TacticalReplayChunk {
  schemaVersion: 1;
  inputHash: string;
  index: number;
  fromMs: number;
  toMs: number;
  frames: TacticalReplayFrame[];
  events: SimEvent[];
}

export interface ReplayChunkDescriptor {
  index: number;
  fromMs: number;
  toMs: number;
  frameCount: number;
  eventCount: number;
  bytes: number;
  hash: string;
}

export interface TacticalReplayManifest {
  schemaVersion: 1;
  replayVersion: typeof REPLAY_VERSION;
  engineVersion: string;
  inputHash: string;
  durationMs: number;
  status: EngineState['status'];
  winnerTeamId: number | null;
  sampleIntervalMs: number;
  interpolation: 'STEP';
  perspective: 'OMNISCIENT';
  map: EngineState['input']['map'];
  teams: Array<{ teamId: number; side: Side; code: string }>;
  actors: Array<{
    actorId: string;
    careerPlayerId: number;
    teamId: number;
    side: Side;
    position: EngineState['input']['actors'][number]['position'];
    championId: string;
    name: string;
  }>;
  report: ReturnType<typeof projectMatch>;
  chunks: ReplayChunkDescriptor[];
}

const materialEvents = new Set<SimEvent['kind']>([
  'PLAN',
  'DEATH',
  'RESPAWN',
  'RECALL_START',
  'RECALL_CANCEL',
  'RECALL_COMPLETE',
  'PURCHASE',
  'LEVEL_UP',
  'OBJECTIVE_AVAILABLE',
  'OBJECTIVE_RESET',
  'OBJECTIVE_CAPTURED',
  'OBJECTIVE_DESPAWN',
  'STRUCTURE_DESTROYED',
  'NEXUS_DESTROYED',
  'WARD_PLACED',
  'QUEST_COMPLETE',
  'BUFF',
  'BUFF_EXPIRE',
]);
const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** A read-only, bounded browser projection. The snapshot clock governs all HUD data.
 * Sparse paths cannot prove what happened between samples; interpolation is STEP.
 * Sequence IDs are original ledger IDs, even when internal events are omitted.
 */
export function buildReplayArchive(state: EngineState): {
  manifest: TacticalReplayManifest;
  chunks: TacticalReplayChunk[];
} {
  const actors = new Map(
    state.input.actors.map((actor) => [actor.actorId, actor]),
  );
  const scores = new Map<string, ReplayActorScore>(
    state.input.actors.map((actor) => [
      actor.actorId,
      {
        kills: 0,
        deaths: 0,
        assists: 0,
        goldEarned: 0,
        damageToChampions: 0,
        items: [],
      },
    ]),
  );
  const objectives: Record<Side, number> = { BLUE: 0, RED: 0 };
  const structures: Record<Side, number> = { BLUE: 0, RED: 0 };
  const chunks: TacticalReplayChunk[] = [];
  const descriptors: ReplayChunkDescriptor[] = [];
  let eventIndex = 0;
  let ledgerIndex = 0;
  let current: TacticalReplayChunk | null = null;
  let currentBytes = 0;
  const finishChunk = () => {
    if (!current) return;
    const bytes = byteLength(current);
    if (bytes > MAX_REPLAY_CHUNK_BYTES)
      throw new Error('Replay chunk exceeded byte limit');
    chunks.push(current);
    descriptors.push({
      index: current.index,
      fromMs: current.fromMs,
      toMs: current.toMs,
      frameCount: current.frames.length,
      eventCount: current.events.length,
      bytes,
      hash: canonicalHash(current),
    });
    current = null;
  };
  const samples = state.frames.slice();
  if (samples.at(-1)?.atMs !== state.simTimeMs)
    samples.push(projectFrame(state));
  let previousMs = -1;
  for (const sample of samples) {
    if (sample.atMs <= previousMs || sample.atMs > state.simTimeMs)
      throw new Error('Replay frames must have unique increasing timestamps');
    previousMs = sample.atMs;
    const events: SimEvent[] = [];
    while (state.events[eventIndex]?.atMs <= sample.atMs) {
      const event = state.events[eventIndex++];
      const actor = actors.get(event.actorId ?? '');
      const target = actors.get(event.targetId ?? '');
      if (event.kind === 'DEATH' && target) {
        scores.get(target.actorId)!.deaths++;
        if (actor && actor.side !== target.side)
          scores.get(actor.actorId)!.kills++;
      }
      if (
        event.kind === 'DAMAGE' &&
        actor &&
        target &&
        actor.side !== target.side
      )
        scores.get(actor.actorId)!.damageToChampions += event.amount ?? 0;
      if (event.kind === 'OBJECTIVE_CAPTURED' && actor)
        objectives[actor.side]++;
      if (event.kind === 'STRUCTURE_DESTROYED') {
        const unit = state.units.find((unit) => unit.id === event.targetId);
        if (unit?.side) structures[unit.side === 'BLUE' ? 'RED' : 'BLUE']++;
      }
      if (materialEvents.has(event.kind) && (event.kind !== 'DEATH' || target))
        events.push(structuredClone(event));
    }
    while (state.ledger[ledgerIndex]?.atMs <= sample.atMs) {
      const entry = state.ledger[ledgerIndex++];
      const score = scores.get(entry.actorId);
      if (!score) throw new Error('Replay ledger references unknown actor');
      if (entry.kind === 'ASSIST') score.assists++;
      if (entry.kind === 'PURCHASE') score.items.push(entry.sourceId);
      else if (entry.kind !== 'STARTING') score.goldEarned += entry.gold;
    }
    const frame: TacticalReplayFrame = {
      atMs: sample.atMs,
      eventSeq: state.events[eventIndex - 1]?.seq ?? 0,
      actors: sample.actors.map(({ path, moveSpeed, ...actor }) => {
        void path;
        void moveSpeed;
        return {
          ...structuredClone(actor),
          ...structuredClone(scores.get(actor.id)!),
        };
      }),
      units: sample.units.map(({ path, moveSpeed, ...unit }) => {
        void path;
        void moveSpeed;
        return structuredClone(unit);
      }),
      teams: state.input.teams.map((team) => {
        const own = state.input.actors.filter(
          (actor) => actor.side === team.side,
        );
        return {
          teamId: team.teamId,
          side: team.side,
          kills: own.reduce(
            (sum, actor) => sum + scores.get(actor.actorId)!.kills,
            0,
          ),
          goldEarned: own.reduce(
            (sum, actor) => sum + scores.get(actor.actorId)!.goldEarned,
            0,
          ),
          objectives: objectives[team.side],
          structures: structures[team.side],
        };
      }),
    };
    // Leave room for envelope, array separators and growing integer timestamps.
    const sampleBytes =
      byteLength(frame) +
      events.reduce((sum, event) => sum + byteLength(event) + 1, 0) +
      2;
    if (sampleBytes + 1024 > MAX_REPLAY_CHUNK_BYTES)
      throw new Error(`Replay sample at ${sample.atMs} exceeds byte limit`);
    if (current && currentBytes + sampleBytes + 1024 > MAX_REPLAY_CHUNK_BYTES)
      finishChunk();
    if (!current) {
      current = {
        schemaVersion: 1,
        inputHash: state.inputHash,
        index: chunks.length,
        fromMs: sample.atMs,
        toMs: sample.atMs,
        frames: [],
        events: [],
      };
      currentBytes = 0;
    }
    current.frames.push(frame);
    current.events.push(...events);
    current.toMs = sample.atMs;
    currentBytes += sampleBytes;
  }
  finishChunk();
  return {
    manifest: {
      schemaVersion: 1,
      replayVersion: REPLAY_VERSION,
      engineVersion: state.input.engineVersion,
      inputHash: state.inputHash,
      durationMs: state.simTimeMs,
      status: state.status,
      winnerTeamId: state.winnerTeamId,
      sampleIntervalMs: state.input.rules.snapshotIntervalMs,
      interpolation: 'STEP',
      perspective: 'OMNISCIENT',
      map: structuredClone(state.input.map),
      teams: state.input.teams.map((team) => ({
        teamId: team.teamId,
        side: team.side,
        code: team.sourceTeam?.teamCode ?? String(team.teamId),
      })),
      actors: state.input.actors.map((actor) => ({
        actorId: actor.actorId,
        careerPlayerId: actor.careerPlayerId,
        teamId: actor.teamId,
        side: actor.side,
        position: actor.position,
        championId: actor.championId,
        name: `${actor.position} #${actor.careerPlayerId}`,
      })),
      report: projectMatch(state),
      chunks: descriptors,
    },
    chunks,
  };
}
