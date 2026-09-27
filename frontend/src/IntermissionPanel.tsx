import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { POSITIONS } from "./types";
import type {
  Career,
  MatchFeedback,
  MatchSeries,
  Position,
  TeamStrategy,
} from "./types";
import "./IntermissionPanel.css";

const OPTIONS = {
  INDIVIDUAL: [
    [
      "TRUST_PLAYER",
      "오늘 네가 제일 잘하고 있다.",
      "직전 활약을 인정합니다. 근거 없는 칭찬이나 과신은 역효과를 낼 수 있습니다.",
    ],
    [
      "DEMAND_CARRY",
      "다음 세트는 네 중심으로 간다.",
      "멘탈과 신뢰가 높으면 캐리 역할에 힘을 얻지만 부담이 커질 수 있습니다.",
    ],
    [
      "RELIEVE_PRESSURE",
      "부담 갖지 말고 하던 대로 해.",
      "압박을 줄입니다. 캐리 욕구가 강한 선수는 소극적인 주문으로 느낄 수 있습니다.",
    ],
    [
      "DEMAND_AGGRESSION",
      "더 공격적으로 해.",
      "교전을 적극적으로 노립니다. 무리한 플레이와 데스 위험도 함께 커집니다.",
    ],
    [
      "BLAME_PLAYER",
      "네가 지금 제일 문제다.",
      "강한 질책입니다. 선수 성격과 직전 활약에 따라 자극 또는 반발을 부릅니다.",
    ],
  ],
  TEAM: [
    [
      "PRAISE_TEAM",
      "잘했다. 그대로 가자.",
      "경기 내용에 맞는 칭찬은 자신감을 줍니다. 방심으로 이어질 수도 있습니다.",
    ],
    [
      "REFOCUS_TEAM",
      "아직 할 만하다. 침착하게 하자.",
      "선수들의 부담을 줄이고 다음 세트에 집중하게 합니다.",
    ],
    [
      "WAKE_UP_TEAM",
      "정신 차려. 집중해.",
      "감독 신뢰와 수용 성향에 따라 집중하거나 위축됩니다.",
    ],
    [
      "DISAPPOINTED_TEAM",
      "지금 경기력은 실망스럽다.",
      "공개적인 질책입니다. 다섯 선수가 각각 다르게 받아들입니다.",
    ],
    [
      "ABUSIVE_TEAM",
      "역겨운 쓰레기들 같으니라.",
      "극단적 질책. 오기, 위축, 감독 반감, 팀 분위기 악화가 엇갈릴 수 있습니다.",
    ],
  ],
} as const;
const PERSONALITY: Record<string, string> = {
  DEVOTED: "헌신적",
  LOYAL: "충성심",
  SELF_CENTERED: "자기중심적",
  PROFESSIONAL: "프로페셔널",
  SENSITIVE: "예민함",
};
const STRATEGIES: Record<TeamStrategy, string> = {
  BALANCED: "균형 운영",
  TOP_CARRY: "탑 캐리",
  TOP_JUNGLE: "탑·정글",
  MID_CARRY: "미드 캐리",
  MID_JUNGLE: "미드·정글",
  UPPER_SIDE: "상체 중심",
  BOT_CARRY: "바텀 캐리",
  BOT_PRESSURE: "바텀 압박",
};
const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

