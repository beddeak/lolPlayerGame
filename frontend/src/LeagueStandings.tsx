import ClubLogo from "./ClubLogo";
import type { LeagueStage, LeagueStanding, LeagueGroup } from "./types";
import "./LeagueStandings.css";

const BATTLE_STATUS: Record<NonNullable<LeagueGroup["battleStatus"]>, string> = {
  PENDING: "경기 전", TIED: "동률", LEADING: "현재 우세", TRAILING: "추격 중",
  WINNER: "승리 그룹", LOSER: "패배 그룹",
};

function StandingsRows({ rows, managedTeamId, label }: {
  rows: LeagueStanding[]; managedTeamId: number; label: string;
}) {
  if (!rows.length) return <p className="league-group-empty">참가 구단이 아직 확정되지 않았습니다.</p>;
  return <div className="league-standings-scroll" role="region" aria-label={label} tabIndex={0}>
    <table className="league-standings-table">
      <caption>{label}</caption>
      <thead><tr><th scope="col">순위</th><th scope="col">구단</th><th scope="col">경기</th>
        <th scope="col">승</th><th scope="col">패</th><th scope="col">세트 득실</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.teamId} className={row.teamId === managedTeamId ? "is-managed" : undefined}>
        <td className="league-group-rank">{row.rank}</td>
        <th scope="row"><div className="league-group-team">
          <ClubLogo club={{ code: row.teamCode }} className="club-logo--small" />
          <span><strong>{row.teamCode}</strong><small>{row.teamName}</small>
            {row.teamId === managedTeamId && <small className="league-group-mine">내 구단</small>}</span>
        </div></th>
        <td>{row.played}</td><td>{row.seriesWins}</td><td>{row.seriesLosses}</td>
        <td className={row.gameDifference < 0 ? "is-negative" : "is-positive"}>
          {row.gameDifference > 0 ? "+" : ""}{row.gameDifference}
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function LeagueStandings({ stage, managedTeamId }: {
  stage: LeagueStage; managedTeamId: number;
}) {
  if (stage.format !== "GROUP") return <StandingsRows rows={stage.standings} managedTeamId={managedTeamId} label={`${stage.name} 순위`} />;
  if (stage.status === "PLANNED" && !stage.participants.length) return <p className="league-group-empty">이전 단계가 끝나면 그룹 편성과 순위가 표시됩니다.</p>;
  if (!stage.groups?.length) return <p className="league-group-empty">
    {stage.status === "PLANNED" ? "이전 단계가 끝나면 그룹 편성과 순위가 표시됩니다." : "그룹 정보를 불러오지 못했습니다. 백엔드 재시작 후 다시 불러와 주세요."}
  </p>;
  const crossGroup = stage.settings.pairingMode === "CROSS_GROUP";
  return <div className="league-groups">
    <p className="league-group-guide">{crossGroup
      ? "상대 그룹과 대결합니다. 그룹 합산 점수와 그룹 내 순위를 따로 집계합니다."
      : "같은 그룹의 구단끼리 대결합니다. 순위는 각 그룹 안에서 계산합니다."}
      {crossGroup && !!stage.settings.superWeek && " 슈퍼 위크 BO5 승리 2점 · 일반 BO3 승리 1점."}
    </p>
    <div className="league-group-grid">{stage.groups.map(group => <section
      key={group.code} className="league-group-card" data-group={group.code}
      aria-label={`${group.name} 순위`}>
      <header className="league-group-heading"><div><span>{group.code} · {group.standings.length} TEAMS</span>
        <h3>{group.name}</h3></div>
        {crossGroup ? <div className="league-group-score"><strong>{group.points}<small>점</small></strong>
          <span>{group.battleStatus ? BATTLE_STATUS[group.battleStatus] : "경기 전"}</span></div>
          : <span className="league-group-mode">그룹 내 리그전</span>}
      </header>
      {crossGroup && <p className="league-group-total">그룹 합산 {group.seriesWins}승 {group.seriesLosses}패 · 세트 득실 {group.gameDifference > 0 ? "+" : ""}{group.gameDifference}</p>}
      {crossGroup && group.battleTiebreaker && <p className="league-group-total">
        {group.battleTiebreaker === "GAME_DIFFERENCE" ? "승점 동률 · 합산 세트 득실로 비교" : "승점·세트 득실 동률 · 기존 상위 시드 기준으로 결정"}
      </p>}
      <StandingsRows rows={group.standings} managedTeamId={managedTeamId} label={`${group.name} 순위표`} />
    </section>)}</div>
    {crossGroup && stage.code === "GROUP_BATTLE" && <p className="league-group-guide">
      승리 그룹 1·2위와 패배 그룹 1위는 PO 직행. 승리 그룹 3~5위와 패배 그룹 2~4위는 플레이인에 진출합니다.
      {" "}그룹 동점은 합산 세트 득실, 최종 동률은 기존 상위 시드 순으로 결정합니다.
    </p>}
  </div>;
}
