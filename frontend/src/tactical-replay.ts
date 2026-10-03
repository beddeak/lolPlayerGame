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

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string';
const natural = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const point = (value: unknown) => record(value) && finite(value.x) && finite(value.y);
const numbers = (value: Record<string, unknown>, keys: string[]) => keys.every(key => finite(value[key]));
const optionalText = (value: unknown) => value === undefined || text(value);
const side = (value: unknown) => value === 'BLUE' || value === 'RED';

/** Validate playback/rendering essentials at the network boundary, before React sees them.
 * The server still owns archive hash verification; this is not a second simulation validator.
 */
export function parseTacticalRun(value: unknown, matchId: number): TacticalRun {
  if (!record(value) || value.matchId !== matchId)
    throw new Error('다른 경기의 기록이 반환되었습니다.');
  if (!['UNAVAILABLE', 'READY', 'RUNNING', 'FINISHED', 'HORIZON_REACHED', 'ERROR'].includes(String(value.status))
    || !finite(value.simTimeMs) || value.simTimeMs < 0 || !(value.error === null || text(value.error)))
    throw new Error('경기 기록 형식이 올바르지 않습니다. 다시 불러오세요.');
  const manifest = value.manifest;
  if (manifest === null) return value as unknown as TacticalRun;
  if (!record(manifest) || manifest.schemaVersion !== 1 || manifest.replayVersion !== 'tactical-replay-1' || manifest.interpolation !== 'STEP')
    throw new Error('지원하지 않는 리플레이 버전입니다. 경기 결과는 보존되어 있습니다.');
  function invalid(): never { throw new Error('리플레이 정보가 손상되었거나 호환되지 않습니다. 다시 불러오세요.'); }
  if (!text(manifest.inputHash) || !text(manifest.engineVersion)
    || !finite(manifest.durationMs) || manifest.durationMs < 0
    || !finite(manifest.sampleIntervalMs) || manifest.sampleIntervalMs <= 0) invalid();
  const map = manifest.map;
  if (!record(map) || !finite(map.width) || map.width <= 0 || !finite(map.height) || map.height <= 0
    || !record(map.lanes) || !Object.values(map.lanes).every(lane => Array.isArray(lane) && lane.every(point))
    || !Array.isArray(map.walls) || !map.walls.every(wall => record(wall) && numbers(wall, ['x1', 'y1', 'x2', 'y2']))) invalid();
  if (!Array.isArray(manifest.teams) || manifest.teams.length !== 2
    || !manifest.teams.every(team => record(team) && natural(team.teamId) && side(team.side) && text(team.code))) invalid();
  if (!Array.isArray(manifest.actors) || !manifest.actors.length
    || !manifest.actors.every(actor => record(actor) && text(actor.actorId) && text(actor.name) && text(actor.position)
      && text(actor.championId) && natural(actor.teamId) && side(actor.side))) invalid();
  const report = manifest.report;
  if (!record(report) || !Array.isArray(report.players) || !report.players.every(player => record(player)
    && text(player.actorId) && numbers(player, ['kills', 'deaths', 'assists', 'cs']))) invalid();
  if (!Array.isArray(manifest.chunks) || !manifest.chunks.length) invalid();
  const chunks = manifest.chunks;
  let previousTo = -1;
  for (const [index, chunk] of chunks.entries()) {
    if (!record(chunk) || chunk.index !== index || !finite(chunk.fromMs) || !finite(chunk.toMs)
      || chunk.fromMs <= previousTo || chunk.fromMs > chunk.toMs || chunk.toMs > manifest.durationMs
      || (index === 0 && chunk.fromMs !== 0) || !natural(chunk.frameCount) || chunk.frameCount === 0
      || !natural(chunk.eventCount) || !text(chunk.hash)) invalid();
    previousTo = chunk.toMs;
  }
  if (previousTo !== manifest.durationMs) invalid();
  return value as unknown as TacticalRun;
}

export function parseTacticalChunk(value: unknown, manifest: TacticalManifest, descriptor: TacticalManifest['chunks'][number]): TacticalChunk {
  if (!record(value) || value.schemaVersion !== 1 || value.inputHash !== manifest.inputHash || value.index !== descriptor.index)
    throw new Error('다른 경기의 리플레이 구간이 반환되었습니다.');
  function invalid(): never { throw new Error('리플레이 구간이 손상되었거나 호환되지 않습니다. 구간을 다시 불러오세요.'); }
  if (value.fromMs !== descriptor.fromMs || value.toMs !== descriptor.toMs
    || !Array.isArray(value.frames) || value.frames.length !== descriptor.frameCount || !value.frames.length
    || !Array.isArray(value.events) || value.events.length !== descriptor.eventCount) invalid();
  const frames: unknown[] = value.frames;
  let previousTime = -1, previousSequence = -1;
  for (const entry of frames) {
    if (!record(entry) || !finite(entry.atMs) || entry.atMs <= previousTime || entry.atMs < descriptor.fromMs || entry.atMs > descriptor.toMs
      || !natural(entry.eventSeq) || entry.eventSeq < previousSequence
      || !Array.isArray(entry.actors) || !entry.actors.every(actor => record(actor) && text(actor.id) && point(actor.position)
        && typeof actor.active === 'boolean' && text(actor.action)
        && numbers(actor, ['hp', 'maxHp', 'level', 'gold', 'cs', 'kills', 'deaths', 'assists', 'goldEarned']))
      || !Array.isArray(entry.units) || !entry.units.every(unit => record(unit) && text(unit.id) && text(unit.kind)
        && (unit.side === null || side(unit.side)) && point(unit.position) && numbers(unit, ['hp', 'maxHp']))
      || !Array.isArray(entry.teams) || !entry.teams.every(team => record(team) && natural(team.teamId) && finite(team.kills))) invalid();
    previousTime = entry.atMs;
    previousSequence = entry.eventSeq;
  }
  if ((frames[0] as Record<string, unknown>).atMs !== descriptor.fromMs || previousTime !== descriptor.toMs) invalid();
  let previousEvent = -1;
  for (const event of value.events) {
    if (!record(event) || !natural(event.seq) || event.seq <= previousEvent || !finite(event.atMs) || event.atMs < 0
      || event.atMs > descriptor.toMs || !text(event.kind) || !optionalText(event.actorId)
      || !optionalText(event.targetId) || !optionalText(event.reason)) invalid();
    previousEvent = event.seq;
  }
  return value as unknown as TacticalChunk;
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
