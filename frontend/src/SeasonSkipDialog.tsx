import { useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import './SeasonSkipDialog.css';

const STRATEGIES = { BALANCED: '균형 운영', TOP_CARRY: '탑 캐리', TOP_JUNGLE: '탑·정글', MID_CARRY: '미드 캐리', MID_JUNGLE: '미드·정글', UPPER_SIDE: '상체 중심', BOT_CARRY: '바텀 캐리', BOT_PRESSURE: '바텀 압박' };
const STATS = { MECHANICS: '메카닉', GAME_SENSE: '게임 이해도', LANING: '라인전', TEAM_FIGHT: '한타', MACRO: '운영', TEAM_PLAY: '팀플레이', MENTAL: '멘탈', CHAMPION_POOL: '챔피언 폭' };
interface Progress { currentDate: string; games: number; activities: number; cursor: string }
interface Snapshot extends Progress { splitId: number | null; label: string; available: boolean; reason: string | null; players: { id: number; nickname: string }[] }
interface Step extends Progress { message: string; done: boolean; stopped: boolean }
export default function SeasonSkipDialog({ careerId, token, onClose, onUpdated }: {
  careerId: number; token: string; onClose: () => void; onUpdated: () => Promise<void>;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [pattern, setPattern] = useState<Array<'SCRIM' | 'REST'>>(['SCRIM', 'REST']);
  const [strategy, setStrategy] = useState('BALANCED');
  const [individuals, setIndividuals] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false), cancelled = useRef(false), alive = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const base = `/careers/${careerId}/season-skip`;
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    void apiRequest<Snapshot>(base, { token, signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setData(value); setProgress(value); }
    }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive.current = false; cancelled.current = true; abort.abort(); };
  }, [base, token]);
  useEffect(() => {
    const focused = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; if (focused instanceof HTMLElement && focused.isConnected) focused.focus(); };
  }, []);
  async function start() {
    if (pending.current || !confirmed || !data?.available) return;
    pending.current = true; cancelled.current = false; setBusy(true); setError(''); setMessage('정규시즌을 자동 진행합니다…');
    try {
      const fresh = await apiRequest<Snapshot>(base, { token });
      if (!alive.current || cancelled.current) return;
      setData(fresh); setProgress(fresh);
      if (!fresh.available || fresh.splitId !== data.splitId) { setMessage('대상 스플릿이 변경되었습니다. 현재 일정과 계획을 다시 확인하세요.'); return; }
      let cursor = fresh.cursor;
      const plan = { splitId: fresh.splitId, startDate: fresh.currentDate, strategy, pattern, individuals: Object.entries(individuals).filter(([,type])=>type).map(([id,type])=>({careerPlayerId:Number(id),type})) };
      for (let count=0; count<5000 && alive.current && !cancelled.current; count++) {
        const next = await apiRequest<Step>(base+'/step', { token, method:'POST', body:{...plan,cursor} });
        if (!alive.current) break;
        setProgress(next); setMessage(next.message); cursor=next.cursor;
        if (next.done || next.stopped) break;
        if (count === 4999) setMessage('안전 처리 한도에 도달했습니다. 현재 지점에서 다시 시작할 수 있습니다.');
      }
      if (alive.current && cancelled.current) setMessage('중단했습니다. 완료된 경기와 활동은 저장됐습니다.');
    } catch (reason) {
      if (alive.current) setError(`${reason instanceof Error ? reason.message : reason} 자동 재시도하지 않았습니다. 완료된 결과를 확인한 후 다시 시작하세요.`);
    } finally {
      if (alive.current) {
        await onUpdated().catch(() => setError('시즌 화면 갱신에 실패했습니다. 다시 불러와 주세요.'));
        if (alive.current) { setBusy(false); setConfirmed(false); }
      }
      pending.current=false;
    }
  }
  return <div className="season-skip-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="season-skip-title" className="season-skip-dialog" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault(); if(pending.current){cancelled.current=true;setMessage('현재 요청을 마친 뒤 중단합니다…');}else onClose();}
    if(event.key==='Tab'){
      const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)')??[]);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey && (document.activeElement===first || document.activeElement===dialog.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }}>
    <header><div><small>AUTO SEASON · WEEKLY PLAN</small><h2 id="season-skip-title">플레이오프 전까지 스킵</h2><p>{data?.label ?? (error ? '계획을 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.' : '계획 불러오는 중…')}</p></div><button disabled={busy} onClick={onClose} aria-label="스킵 계획 닫기">닫기</button></header>
    <p>내 경기까지 자동 밴픽·시뮬레이션합니다. 플레이인·플레이오프 시작 전, 국제대회 또는 직접 결정할 이벤트에서 멈춥니다. 결과는 되돌릴 수 없습니다.</p>
    {error && <p role="alert" className="season-skip-error">{error}</p>}
    {data?.reason && <p role="status">{data.reason}</p>}
    <fieldset disabled={busy || !data?.available}><legend>스킵하는 동안의 주간 행동</legend>
      <label>계속 연습할 전술<select aria-label="스크림 전술" value={strategy} onChange={e=>setStrategy(e.target.value)}>{Object.entries(STRATEGIES).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <div className="season-skip-presets"><button onClick={()=>setPattern(['SCRIM','REST'])}>스크림 → 휴식</button><button onClick={()=>setPattern(['REST','SCRIM'])}>휴식 → 스크림</button><button onClick={()=>setPattern(['SCRIM'])}>매주 스크림</button><button onClick={()=>setPattern(['REST'])}>매주 휴식</button></div>
      <div className="season-skip-cycle">{pattern.map((action,index)=><label key={index}>{index+1}주차<select aria-label={`${index+1}주차 활동`} value={action} onChange={e=>setPattern(current=>current.map((v,i)=>i===index?e.target.value as 'SCRIM'|'REST':v))}><option value="SCRIM">지정 전술 스크림</option><option value="REST">팀 전체 휴식</option></select></label>)}</div>
      <button disabled={pattern.length>=8} onClick={()=>setPattern(p=>[...p,'REST'])}>주차 추가</button> <button disabled={pattern.length<=1} onClick={()=>setPattern(p=>p.slice(0,-1))}>마지막 주차 제거</button>
      <p>위 순서를 매주 반복합니다. 이미 활동한 주는 덮어쓰지 않습니다. 전술 숙련도와 케미가 모두 최대면 스크림 대신 휴식합니다. 다시 시작하면 현재 주부터 새 주기를 적용합니다.</p>
      <h3>준비 기간 개인 훈련</h3><p>선수마다 한 가지 능력을 지정하세요. 정규시즌·휴식 주에는 하지 않으며 기존 주간 횟수와 성장 한도를 따릅니다. 지정 순서대로 가능한 인원까지 진행합니다.</p>
      <div className="season-skip-players">{data?.players.map(player=><label key={player.id}>{player.nickname}<select aria-label={`${player.nickname} 개인 훈련`} value={individuals[player.id]??''} onChange={e=>setIndividuals(v=>({...v,[player.id]:e.target.value}))}><option value="">개인 훈련 안 함</option>{Object.entries(STATS).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>)}</div>
      <label className="season-skip-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>이 계획으로 훈련·휴식·경기를 자동 진행합니다.</label>
    </fieldset>
    <footer><div aria-live="polite"><strong>{progress?.currentDate}</strong><p>{message || '활동 계획을 정한 뒤 시작하세요.'}</p><small>저장된 경기 {progress?.games??0}세트 · 활동 {progress?.activities??0}회</small></div>{busy?<button onClick={()=>{cancelled.current=true;setMessage('현재 요청을 마친 뒤 중단합니다…');}}>자동 진행 중단</button>:<button disabled={!data?.available || !confirmed} onClick={()=>void start()}>계획 확정 · 스킵 시작</button>}</footer>
  </div></div>;
}
