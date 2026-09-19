import { useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import type { Career } from './types';
import './InternationalPanel.css';

const LABELS = { FIRST_STAND: 'FIRST STAND', MSI: 'MSI', WORLDS: 'WORLDS' };
type Kind = keyof typeof LABELS;
export interface InternationalData {
  readiness: Array<{ kind: Kind; startsAt: string; endsAt: string; participantCount: number; ready: boolean; tournamentId: number | null; reasons: string[]; teamRequirements: Array<{ region: string; required: number; available: number }> }>;
  tournaments: Array<{ id: number; kind: Kind; year: number; rosterConfirmed: boolean; championTeamId: number | null; entrants: Array<{ teamId: number; region: string; regionalSeed: number; entry: string }>; fixtures: Array<{ id: number | null; key: string; stage: string; round: number; scheduledDate: string; bestOf: number; teamAId: number | null; teamBId: number | null; winnerTeamId: number | null; teamAWins: number; teamBWins: number; playable: boolean }> }>;
}

export default function InternationalPanel({ career, token, revision, busy, onAction }: {
  career: Career; token: string; revision: object; busy: boolean; onAction: (suffix: string) => void;
}) {
  const [data, setData] = useState<InternationalData | null>(null);
  const [error, setError] = useState('');
  const version = useRef(0);
  useEffect(() => {
    const request = ++version.current;
    void apiRequest<InternationalData>(`/careers/${career.id}/internationals`, { token }).then(result => {
      if (version.current === request) { setData(result); setError(''); }
    }).catch(reason => {
      if (version.current === request) setError(reason instanceof Error ? reason.message : '국제대회를 불러오지 못했습니다.');
    });
    return () => { version.current = request + 1; };
  }, [career.id, token, revision]);
  const teams = new Map(career.teams.map(team => [team.id, team.code]));
  const name = (id: number | null) => id ? teams.get(id) ?? `구단 ${id}` : '진출팀 대기';
  return <section id="international-competitions" className="international-panel" aria-busy={busy}>
    <header><span>GLOBAL COMPETITION</span><h2>국제대회</h2><p>지역 예선 결과로 진출 · 정식 참가팀 수 충족 시 개막</p></header>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>국제대회 정보를 불러오는 중…</p>}
    <div className="international-readiness">{data?.readiness.map(item => <article key={item.kind}>
      <span>{item.participantCount} CLUBS</span><h3>{LABELS[item.kind]}</h3><p>{item.startsAt} — {item.endsAt}</p>
      <div className="international-regions">{item.teamRequirements.map(row => <span key={row.region} className={row.available < row.required ? 'missing' : ''}>{row.region} {row.available}/{row.required}</span>)}</div>
      <small>보유 구단 / 필요 진출 시드 · LCP·CBLOL 국내 시즌은 각 8팀 필요</small>
      {item.tournamentId ? <p className="international-ready">대회 생성 완료 · 아래 대진에서 진행</p> : <>
        <details><summary>{item.ready ? '대회 준비 완료' : '개막 조건 확인'}</summary><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
        <button disabled={busy || !item.ready} onClick={() => onAction(item.kind)}>대회 준비</button>
      </>}
    </article>)}</div>
    {data?.tournaments.map(tournament => <details className="international-tournament" key={tournament.id} open={!tournament.championTeamId}>
      <summary>{tournament.year} {LABELS[tournament.kind]} {tournament.championTeamId ? `· 우승 ${name(tournament.championTeamId)}` : '· 진행 중'}</summary>
      <p className="international-entrants">{tournament.entrants.map(entry => `${name(entry.teamId)} (${entry.region} #${entry.regionalSeed}${entry.entry === 'PLAY_IN' ? ' · PI' : ''})`).join(' / ')}</p>
      {!tournament.rosterConfirmed && <div className="international-register"><p>현재 주전·후보를 국제대회 로스터로 등록하세요. 이후에는 등록된 선수만 출전할 수 있습니다.</p><button disabled={busy} onClick={() => onAction(`${tournament.id}/roster`)}>현재 선수단 등록</button></div>}
      <div className="international-fixtures">{tournament.fixtures.map(game => <article key={game.key} className={game.winnerTeamId ? 'completed' : ''}>
        <div><small>{game.scheduledDate} · {game.stage} · R{game.round} · BO{game.bestOf}</small><strong>{name(game.teamAId)} <b>{game.teamAWins} : {game.teamBWins}</b> {name(game.teamBId)}</strong></div>
        {game.winnerTeamId ? <span>{name(game.winnerTeamId)} 승리</span> : <button disabled={busy || !game.playable || !game.id} onClick={() => onAction(`${tournament.id}/fixtures/${game.id}/simulate`)}>{game.playable ? '시리즈 진행' : '일정 / 진출팀 대기'}</button>}
      </article>)}</div>
    </details>)}
    <p className="international-footnote">AI 구단의 국제경기도 여기에서 시리즈 단위로 진행합니다. 경기일에는 일정을 멈추고 결과와 다음 대진을 저장합니다.</p>
  </section>;
}
