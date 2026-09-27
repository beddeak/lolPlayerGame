import ClubLogo from "./ClubLogo";
import type { LeagueStage, BracketSlot, BracketNode } from "./types";
import "./LeagueBracket.css";

const laneLabels = {
  UPPER: "승자조 / 상위 라운드",
  LOWER: "패자조",
  FINAL: "최종전",
  QUALIFIER: "진출 결정전",
};
const WIDTH = 220,
  HEIGHT = 154,
  COLUMN = 280,
  ROW = 182;
export default function LeagueBracket({
  stage,
  managedTeamId,
}: {
  stage: LeagueStage;
  managedTeamId: number;
}) {
  const graph = stage.bracket;
  if (!graph?.nodes.length)
    return (
      <div className="league-bracket-empty">
        {stage.status === "PLANNED"
          ? "이전 단계가 끝나면 참가팀과 대진이 확정됩니다."
          : "대진 정보가 아직 없습니다. 서버를 업데이트하거나 일정을 다시 불러와 주세요."}
      </div>
    );
  const rounds = [...new Set(graph.nodes.map((n) => n.round))].sort(
    (a, b) => a - b,
  );
  const topSize = Math.max(
    1,
    ...rounds.map(
      (r) =>
        graph.nodes.filter(
          (n) => n.round === r && n.lane !== "LOWER" && n.lane !== "FINAL",
        ).length,
    ),
  );
  const lowerTop = 80 + topSize * ROW + 70;
  const lowerSize = Math.max(
    0,
    ...rounds.map(
      (r) =>
        graph.nodes.filter((n) => n.round === r && n.lane === "LOWER").length,
    ),
  );
  const hasLower = lowerSize > 0;
  const positions = new Map(
    graph.nodes.map((n) => {
      const siblings = graph.nodes.filter(
        (s) => s.round === n.round && s.lane === n.lane,
      );
      const y =
        n.lane === "LOWER"
          ? lowerTop + siblings.indexOf(n) * ROW
          : n.lane === "FINAL"
            ? hasLower
              ? (80 + lowerTop) / 2
              : 80 + ((topSize - 1) * ROW) / 2
            : 80 + siblings.indexOf(n) * ROW;
      return [n.key, { x: 22 + rounds.indexOf(n.round) * COLUMN, y }];
    }),
  );
  const height =
    Math.max(...[...positions.values()].map((p) => p.y)) + HEIGHT + 35;
  const width = rounds.length * COLUMN;
  const slotLabel = (s: BracketSlot) =>
    s.source
      ? `${s.source.key}경기 ${s.source.result === "WINNER" ? "승자" : "패자"}`
      : "대진 미정";
  const fixtures = new Map(stage.fixtures.map((f) => [f.id, f]));
  const team = (id: number | null) => {
    if (id === null) return null;
    const participant = stage.participants.find((p) => p.teamId === id);
    if (participant)
      return { id, code: participant.teamCode, name: participant.teamName };
    return (
      stage.fixtures
        .flatMap((f) => [f.teamA, f.teamB])
        .find((t) => t.id === id) ?? null
    );
  };
  const links = graph.nodes.flatMap((n) =>
    (["a", "b"] as const).flatMap((side, i) => {
      const source = n[side].source,
        from = source && positions.get(source.key),
        to = positions.get(n.key)!;
      if (!source || !from) return [];
      const x = from.x + WIDTH,
        y = from.y + HEIGHT / 2,
        endY = to.y + 57 + i * 40;
      const mid = x + (to.x - x) / 2;
      return [
        {
          key: `${n.key}-${side}`,
          result: source.result,
          label: `${source.key}경기 ${source.result === "WINNER" ? "승자" : "패자"} → ${n.key}경기`,
          d: `M ${x} ${y} H ${mid} V ${endY} H ${to.x}`,
        },
      ];
    }),
  );
  const row = (node: BracketNode, side: "a" | "b") => {
    const slot = node[side],
      club = team(slot.teamId),
      fixture =
        node.fixtureId === null ? undefined : fixtures.get(node.fixtureId);
    const winner =
      fixture?.winnerTeamId === slot.teamId && slot.teamId !== null;
    const score =
      fixture?.status === "SCHEDULED" || !fixture
        ? "—"
        : slot.teamId === fixture.teamA.id
          ? fixture.teamAWins
          : fixture.teamBWins;
    return (
      <div
        className={`league-bracket-team ${winner ? "is-winner" : ""} ${slot.teamId === managedTeamId ? "is-managed" : ""}`}
      >
        {club ? (
          <>
            <ClubLogo club={club} />
            <span title={club.name}>
              {club.code}
              {slot.teamId === managedTeamId && <small>내 구단</small>}
            </span>
          </>
        ) : (
          <span className="league-bracket-placeholder">{slotLabel(slot)}</span>
        )}
        <b>{score}</b>
        {winner && (
          <span className="league-bracket-winner" aria-label="승리">
            ✓
          </span>
        )}
      </div>
    );
  };
  return (
    <section className="league-bracket" aria-label={`${stage.name} 대진표`}>
      <div className="league-bracket-legend">
        <span>━ 승자 이동</span>
        <span>┄ 패자 이동</span>
        <span>금색 테두리 · 내 구단</span>
      </div>
      <div
        className="league-bracket-scroll"
        tabIndex={0}
        role="region"
        aria-label="좌우로 스크롤하는 대진표"
      >
        <div className="league-bracket-canvas" style={{ width, height }}>
          {rounds.map((r, i) => (
            <h3
              className="league-bracket-round"
              style={{ left: 22 + i * COLUMN, width: WIDTH }}
              key={r}
            >
              {r}라운드
            </h3>
          ))}
          {hasLower && (
            <span
              className="league-bracket-lane"
              style={{ top: lowerTop - 42 }}
            >
              LOWER BRACKET · 패자조
            </span>
          )}
          <svg width={width} height={height} aria-hidden="true">
            {links.map((l) => (
              <path
                key={l.key}
                d={l.d}
                className={l.result === "LOSER" ? "is-loser-link" : ""}
              >
                <title>{l.label}</title>
              </path>
            ))}
          </svg>
          {graph.nodes.map((n) => {
            const p = positions.get(n.key)!,
              f = n.fixtureId === null ? undefined : fixtures.get(n.fixtureId);
            return (
              <article
                key={n.key}
                aria-label={`${n.key}경기 ${n.label}`}
                className={`league-bracket-match lane-${n.lane} ${[n.a.teamId, n.b.teamId].includes(managedTeamId) ? "is-managed" : ""}`}
                style={{ left: p.x, top: p.y, width: WIDTH, minHeight: HEIGHT }}
              >
                <header>
                  <span>{n.label}</span>
                  <small>BO{n.bestOf}</small>
                </header>
                {row(n, "a")}
                {row(n, "b")}
                <footer>
                  <time>{f?.scheduledDate ?? "일정 미정"}</time>
                  <span>
                    {f?.status === "COMPLETED"
                      ? "종료"
                      : f?.status === "IN_PROGRESS"
                        ? "진행 중"
                        : f
                          ? "예정"
                          : "진출팀 대기"}
                  </span>
                </footer>
                <span className="league-bracket-sr">
                  {laneLabels[n.lane]} · {slotLabel(n.a)} / {slotLabel(n.b)}
                </span>
              </article>
            );
          })}
        </div>
      </div>
      {graph.dynamic && (
        <p className="league-bracket-note">
          다음 라운드는 결과와 시드에 따라 대진이 확정되면 연결됩니다.
        </p>
      )}
      <p className="league-bracket-note">
        화면이 좁으면 대진표를 좌우로 움직여 볼 수 있습니다. 경기 진행은 기존
        경기 시작 버튼을 이용하세요.
      </p>
    </section>
  );
}
