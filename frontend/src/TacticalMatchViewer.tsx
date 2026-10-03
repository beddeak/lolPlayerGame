import { useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import { advancePlayback, cursorKey, eventsAt, frameAt, parseTacticalChunk, parseTacticalRun, playbackTime, readCursor, replayChunkAt, tacticalClock, tacticalMetric, writeCursor, type TacticalChunk, type TacticalEvent, type TacticalManifest, type TacticalRun } from './tactical-replay';
import './MatchSpectator.css';
import './TacticalMatchViewer.css';

const labels: Record<string, string> = {
  DEATH: '처치', RESPAWN: '부활', RECALL_START: '귀환 시작', RECALL_CANCEL: '귀환 취소',
  RECALL_COMPLETE: '귀환 완료', PURCHASE: '아이템 구매', OBJECTIVE_KILL: '오브젝트 처치',
  OBJECTIVE_SPAWN: '오브젝트 등장', OBJECTIVE_DESPAWN: '오브젝트 퇴장', STRUCTURE_DESTROYED: '구조물 파괴',
  NEXUS_DESTROYED: '넥서스 파괴', QUEST_COMPLETE: '역할 퀘스트 완료', WARD_PLACED: '와드 설치',
  OBJECTIVE_CAPTURED: '오브젝트 획득', OBJECTIVE_AVAILABLE: '오브젝트 등장', OBJECTIVE_RESET: '오브젝트 초기화',
  PLAN: '행동 계획', LEVEL_UP: '레벨 상승', BUFF: '버프 획득', BUFF_EXPIRE: '버프 종료',
};
const actions: Record<string, string> = { IDLE: '대기', MOVE: '이동', ATTACK: '공격', RECALL: '귀환', DEAD: '사망', CAST: '시전' };
const sideColor = (side: string | null) => side === 'BLUE' ? '#8dd5ff' : side === 'RED' ? '#ffa0b1' : '#e8d290';

function eventText(event: TacticalEvent, manifest: TacticalManifest) {
  const name = (id?: string) => id ? manifest.actors.find(actor => actor.actorId === id)?.name ?? id : '';
  return [labels[event.kind] ?? event.kind, name(event.actorId), event.targetId ? `→ ${name(event.targetId)}` : ''].filter(Boolean).join(' · ');
}

export default function TacticalMatchViewer({ careerId, matchId, token, onClose }: {
  careerId: number; matchId: number; token: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const [run, setRun] = useState<TacticalRun | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(8);
  const [chunk, setChunk] = useState<TacticalChunk | null>(null);
  const [chunkError, setChunkError] = useState('');
  const [chunkRetry, setChunkRetry] = useState(0);
  const chunks = useRef(new Map<string, TacticalChunk>());
  const cursor = useRef({ key: '', time: 0 });
  const restored = useRef('');
  const path = `/matches/${matchId}/tactical-run`;
  const manifest = run?.manifest ?? null;
  const descriptor = manifest ? replayChunkAt(manifest, time) : undefined;
  const expectedChunk = manifest && descriptor ? `${manifest.inputHash}:${descriptor.index}:${descriptor.hash}` : '';
  const [loadedChunk, setLoadedChunk] = useState('');
  const frame = chunk && expectedChunk === loadedChunk ? frameAt(chunk, time) : null;
  const hasFrame = !!frame;
  const durationMs = manifest?.durationMs ?? null;
  const ended = !!manifest && time >= manifest.durationMs;
  const finalFrame = !!manifest && !!frame && ended && frame.atMs === manifest.durationMs;
  function persistCursor() {
    try { if (cursor.current.key) writeCursor(window.sessionStorage, cursor.current.key, cursor.current.time); } catch { /* Storage may be disabled. */ }
  }

  async function refresh() {
    if (busyRef.current || !alive.current) return;
    busyRef.current = true;
    setBusy(true); setError('');
    try {
      const value = parseTacticalRun(await apiRequest<unknown>(path, { token }), matchId);
      if (alive.current) setRun(value);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '경기 기록을 불러오지 못했습니다.');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    const node = dialog.current, overflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = 'hidden';
    const visibility = () => setHidden(document.hidden);
    const persist = persistCursor;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', persist);
    void refresh();
    return () => {
      alive.current = false; persist(); node?.close(); document.body.style.overflow = overflow;
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', persist);
    };
    // The parent keys a viewer by account, career and match. Playback never invokes POST.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (run?.status !== 'RUNNING' || hidden) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, hidden]);

  useEffect(() => {
    if (!manifest) return;
    const key = cursorKey(careerId, matchId, manifest);
    if (restored.current === key) return;
    restored.current = key;
    try { setTime(readCursor(window.sessionStorage, key, manifest.durationMs)); } catch { setTime(0); }
    setPlaying(false);
  }, [careerId, matchId, manifest]);

  useEffect(() => {
    if (!manifest) return;
    cursor.current = { key: cursorKey(careerId, matchId, manifest), time };
  }, [careerId, matchId, manifest, time]);

  useEffect(() => {
    const timer = window.setInterval(persistCursor, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!manifest || !descriptor) return;
    let current = true;
    setChunkError('');
    const cached = chunks.current.get(expectedChunk);
    if (cached) { setChunk(cached); setLoadedChunk(expectedChunk); return; }
    void apiRequest<unknown>(`${path}/chunks/${descriptor.index}`, { token }).then(payload => {
      if (!current || !alive.current) return;
      const value = parseTacticalChunk(payload, manifest, descriptor);
      chunks.current.set(expectedChunk, value);
      while (chunks.current.size > 3) chunks.current.delete(chunks.current.keys().next().value!);
      setChunk(value); setLoadedChunk(expectedChunk);
    }).catch(reason => {
      if (current && alive.current) setChunkError(reason instanceof Error ? reason.message : '리플레이 구간을 불러오지 못했습니다.');
    });
    return () => { current = false; };
  }, [expectedChunk, chunkRetry, path, token, manifest, descriptor]);

  useEffect(() => {
    if (!playing || hidden || ended || !hasFrame || durationMs === null) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(), elapsed = now - last; last = now;
      setTime(value => advancePlayback(value, elapsed, speed, durationMs));
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, hidden, ended, hasFrame, speed, durationMs]);

  const recent = frame && chunk ? eventsAt(chunk, frame).slice(-8).reverse() : [];
  const winner = finalFrame && run?.status === 'FINISHED'
    ? manifest?.teams.find(team => team.teamId === manifest.winnerTeamId) : undefined;

  return <dialog ref={dialog} className="rift-dialog tactical-dialog" aria-label="실제 경기 기록 관전" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="rift-header"><div><span className="rift-eyebrow">TACTICAL REPLAY</span><h2>경기 기록 관전</h2></div>
      <div className="rift-header-actions"><span className="rift-status">{hidden ? '다른 탭 · 일시정지' : playing && !ended ? '재생 중' : '일시정지'}</span><button type="button" onClick={onClose}>닫기</button></div></header>
    <div className="tactical-notice"><p>서버에 저장된 실제 상태 · 전지적 관전</p>
      {error && <p role="alert">{error}</p>}
      {!run && <p role="status">{busy ? '저장된 경기 정보를 불러오는 중…' : '경기 기록을 다시 불러오세요.'}</p>}
      {run?.status === 'UNAVAILABLE' && <p>이 경기는 새 엔진의 입력 기록이 없어 실제 상태 리플레이를 제공하지 않습니다.</p>}
      {run?.status === 'READY' && <p>경기 결과를 기다리고 있습니다. 결과 저장 후 다시 불러오세요.</p>}
      {run?.status === 'RUNNING' && <p role="status">서버에서 경기 계산 중 · 저장 시점 {tacticalClock(run.simTimeMs)}</p>}
      {(run?.status === 'HORIZON_REACHED' || run?.status === 'ERROR') && <p role="status">{run.status === 'HORIZON_REACHED' ? '제한 시간 도달 · 미완료 경기' : '계산 오류 · 경기 미완료'}{run.error ? ` · ${run.error}` : ''}</p>}
      <button type="button" disabled={busy} onClick={() => void refresh()}>서버 기록 새로고침</button>
    </div>
    {manifest && <>
      <div className="rift-scoreboard">{manifest.teams.map((team, index) => <div key={team.teamId} data-side={index}><span>{team.side}</span><strong>{team.code}</strong><b>{frame?.teams.find(value => value.teamId === team.teamId)?.kills ?? '—'}</b></div>)}<div className="rift-score-clock"><strong>{tacticalClock(time)}</strong><span>{speed}×</span></div></div>
      <div className="tactical-time"><span>재생 {tacticalClock(time)}</span><span>표시 상태 {frame ? tacticalClock(frame.atMs) : '불러오는 중'}</span><span>스냅샷 간격 {manifest.sampleIntervalMs / 1000}초</span></div>
      {chunkError && <p className="tactical-notice" role="alert">{chunkError} <button type="button" onClick={() => setChunkRetry(value => value + 1)}>구간 다시 불러오기</button></p>}
      {!frame && !chunkError && <p className="tactical-notice" role="status">리플레이 구간을 불러오는 중…</p>}
      {frame && <div className="tactical-content">
        <section className="rift-stage" aria-label="실제 경기 지도"><div className="rift-map-wrap">
          <svg className="rift-map" viewBox={`0 0 ${manifest.map.width} ${manifest.map.height}`} role="img" aria-label="저장된 위치와 체력">
            <rect width={manifest.map.width} height={manifest.map.height} fill="#0b2228" />
            {Object.entries(manifest.map.lanes).map(([lane, points]) => <polyline key={lane} points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#456563" strokeWidth={manifest.map.width / 40} strokeLinejoin="round" />)}
            {manifest.map.walls.map((wall, index) => <rect key={index} x={Math.min(wall.x1, wall.x2)} y={Math.min(wall.y1, wall.y2)} width={Math.abs(wall.x2 - wall.x1)} height={Math.abs(wall.y2 - wall.y1)} fill="#233c35" stroke="#6b8874" strokeWidth={manifest.map.width / 500} />)}
            {frame.units.map(unit => <g key={unit.id} transform={`translate(${unit.position.x} ${unit.position.y})`}><circle r={unit.kind === 'MINION' ? manifest.map.width / 250 : manifest.map.width / 95} fill={sideColor(unit.side)} opacity=".65" /><title>{`${unit.id} · HP ${tacticalMetric(unit.hp)} / ${tacticalMetric(unit.maxHp)}`}</title></g>)}
            {frame.actors.map(actor => {
              const identity = manifest.actors.find(value => value.actorId === actor.id);
              const radius = manifest.map.width / 65;
              return <g key={actor.id} data-actor={actor.id} data-alive={actor.active} transform={`translate(${actor.position.x} ${actor.position.y})`} opacity={actor.active ? 1 : .35}>
                <circle r={radius} fill="#112435" stroke={sideColor(identity?.side ?? null)} strokeWidth={radius / 5} />
                <text textAnchor="middle" y={radius / 3} fontSize={radius * .7} fill="#fff">{identity?.position.slice(0, 3)}</text>
                <rect x={-radius} y={-radius * 1.6} width={radius * 2} height={radius / 4} fill="#10131b" />
                <rect x={-radius} y={-radius * 1.6} width={radius * 2 * Math.max(0, Math.min(1, actor.hp / Math.max(1, actor.maxHp)))} height={radius / 4} fill={sideColor(identity?.side ?? null)} />
                <title>{`${identity?.name} · ${actor.active ? actions[actor.action] ?? actor.action : '사망'} · HP ${tacticalMetric(actor.hp)} / ${tacticalMetric(actor.maxHp)}`}</title>
              </g>;
            })}
          </svg>
        </div></section>
        <section className="tactical-rosters" aria-label="같은 시점의 선수 상태">{manifest.teams.map(team => <div key={team.teamId}><h3>{team.code}</h3>{manifest.actors.filter(actor => actor.teamId === team.teamId).map(identity => {
          const actor = frame.actors.find(value => value.id === identity.actorId);
          return actor && <article key={actor.id} className="tactical-actor" data-side={identity.side}>
            <strong>{identity.name} <small>{identity.position} · {identity.championId}</small></strong>
            <span>{actor.kills} / {actor.deaths} / {actor.assists} · Lv.{actor.level} · CS {actor.cs}</span>
            <span>HP {tacticalMetric(actor.hp)} / {tacticalMetric(actor.maxHp)} · 보유 골드 {tacticalMetric(actor.gold)}</span>
            <small>{actor.active ? actions[actor.action] ?? actor.action : '사망'} · 획득 골드 {tacticalMetric(actor.goldEarned)}</small>
          </article>;
        })}</div>)}</section>
      </div>}
      <section className="tactical-events" aria-label="같은 시점의 사건 기록">{recent.length ? recent.map(event => <p key={event.seq}><time>{tacticalClock(event.atMs)}</time> {eventText(event, manifest)} <small>#{event.seq}{event.reason ? ` · ${event.reason}` : ''}</small></p>) : <p>이 구간에서 표시 시점까지 발생한 핵심 사건이 없습니다.</p>}</section>
      {finalFrame && <section className="tactical-report" aria-label="실제 경기 통계"><h3>{winner ? `${winner.code} 승리` : '미완료 경기 · 도달 시점 통계'}</h3><div className="set-table-scroll"><table><thead><tr>{['선수', 'K / D / A', 'CS', '획득 골드', 'DPM', 'KP', 'GD@15', 'CSD@15'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{manifest.report.players.map(player => <tr key={player.actorId}><th scope="row">{manifest.actors.find(actor => actor.actorId === player.actorId)?.name ?? player.actorId}</th><td>{player.kills} / {player.deaths} / {player.assists}</td><td>{player.cs}</td><td>{tacticalMetric(player.goldEarned)}</td><td>{tacticalMetric(player.dpm)}</td><td>{tacticalMetric(player.kp, 1)}%</td><td>{tacticalMetric(player.gdAt15)}</td><td>{tacticalMetric(player.csdAt15)}</td></tr>)}</tbody></table></div><p>DPM은 적 챔피언의 실제 HP 손실 기준입니다. 15분 전에 끝난 지표는 —로 표시합니다.</p></section>}
      <footer className="rift-controls"><div className="rift-playback"><button type="button" disabled={ended || (!frame && !playing)} onClick={() => setPlaying(value => !value)}>{playing && !ended ? '일시정지' : '재생'}</button><button type="button" onClick={() => { setTime(0); setPlaying(false); }}>처음부터</button><button type="button" onClick={() => { setTime(manifest.durationMs); setPlaying(false); }}>도달 시점 통계</button><div role="group" aria-label="관전 배속">{[1, 8, 16, 32].map(value => <button type="button" key={value} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}</div></div>
        <label className="rift-seek"><span>{tacticalClock(time)}</span><input type="range" min="0" max={manifest.durationMs} step="100" value={time} aria-label="실제 경기 재생 시점" onChange={event => setTime(playbackTime(Number(event.target.value), manifest.durationMs))} /><span>{tacticalClock(manifest.durationMs)}</span></label>
        <p>위치·체력·지표·사건은 같은 저장 시점에서 표시합니다. 두 스냅샷 사이는 마지막 상태를 유지합니다. 배속과 탐색은 경기 결과를 바꾸지 않습니다.</p>
      </footer>
    </>}
  </dialog>;
}
