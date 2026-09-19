import { useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import type { Career, CareerPlayer, CareerTeam } from './types';
import './TrainingPanel.css';

const STATS = [
  ['MECHANICS', '메카닉', 'currentMechanics'], ['GAME_SENSE', '게임 이해도', 'currentGameSense'],
  ['LANING', '라인전', 'currentLaning'], ['TEAM_FIGHT', '한타', 'currentTeamFight'],
  ['MACRO', '운영', 'currentMacro'], ['TEAM_PLAY', '팀플레이', 'currentTeamPlay'],
  ['MENTAL', '멘탈', 'currentMental'], ['CHAMPION_POOL', '챔피언 폭', 'currentChampionPool'],
] as const;
const STRATEGIES: Record<string, string> = {
  BALANCED: '균형 운영', TOP_CARRY: '탑 캐리', TOP_JUNGLE: '탑·정글', MID_CARRY: '미드 캐리',
  MID_JUNGLE: '미드·정글', UPPER_SIDE: '상체 중심', BOT_CARRY: '바텀 캐리', BOT_PRESSURE: '바텀 압박',
};
export interface TrainingPeriod {
  weekStartsAt: string; weekEndsAt: string; phaseLabel: string;
  available: boolean; teamAvailable: boolean; teamRested: boolean; unavailableReason: string | null; usedPlayerIds: number[];
  teamTraining: { remaining: number; limit: number };
  sessions: Array<{ id: number; type: string; careerPlayerId: number | null; resultDelta: number; conditionDelta: number | null;
    playerEffects: Array<{ careerPlayerId: number; conditionBefore: number; conditionAfter: number; conditionDelta: number; formBefore: number; formAfter: number; formDelta: number }> }>;
}

export default function TrainingPanel({ career, team, token, onCareerRefresh, onOpenPlayer }: {
  career: Career; team: CareerTeam; token: string;
  onCareerRefresh: () => Promise<void>; onOpenPlayer: (player: CareerPlayer) => void;
}) {
  const [period, setPeriod] = useState<TrainingPeriod | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [strategy, setStrategy] = useState(team.teamStrategy);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const pending = useRef(false);
  const version = useRef(0);
  const path = `/careers/${career.id}/training-periods/current`;
  useEffect(() => {
    const request = ++version.current;
    void apiRequest<TrainingPeriod>(path, { token }).then(result => {
      if (version.current === request) setPeriod(result);
    }).catch(reason => {
      if (version.current === request) setError(reason instanceof Error ? reason.message : '훈련 정보를 불러오지 못했습니다.');
    });
    return () => { version.current = request + 1; };
  }, [path, token, career.currentDate]);

  async function act(category: 'team' | 'individual', body: object) {
    if (pending.current || !period || (category === 'team'
      ? !period.teamAvailable || period.teamTraining.remaining === 0
      : !period.available || period.teamRested)) return;
    pending.current = true;
    setBusy(true); setError(''); setMessage('');
    const request = version.current;
    try {
      const result = await apiRequest<TrainingPeriod>(`${path}/${category}`, { method: 'POST', token, body });
      if (request !== version.current) return;
      setPeriod(result);
      setMessage(result.teamRested ? '팀 전체 휴식 완료. 선수별 컨디션·폼 회복 결과를 확인하세요.' : '이번 주 활동이 저장되었습니다.');
      await onCareerRefresh();
    } catch (reason) {
      if (request === version.current) {
        setError(reason instanceof Error ? reason.message : '활동을 저장하지 못했습니다.');
        // A conflict/uncertain response must not leave stale usage enabled.
        try {
          const latest = await apiRequest<TrainingPeriod>(path, { token });
          if (request === version.current) setPeriod(latest);
        } catch { /* Keep the original actionable error. */ }
      }
    } finally {
      pending.current = false;
      if (request === version.current) setBusy(false);
    }
  }
  const players = [...team.starters, ...team.benches].map(roster => roster.careerPlayer);
  const disabled = busy || !period?.available || !!period?.teamRested;
  const teamDisabled = busy || !period?.teamAvailable || period.teamTraining.remaining === 0;
  const latestTeamActivity = period?.sessions.filter(session => session.careerPlayerId === null).at(-1);
  const signed = (value: number) => value > 0 ? `+${value}` : `${value}`;
  return <section className="training-panel" aria-busy={busy}>
    <header><p className="eyebrow">WEEKLY DEVELOPMENT</p><h2>주간 활동</h2>
      <p>{period ? `${period.weekStartsAt} — ${period.weekEndsAt} · ${period.phaseLabel}` : '활동 정보를 불러오는 중…'}</p></header>
    {error && <p className="training-error" role="alert">{error}</p>}
    {message && <p className="training-message" role="status">{message}</p>}
    {period && !period.available && <p className="training-notice">{period.unavailableReason}</p>}
    <section className="scrim-card">
      <div><span className="training-tag">TEAM · 매주 하나 선택</span><h3>스크림 또는 팀 휴식</h3>
        <p>스크림: 전술 숙련도 +4 · 케미 +3 · 컨디션 −5</p>
        <p>휴식: 주전·후보 컨디션 +20 · 멘탈에 따른 폼 회복</p></div>
      <label>훈련 전술<select aria-label="스크림 전술" value={strategy} disabled={teamDisabled}
        onChange={event => setStrategy(event.target.value as typeof strategy)}>
        {team.strategyProficiencies.map(item => <option key={item.strategy} value={item.strategy}>
          {STRATEGIES[item.strategy]} · {item.proficiency}</option>)}
      </select></label>
      <div className="training-team-actions"><button type="button" disabled={teamDisabled || players.every(player => player.condition === 0)}
        onClick={() => void act('team', { type: 'STRATEGY', strategy })}>
        {period?.teamTraining.remaining === 0 ? '이번 주 팀 활동 완료' : '스크림 진행'}</button>
      <button type="button" className="rest-button" disabled={teamDisabled || !!period?.usedPlayerIds.length || players.every(player => player.condition >= 100 && player.form >= 100)}
        onClick={() => void act('team', { type: 'REST' })}>팀 전체 휴식</button></div>
    </section>
    {!!latestTeamActivity?.playerEffects?.length && <section className="training-recovery-results" aria-label="팀 활동 결과">
      <h4>{latestTeamActivity.type === 'REST' ? '이번 주 휴식 회복 결과' : '이번 주 스크림 결과'}</h4>
      {latestTeamActivity.playerEffects.map(effect => <p key={effect.careerPlayerId}>
        <strong>{players.find(player => player.id === effect.careerPlayerId)?.playerCard.player.nickname ?? '선수'}</strong>
        <span>컨디션 {effect.conditionBefore} → {effect.conditionAfter} ({signed(effect.conditionDelta)})</span>
        <span>폼 {effect.formBefore} → {effect.formAfter} ({signed(effect.formDelta)})</span>
      </p>)}
    </section>}
    <div className="training-section-heading"><h3>개인 능력치 훈련</h3><p>준비 기간 한정 · 선수마다 주 1회</p></div>
    <p className="training-help">능력치 0~2 성장 · 컨디션 소모. 팀 휴식과 개인 훈련은 같은 주에 병행할 수 없습니다.</p>
    <p className="training-help">폼은 실제 경기 출전으로 가장 크게 오르며 경기력·멘탈의 영향을 받습니다. 시간 경과는 낮은 폼을 50까지만 천천히 회복시킵니다. 컨디션은 휴식으로만 회복됩니다.</p>
    <div className="training-players">{players.map(player => {
      const choice = choices[player.id] ?? 'LANING';
      const stat = STATS.find(item => item[0] === choice)!;
      const used = period?.usedPlayerIds.includes(player.id);
      return <article className="training-player" key={player.id}>
        <button className="training-player-name" type="button" onClick={() => onOpenPlayer(player)}>
          <small>{player.currentPosition}</small><strong>{player.playerCard.player.nickname}</strong>
        </button>
        <div className="training-condition"><span>컨디션 {player.condition}</span><progress aria-label={`${player.playerCard.player.nickname} 컨디션`} max={100} value={player.condition} />
          <span>폼 {player.form}</span><progress aria-label={`${player.playerCard.player.nickname} 폼`} max={100} value={player.form} />
          <small>회복 멘탈 {player.currentMental}</small></div>
        <select aria-label={`${player.playerCard.player.nickname} 훈련 능력치`} value={choice} disabled={disabled || used}
          onChange={event => setChoices(current => ({ ...current, [player.id]: event.target.value }))}>
          {STATS.map(([value, label, field]) => <option key={value} value={value}>{label} · {player[field]}</option>)}
        </select>
        <div className="training-player-actions"><button type="button" disabled={disabled || used || player.condition === 0 || player[stat[2]] >= 119}
          onClick={() => void act('individual', { type: choice, careerPlayerId: player.id })}>{used ? '이번 주 완료' : '훈련'}</button></div>
      </article>;
    })}</div>
    {!!period?.sessions.length && <details className="training-log"><summary>이번 주 활동 기록 ({period.sessions.length})</summary>
      {period.sessions.map(session => <p key={session.id}>{session.careerPlayerId === null ? '팀 활동' : players.find(player => player.id === session.careerPlayerId)?.playerCard.player.nickname ?? '선수'} · {session.type === 'REST' ? '휴식' : `${STATS.find(stat => stat[0] === session.type)?.[1] ?? '전술 숙련도'} +${session.resultDelta}`}
        {session.conditionDelta !== null && session.type !== 'REST' ? ` / 컨디션 ${session.conditionDelta}` : ''}</p>)}
    </details>}
  </section>;
}
