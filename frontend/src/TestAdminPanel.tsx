import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import "./TestAdminPanel.css";

const FIELDS = [
  ["currentMechanics", "메카닉", 119], ["currentGameSense", "게임 이해도", 119],
  ["currentLaning", "라인전", 119], ["currentTeamFight", "한타", 119],
  ["currentMacro", "운영", 119], ["currentTeamPlay", "팀플레이", 119],
  ["currentMental", "멘탈", 119], ["currentChampionPool", "챔피언 폭", 119],
  ["form", "폼", 100], ["condition", "컨디션", 100], ["coachTrust", "감독 신뢰", 100],
] as const;
interface Player { id: number; nickname: string; team: string; position: string; values: Record<string, number> }
interface Progress { currentDate: string; games: number; cursor: string }
interface Snapshot extends Progress { players: Player[] }
interface Step extends Progress { done: boolean; stopped: boolean; message: string }

export default function TestAdminPanel({ careerId, token, onRefresh, onBack }: {
  careerId: number; token: string; onRefresh: () => Promise<void>; onBack: () => void;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(false);
  const pending = useRef(false);
  const cancelled = useRef(false);
  const base = `/careers/${careerId}/test-admin`;

  async function reload() {
    const snapshot = await apiRequest<Snapshot>(base, { token });
    if (!alive.current) return snapshot;
    setData(snapshot); setProgress(snapshot); setSelected(null); setValues({});
    return snapshot;
  }
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    void apiRequest<Snapshot>(base, { token, signal: abort.signal }).then(snapshot => {
      if (!abort.signal.aborted) { setData(snapshot); setProgress(snapshot); }
    }).catch(reason => { if (!abort.signal.aborted) setError(String(reason.message ?? reason)); });
    return () => { alive.current = false; cancelled.current = true; abort.abort(); };
  }, [base, token]);

  const player = data?.players.find(p => p.id === selected);
  const invalid = FIELDS.some(([key, , max]) => values[key]?.trim() === "" || !Number.isInteger(Number(values[key])) || Number(values[key]) < 0 || Number(values[key]) > max);
  const targetDate = progress ? `${progress.currentDate.slice(0, 4)}-11-19` : "";

  async function save() {
    if (pending.current || !player || invalid) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await apiRequest(base + `/players/${player.id}`, { token, method: "PATCH", body: {
        values: Object.fromEntries(FIELDS.map(([key]) => [key, Number(values[key])])), expected: player.values,
      } });
      if (alive.current) { await reload(); setMessage("이 세이브의 선수 능력치를 저장했습니다."); }
      await onRefresh();
    } catch (reason) {
      if (alive.current) setError(`${reason instanceof Error ? reason.message : reason} 변경 결과가 불확실하면 다시 불러오기를 눌러 확인하세요.`);
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  async function advance() {
    if (pending.current || !data || !confirmed || !targetDate) return;
    pending.current = true; cancelled.current = false; setBusy(true); setAdvancing(true); setError("");
    setMessage("남은 일정을 자동 처리하고 있습니다…");
    try {
      let state: Progress = await reload();
      for (let step = 0; step < 5000 && alive.current && !cancelled.current; step++) {
        const next = await apiRequest<Step>(base + "/advance", { token, method: "POST", body: { targetDate, cursor: state.cursor } });
        if (!alive.current) break;
        setProgress(next); setMessage(next.message); state = next;
        if (next.done || next.stopped) break;
        if (step === 4999) setMessage("안전 처리 한도에 도달했습니다. 현재 지점부터 다시 시작할 수 있습니다.");
      }
      if (alive.current && cancelled.current) setMessage("중단했습니다. 이미 처리된 경기·날짜는 저장되어 있습니다.");
    } catch (reason) {
      if (alive.current) setError(`${reason instanceof Error ? reason.message : reason} 자동 재시도하지 않았습니다. 다시 불러온 뒤 이어서 진행하세요.`);
    } finally {
      if (alive.current) { setConfirmed(false); await reload().catch(() => {}); }
      await onRefresh().catch(() => {});
      pending.current = false; if (alive.current) { setBusy(false); setAdvancing(false); }
    }
  }

  return <section className="test-admin-panel">
    <header><div><span>TEST TOOLS · 임시 공개</span><h1>테스트 관리자</h1></div><button disabled={busy} onClick={onBack}>구단 홈</button></header>
    <p>자기 세이브에만 적용됩니다. 원본 선수 카드·시드는 변경하지 않습니다. 변경과 자동 진행은 되돌릴 수 없습니다.</p>
    {error && <p role="alert" className="test-admin-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button disabled={busy} onClick={() => { setError(""); void reload().catch(reason => setError(String(reason.message ?? reason))); }}>다시 불러오기</button>
    <div className="test-admin-columns">
      <article><h2>선수 스탯 수정</h2><p>기본 능력치 0~119 · 폼/컨디션/신뢰 0~100. 진행 중인 밴픽이 있으면 수정할 수 없습니다.</p>
        <label>선수<select disabled={busy || !data} value={selected ?? ""} onChange={event => {
          const next = data?.players.find(p => p.id === Number(event.target.value));
          setSelected(next?.id ?? null); setValues(Object.fromEntries(Object.entries(next?.values ?? {}).map(([k,v]) => [k, String(v)])));
        }}><option value="">수정할 선수 선택</option>{data?.players.map(p => <option key={p.id} value={p.id}>[{p.team}] {p.nickname} · {p.position}</option>)}</select></label>
        {player && <><div className="test-admin-stats">{FIELDS.map(([key, label, max]) => <label key={key}>{label}<input aria-label={label} type="number" min={0} max={max} step={1} value={values[key] ?? ""} disabled={busy} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
          <button disabled={busy || invalid} onClick={() => void save()}>능력치 저장</button></>}
      </article>
      <article><h2>이적시장까지 자동 진행</h2><strong>{progress?.currentDate ?? "불러오는 중"} → {targetDate}</strong><p>저장된 경기: {progress?.games ?? 0}세트</p>
        <p>내 경기와 다른 팀 경기의 밴픽·결과를 자동 처리합니다. 날짜별 계약·폼·리그 진행은 기존 규칙을 거칩니다. 피드백과 주간 훈련은 선택하지 않습니다.</p>
        <p>계약 결정·국제전 등록·감독 경질 등 확인이 필요한 상황에서는 중단합니다. 없는 구단이나 경기 결과를 만들어 건너뛰지 않습니다.</p>
        <label className="test-admin-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> 남은 경기를 자동 처리하고 결과를 저장하는 데 동의합니다.</label>
        <button disabled={busy || !confirmed || !data || (progress?.currentDate ?? "") >= targetDate} onClick={() => void advance()}>11월 19일 FA 시장까지 이동</button>
        {advancing && <button onClick={() => { cancelled.current = true; setMessage("현재 요청을 마친 뒤 중단합니다…"); }}>자동 진행 중단</button>}
      </article>
    </div>
  </section>;
}