export default function IntermissionPanel({
  series,
  career,
  token,
  onState,
  onSync,
}: {
  series: MatchSeries;
  career: Career;
  token: string;
  onState: (state: { busy: boolean; ready: boolean }) => void;
  onSync: (series: MatchSeries, career: Career) => void;
}) {
  const [freshCareer, setFreshCareer] = useState(career);
  const [history, setHistory] = useState<MatchFeedback[]>([]);
  const [type, setType] = useState<"TEAM" | "INDIVIDUAL">("TEAM");
  const [option, setOption] = useState("");
  const [target, setTarget] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(!!series.nextDraftStarted);
  const [error, setError] = useState("");
  const [strategy, setStrategy] = useState<TeamStrategy>("BALANCED");
  const [substitute, setSubstitute] = useState(0);
  const [position, setPosition] = useState<Position>("TOP");
  const alive = useRef(true);
  const pending = useRef(false);
  const version = useRef(0);
  const path = `/match-series/${series.seriesId}`;
  const game = series.games.at(-1);
  const afterGameNumber = game?.seriesGameNumber ?? series.games.length;
  const managed = freshCareer.teams.find(
    (t) => t.isUserControlled && series.teams.some((s) => s.teamId === t.id),
  );
  const played =
    game?.teams.find((t) => t.teamId === managed?.id)?.playerStats ?? [];
  const players = [
    ...(managed?.starters ?? []),
    ...(managed?.benches ?? []),
  ].map((s) => s.careerPlayer);
  const candidates = players.filter((p) =>
    played.some((s) => s.careerPlayerId === p.id),
  );
  const currentHistory = history.filter(
    (f) => f.afterGameNumber === afterGameNumber,
  );
  const used = currentHistory.some((f) => f.type === type);
  const canWrite =
    ready && !busy && !locked && !!managed && series.status !== "COMPLETED";

  async function refresh(request: number) {
    const [talks, latestCareer, latestSeries] = await Promise.all([
      apiRequest<MatchFeedback[]>(`${path}/feedbacks`, { token }),
      apiRequest<Career>(`/careers/${career.id}`, { token }),
      apiRequest<MatchSeries>(path, { token }),
    ]);
    if (!alive.current || request !== version.current) return false;
    setHistory(talks);
    setFreshCareer(latestCareer);
    setLocked(
      !!latestSeries.nextDraftStarted || latestSeries.status === "COMPLETED",
    );
    setStrategy(
      latestCareer.teams.find((t) => t.isUserControlled)?.teamStrategy ??
        "BALANCED",
    );
    setReady(true);
    onSync(latestSeries, latestCareer);
    return true;
  }
  async function run(write?: () => Promise<unknown>) {
    if (!alive.current || pending.current || (write && !canWrite)) return;
    pending.current = true;
    const request = ++version.current;
    setBusy(true);
    setError("");
    onState({ busy: true, ready: false });
    let reconciled = false;
    try {
      if (write) await write();
      if (!alive.current) return;
      reconciled = await refresh(request);
      if (write && reconciled) setOption("");
    } catch (reason) {
      if (!alive.current || request !== version.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "세트 사이 정보를 불러오지 못했습니다.",
      );
      // A lost POST/PATCH may have committed. Never automatically submit it twice.
      if (write) {
        try {
          reconciled = await refresh(request);
        } catch {
          /* Keep writes locked until a successful read. */
        }
      }
    } finally {
      if (request === version.current) pending.current = false;
      if (alive.current && request === version.current) {
        setBusy(false);
        setReady(reconciled);
        onState({ busy: false, ready: reconciled });
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    pending.current = false;
    void run();
    const invalidate = () => {
      alive.current = false;
      version.current++;
    };
    return invalidate;
    // The flow keys this panel by account/save/series and completed set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selected = candidates.find((p) => p.id === target) ?? candidates[0];
  const send = () => {
    if (
      !canWrite ||
      used ||
      !OPTIONS[type].some((o) => o[0] === option) ||
      (type === "INDIVIDUAL" && !selected)
    )
      return;
    void run(() =>
      apiRequest(`${path}/feedback`, {
        token,
        method: "POST",
        body: {
          type,
          option,
          afterGameNumber,
          ...(type === "INDIVIDUAL" ? { careerPlayerId: selected!.id } : {}),
        },
      }),
    );
  };
  return (
    <section
      className="intermission-panel"
      aria-label="세트 사이 감독 피드백"
      aria-busy={busy}
    >
      <header>
        <span className="intermission-eyebrow">
          COACH'S ROOM · SET {afterGameNumber}
        </span>
        <h3>다음 세트를 준비하세요</h3>
        <p>
          피드백은 선택 사항입니다. 팀 전체 1회 + 개인 선수 1명에게 1회. 아무 말
          없이 다음 밴픽으로 넘어가도 됩니다.
        </p>
      </header>
      {error && (
        <p role="alert" className="intermission-error">
          {error}
        </p>
      )}
      {!ready && (
        <p role="status">
          {busy
            ? "최신 선수 상태와 피드백 기록을 불러오는 중…"
            : "저장 상태를 확인해야 다음 세트로 진행할 수 있습니다."}
        </p>
      )}
      {!busy && (!ready || error) && (
        <button type="button" onClick={() => void run()}>
          피드백 정보 다시 불러오기
        </button>
      )}
      {locked && (
        <p className="intermission-note">
          다음 밴픽이 이미 시작되었거나 시리즈가 끝났습니다. 피드백·선수 교체는
          잠겨 있습니다.
        </p>
      )}
      <div className="intermission-grid">
        <div className="intermission-talk">
          <div className="intermission-tabs" aria-label="피드백 종류">
            {(["TEAM", "INDIVIDUAL"] as const).map((t) => (
              <button
                type="button"
                key={t}
                aria-pressed={type === t}
                disabled={busy}
                onClick={() => {
                  setType(t);
                  setOption("");
                }}
              >
                {t === "TEAM" ? "팀 전체 피드백" : "개인 피드백"}
                {currentHistory.some((f) => f.type === t) ? " · 완료" : ""}
              </button>
            ))}
          </div>
          {type === "INDIVIDUAL" && (
            <label>
              직전 세트 출전 선수
              <select
                aria-label="개인 피드백 선수"
                value={selected?.id ?? ""}
                disabled={!canWrite || used}
                onChange={(e) => setTarget(Number(e.target.value))}
              >
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.playerCard.player.nickname} ·{" "}
                    {PERSONALITY[p.personality] ?? p.personality}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type === "INDIVIDUAL" && selected && (
            <p className="intermission-note">
              멘탈 {selected.currentMental} · 폼 {selected.form} · 감독 신뢰{" "}
              {selected.coachTrust} ·{" "}
              {PERSONALITY[selected.personality] ?? selected.personality}
            </p>
          )}
          <div className="feedback-options">
            {OPTIONS[type].map(([value, label, hint]) => (
              <button
                type="button"
                key={value}
                aria-pressed={option === value}
                disabled={!canWrite || used}
                onClick={() => setOption(value)}
              >
                <strong>{label}</strong>
                <small>{hint}</small>
              </button>
            ))}
          </div>
          <button
            className="feedback-confirm"
            type="button"
            disabled={
              !canWrite ||
              used ||
              !option ||
              (type === "INDIVIDUAL" && !selected)
            }
            onClick={send}
          >
            {used ? "이번 세트 피드백 완료" : "선택한 피드백 전달"}
          </button>
        </div>
        <aside className="intermission-adjustments">
          <h4>전략 수정</h4>
          <label>
            다음 세트 전술
            <select
              aria-label="세트 사이 전술"
              value={strategy}
              disabled={!canWrite}
              onChange={(e) => setStrategy(e.target.value as TeamStrategy)}
            >
              {Object.entries(STRATEGIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!canWrite || strategy === managed?.teamStrategy}
            onClick={() =>
              void run(() =>
                apiRequest(
                  `/careers/${career.id}/teams/${managed!.id}/strategy`,
                  { token, method: "PATCH", body: { strategy } },
                ),
              )
            }
          >
            전술 적용
          </button>
          <h4>선수 교체</h4>
          <p className="intermission-note">
            밴픽을 시작하기 전만 가능합니다. 다른 포지션 배치는 적응도에 따라
            능력치가 감소합니다.
          </p>
          <label>
            투입할 선수
            <select
              aria-label="세트 사이 투입 선수"
              disabled={!canWrite}
              value={substitute}
              onChange={(e) => setSubstitute(Number(e.target.value))}
            >
              <option value={0}>선수 선택</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.playerCard.player.nickname} ·{" "}
                  {managed?.benches.some((s) => s.careerPlayer.id === p.id)
                    ? "후보"
                    : "선발"}{" "}
                  · 컨디션 {p.condition}
                </option>
              ))}
            </select>
          </label>
          <label>
            선발 자리
            <select
              aria-label="세트 사이 선발 자리"
              disabled={!canWrite}
              value={position}
              onChange={(e) => setPosition(e.target.value as Position)}
            >
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p} ·{" "}
                  {managed?.starters.find((s) => s.starterPosition === p)
                    ?.careerPlayer.playerCard.player.nickname ?? "미등록"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={
              !canWrite ||
              !players.some((p) => p.id === substitute) ||
              managed?.starters.some(
                (s) =>
                  s.starterPosition === position &&
                  s.careerPlayer.id === substitute,
              )
            }
            onClick={() =>
              void run(() =>
                apiRequest(
                  `/careers/${career.id}/teams/${managed!.id}/starters/${position}/swap`,
                  {
                    token,
                    method: "PATCH",
                    body: { careerPlayerId: substitute },
                  },
                ),
              )
            }
          >
            선수 교체 적용
          </button>
        </aside>
      </div>
      <div className="feedback-reactions" aria-label="선수별 피드백 반응">
        {currentHistory.map((f) => (
          <article key={f.id}>
            <h4>
              {f.type === "TEAM" ? "팀 전체" : "개인"} ·{" "}
              {OPTIONS[f.type].find((o) => o[0] === f.option)?.[1] ?? f.option}
            </h4>
            {f.effects.map((e) => (
              <div className="feedback-player-reaction" key={e.careerPlayerId}>
                <strong>
                  {players.find((p) => p.id === e.careerPlayerId)?.playerCard
                    .player.nickname ?? `선수 ${e.careerPlayerId}`}{" "}
                  <small>{PERSONALITY[e.personality] ?? e.personality}</small>
                </strong>
                <p>
                  {e.reaction?.text ?? "이전 버전에서 저장한 피드백입니다."}
                </p>
                <div className="feedback-deltas">
                  <span>멘탈 {sign(e.mentalDelta)}</span>
                  <span>폼 {sign(e.formDelta)}</span>
                  <span>감독 신뢰 {sign(e.coachTrustDelta)}</span>
                  {e.reaction && (
                    <>
                      <span>자신감 {sign(e.reaction.confidence)}</span>
                      <span>동기 {sign(e.reaction.motivation)}</span>
                      <span>부담 {sign(e.reaction.pressure)}</span>
                      <span>공격성 {sign(e.reaction.aggression)}</span>
                      <span>위험 감수 {sign(e.reaction.riskTaking)}</span>
                      <span>캐리 역할 {sign(e.reaction.carryBonus)}</span>
                      {e.reaction.chemistry !== 0 && (
                        <span>팀 분위기 {sign(e.reaction.chemistry)}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
      <p className="intermission-note">
        감독 신뢰는 유지됩니다. 멘탈·폼·자신감·부담 등은 다음 세트 한정
        보정이며, 교체되어 출전하지 않는 선수의 보정은 적용되지 않습니다. 수용
        성향은 성격과 감독 신뢰로 계산합니다.
      </p>
    </section>
  );
}
