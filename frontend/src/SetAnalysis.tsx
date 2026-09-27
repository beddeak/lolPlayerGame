import { useState } from "react";
import type { Career, MatchSeries, MatchSimulation } from "./types";
import "./IntermissionPanel.css";

const signed = (n: number) =>
  n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
const metric = (n: number | undefined, digits = 0) =>
  Number.isFinite(n)
    ? n!.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";

function setWeaknesses(game: MatchSimulation, teamId: number) {
  const own = game.teams.find((t) => t.teamId === teamId);
  const opponent = game.teams.find((t) => t.teamId !== teamId);
  if (!own || !opponent) return [];
  const factors = (
    [
      ["baseAbility", "기본 전력"],
      ["stateModifier", "폼·컨디션·멘탈·피드백"],
      ["chemistryModifier", "팀 케미"],
      ["strategyProficiencyModifier", "전술 숙련도"],
      ["archetypeModifier", "픽 구성"],
      ["metaModifier", "메타 적합도"],
      ["rngModifier", "이번 세트 변동성"],
    ] as const
  )
    .flatMap(([key, label]) => {
      const a = own[key],
        b = opponent[key];
      return typeof a === "number" && typeof b === "number" && a - b < -0.1
        ? [{ label, gap: Number((a - b).toFixed(2)) }]
        : [];
    })
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3);
  return factors;
}

export default function SetAnalysis({
  series,
  career,
}: {
  series: MatchSeries;
  career: Career;
}) {
  const [selected, setSelected] = useState(series.games.at(-1)?.matchId);
  const game =
    series.games.find((g) => g.matchId === selected) ?? series.games.at(-1);
  if (!game) return null;
  const managed = career.teams.find((t) => t.isUserControlled);
  const team =
    game.teams.find((t) => t.teamId === managed?.id) ??
    game.teams.find((t) => t.teamId !== game.winnerTeamId) ??
    game.teams[0];
  const players = new Map(
    career.teams.flatMap((t) =>
      [...t.starters, ...t.benches].map(
        (s) =>
          [
            s.careerPlayer.id,
            s.careerPlayer.playerCard.player.nickname,
          ] as const,
      ),
    ),
  );
  const name = (id: number) => players.get(id) ?? `선수 ${id}`;
  const championName = (teamId:number,position: import('./types').Position) => {
    if(game.draft?.version!==3) return null;
    const side = game.draft.blue.id===teamId?'BLUE':'RED';
    const id = game.draft.assignments?.[side]?.[position];
    return game.draft.actions.find(a=>a.kind==='PICK'&&a.variantId===id)?.championName ?? id;
  };
  const factors = setWeaknesses(game, team?.teamId);
  const lane = [...(team?.playerStats ?? [])]
    .filter((p) => p.gdAt15 < 0)
    .sort((a, b) => a.gdAt15 - b.gdAt15)[0];
  const deaths = [...(team?.playerStats ?? [])].sort(
    (a, b) => b.deaths - a.deaths,
  )[0];
  return (
    <section className="set-analysis" aria-label="세트별 경기 분석">
      <header>
        <div>
          <span className="intermission-eyebrow">SET ANALYSIS</span>
          <h3>세트 지표 · 경기 분석</h3>
        </div>
        <div className="set-analysis-tabs" aria-label="분석할 세트">
          {series.games.map((g, i) => (
            <button
              type="button"
              key={g.matchId}
              aria-pressed={g.matchId === game.matchId}
              onClick={() => setSelected(g.matchId)}
            >
              {g.seriesGameNumber ?? i + 1}세트
            </button>
          ))}
        </div>
      </header>
      <div className="set-analysis-summary">
        <article>
          <h4>
            {team?.teamCode} ·{" "}
            {team?.teamId === game.winnerTeamId
              ? "승리 속 점검 사항"
              : "패배 요인 분석"}
          </h4>
          {factors.length ? (
            <ul>
              {factors.map((f) => (
                <li key={f.label}>
                  {f.label} · 상대 대비 경기력 기여 <b>{signed(f.gap)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              저장된 보정값에서 두드러진 열세가 없거나, 이전 기록에 상세
              보정값이 없습니다.
            </p>
          )}
          <small>
            시뮬레이션의 실제 보정값 비교입니다. 승패는 여러 요인과 변동성을
            합산한 결과입니다.
          </small>
        </article>
        <article>
          <h4>기록상 확인할 장면</h4>
          <p>
            {lane
              ? `${name(lane.careerPlayerId)} · 15분 골드 차이 ${signed(lane.gdAt15)}, CS 차이 ${signed(lane.csdAt15)}`
              : "15분 지표에서 확인된 라인 열세가 없습니다."}
          </p>
          <p>
            {deaths
              ? `${name(deaths.careerPlayerId)} · 팀 내 최다 ${deaths.deaths}데스 / KP ${metric(deaths.kp, 1)}%`
              : "선수 기록이 없습니다."}
          </p>
          <small>
            라인 지표와 데스는 점검 신호이며, 특정 선수 때문에 패배했다고
            단정하지 않습니다. 로밍·시야·오브젝트 실패는 아직 별도 기록하지
            않습니다.
          </small>
        </article>
      </div>
      {game.teams.map((t) => (
        <div key={t.teamId} className="set-team-stats">
          <h4>
            {t.teamCode} · {t.teamId === game.winnerTeamId ? "WIN" : "LOSS"}
          </h4>
          <div className="set-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "선수 / 포지션",
                    "K / D / A",
                    "DPM",
                    "딜 비중",
                    "골드",
                    "골드 비중",
                    "GD@15",
                    "CSD@15",
                    "KP",
                    "평점",
                    "폼",
                    "컨디션",
                    "멘탈",
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.playerStats.map((p) => (
                  <tr key={p.careerPlayerId}>
                    <th scope="row">
                      {name(p.careerPlayerId)}
                      <small>
                        {p.position}
                        {championName(t.teamId,p.position) ? ` · ${championName(t.teamId,p.position)}` : ''}
                        {p.feedback ? " · 피드백 적용" : ""}
                      </small>
                    </th>
                    <td>
                      {p.kills} / {p.deaths} / {p.assists}
                    </td>
                    <td>{metric(p.dpm)}</td>
                    <td>{metric(p.damageShare, 1)}%</td>
                    <td>{metric(p.gold)}</td>
                    <td>{metric(p.goldShare, 1)}%</td>
                    <td className={p.gdAt15 < 0 ? "negative" : "positive"}>
                      {metric(p.gdAt15)}
                    </td>
                    <td>{metric(p.csdAt15)}</td>
                    <td>{metric(p.kp, 1)}%</td>
                    <td>{metric(p.rating, 1)}</td>
                    <td>
                      {metric(p.form)} → {metric(p.formAfter)}
                    </td>
                    <td>
                      {metric(p.condition)} → {metric(p.conditionAfter)}
                    </td>
                    <td>
                      {metric(p.mental)} → {metric(p.mentalAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="intermission-note">
        GD@15 / CSD@15: 15분 시점 같은 포지션 상대와의 골드 / CS 차이. KP: 팀 킬
        관여율. 상태 변화는 해당 세트의 저장 기록이며, 세트 한정 피드백은 기본
        상태에 누적 저장되지 않습니다.
      </p>
    </section>
  );
}
