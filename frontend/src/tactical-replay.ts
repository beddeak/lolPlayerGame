import type { Position } from './types';

export type TacticalSide = 'BLUE' | 'RED';
type Point = { x: number; y: number };
export interface TacticalEvent {
  seq: number; atMs: number; kind: string; actorId?: string; targetId?: string;
  amount?: number; reason?: string; position?: Point; sourceId?: string;
}
export interface TacticalActorFrame {
  id: string; position: Point; hp: number; maxHp: number; level: number; gold: number;
  cs: number; active: boolean; action: string; kills: number; deaths: number;
  assists: number; goldEarned: number; damageToChampions: number; items: string[];
}
export interface TacticalFrame {
  atMs: number; eventSeq: number; actors: TacticalActorFrame[];
  units: Array<{ id: string; kind: string; side: TacticalSide | null; position: Point; hp: number; maxHp: number }>;
  teams: Array<{ teamId: number; side: TacticalSide; kills: number; goldEarned: number; objectives: number; structures: number }>;
}
export interface TacticalChunk {
  schemaVersion: 1; inputHash: string; index: number; fromMs: number; toMs: number;
  frames: TacticalFrame[]; events: TacticalEvent[];
}
export interface TacticalManifest {
  schemaVersion: 1; replayVersion: string; engineVersion: string; inputHash: string;
  durationMs: number; status: string; winnerTeamId: number | null; sampleIntervalMs: number;
  interpolation: 'STEP'; perspective: 'OMNISCIENT';
  map: { width: number; height: number; bases: Record<TacticalSide, Point>; lanes: Record<string, Point[]>; walls: Array<{ x1: number; y1: number; x2: number; y2: number }> };
  teams: Array<{ teamId: number; side: TacticalSide; code: string }>;
  actors: Array<{ actorId: string; careerPlayerId: number; teamId: number; side: TacticalSide; position: Position; championId: string; name: string }>;
  report: {
    simTimeMs: number; status: string; winnerTeamId: number | null;
    players: Array<{ actorId: string; kills: number; deaths: number; assists: number; cs: number; goldEarned: number; walletGold: number; dpm: number; kp: number; gdAt15: number | null; csdAt15: number | null }>;
  };
  chunks: Array<{ index: number; fromMs: number; toMs: number; frameCount: number; eventCount: number; bytes: number; hash: string }>;
}
export interface TacticalRun {
  matchId: number; status: 'UNAVAILABLE' | 'READY' | 'RUNNING' | 'FINISHED' | 'HORIZON_REACHED' | 'ERROR';
  engineVersion: string; simTimeMs: number; error: string | null; manifest: TacticalManifest | null;
}

export function playbackTime(value: number, durationMs: number) {
  return Math.round(Math.min(Math.max(0, durationMs), Math.max(0, Number.isFinite(value) ? value : 0)));
}

/** Presentation time only. A delayed/background callback never advances a simulation. */
export function advancePlayback(timeMs: number, elapsedMs: number, speed: number, durationMs: number) {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(200, elapsedMs)) : 0;
  const multiplier = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  return playbackTime(timeMs + elapsed * multiplier, durationMs);
}

export function replayChunkAt(manifest: TacticalManifest, timeMs: number) {
  const time = playbackTime(timeMs, manifest.durationMs);
  return manifest.chunks.findLast(chunk => chunk.fromMs <= time) ?? manifest.chunks[0];
}

/** Hold the last authoritative sample. Never draw through a wall or reveal a future state. */
export function frameAt(chunk: TacticalChunk, timeMs: number) {
  let low = 0, high = chunk.frames.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (chunk.frames[mid].atMs <= timeMs) { found = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return found >= 0 ? chunk.frames[found] : null;
}

export function eventsAt(chunk: TacticalChunk, frame: TacticalFrame) {
  return chunk.events.filter(event => event.atMs <= frame.atMs && event.seq <= frame.eventSeq);
}

export function cursorKey(careerId: number, matchId: number, manifest: TacticalManifest) {
  return `lol-manager.tactical-cursor:${careerId}:${matchId}:${manifest.engineVersion}:${manifest.inputHash}`;
}

export function readCursor(storage: Pick<Storage, 'getItem'>, key: string, durationMs: number) {
  try {
    const raw = storage.getItem(key);
    const value = raw === null ? 0 : Number(raw);
    return playbackTime(value, durationMs);
  } catch { return 0; }
}

export function writeCursor(storage: Pick<Storage, 'setItem'>, key: string, timeMs: number) {
  try { storage.setItem(key, String(Math.round(timeMs))); } catch { /* Playback also works with browser storage disabled. */ }
}

export const tacticalClock = (atMs: number) => {
  const seconds = Math.floor(Math.max(0, atMs) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};

export const tacticalMetric = (value: number | null | undefined, digits = 0) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
