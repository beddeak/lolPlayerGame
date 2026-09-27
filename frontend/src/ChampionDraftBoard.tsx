import { useCallback, useEffect, useMemo, useState } from "react";
import ClubLogo from "./ClubLogo";
import DraftSoundControl from "./DraftSoundControl";
import type { LiveDraftControls } from "./DraftBoard";
import {
  DRAFT_POSITIONS,
  POSITION_SHORT,
  type DraftCatalog,
  type DraftSide,
} from "./draft-preview";
import {
  swapChampion,
  type ChampionLineup,
  type Champion,
} from "./champion-draft";
import type { CareerTeam, Position } from "./types";
import "./ChampionDraftBoard.css";
const EMPTY_CHAMPIONS: Champion[] = [];

export interface ChampionDraftControls extends LiveDraftControls {
  assignments?: Record<DraftSide, ChampionLineup>;
  assignmentsConfirmed: boolean;
  assignmentRevision: number;
  onLineup: (
    entries: Array<{ position: Position; championId: string }> | undefined,
    revision: number,
  ) => void;
}
export default function ChampionDraftBoard({
  catalog,
  blue,
  red,
  managedTeamId,
  matchLabel,
  onClose,
  live,
}: {
  catalog: DraftCatalog;
  blue: CareerTeam;
  red: CareerTeam;
  managedTeamId: number;
  matchLabel: string;
  onClose: () => void;
  live: ChampionDraftControls;
}) {
  const champions = catalog.champions ?? EMPTY_CHAMPIONS;
  const byId = useMemo(
    () => new Map(champions.map((c) => [c.id, c])),
    [champions],
  );
  const own: DraftSide = blue.id === managedTeamId ? "BLUE" : "RED";
  const step = live.state.actions.length,
    turn = catalog.turns[step];
  const selecting = !!turn,
    assigning = !selecting && !live.assignmentsConfirmed;
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((live.state.deadline - Date.now()) / 1000)),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Position | "ALL">("ALL");
  const [selection, setSelection] = useState<{
    id: string;
    step: number;
  } | null>(null);
  const selected = selection?.step === step ? selection.id : null;
  const [edited, setEdited] = useState<{
    revision: number;
    lineup: ChampionLineup;
  } | null>(null);
  const lineup =
    edited?.revision === live.assignmentRevision && !live.assignmentsConfirmed
      ? edited.lineup
      : live.assignments?.[own];
  const [drag, setDrag] = useState<string | null>(null);
  useEffect(() => {
    if (live.assignmentsConfirmed) return;
    const updateClock = () =>
      setRemaining(
        Math.max(0, Math.ceil((live.state.deadline - Date.now()) / 1000)),
      );
    updateClock();
    const tick = window.setInterval(() => {
      // Poll the deadline precisely, but render only when the displayed second changes.
      updateClock();
      if (live.busy || live.error || Date.now() < live.state.deadline) return;
      if (selecting) live.onAction(null, step);
      else live.onLineup(undefined, live.assignmentRevision);
    }, 250);
    const ai =
      selecting && turn.side !== own && !live.busy && !live.error
        ? window.setTimeout(() => live.onAction(null, step), 1200)
        : undefined;
    return () => {
      window.clearInterval(tick);
      if (ai !== undefined) window.clearTimeout(ai);
    };
  }, [live, step, selecting, turn?.side, own]);
  const blockedIds = useMemo(() => {
    const result = new Map<string, string>();
    for (const action of live.state.actions)
      result.set(action.variantId, action.kind === "BAN" ? "밴됨" : "선택됨");
    for (const id of live.state.unavailable ?? []) result.set(id, "피어리스");
    return result;
  }, [live.state.actions, live.state.unavailable]);
  const blocked = (id: string) => blockedIds.get(id);
  const pool = useMemo(
    () =>
      champions.filter(
        (c) =>
          (filter === "ALL" || c.recommendedPositions.includes(filter)) &&
          `${c.name} ${c.id} ${c.title}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [champions, filter, query],
  );
  const current = selected ? byId.get(selected) : undefined;
  const selectChampion = useCallback(
    (id: string, selectionStep: number) =>
      setSelection({ id, step: selectionStep }),
    [],
  );
  // Keep the entire 173-card subtree stable during clock/audio/connection updates.
  const poolTiles = useMemo(
    () =>
      pool.map((c) => {
        const status = blockedIds.get(c.id);
        return (
          <button
            key={c.id}
            className={`champion-pool-card ${selected === c.id ? "is-selected" : ""}`}
            disabled={!!status}
            aria-pressed={selected === c.id}
            aria-label={`${c.name}${status ? ` · ${status}` : ""}`}
            title={`${c.name} · ${status ?? c.recommendedPositions.map((p) => POSITION_SHORT[p]).join(" / ")}`}
            data-status={status}
            onClick={() => selectChampion(c.id, step)}
          >
            <span className="champion-pool-art">
              <ChampionPortrait champion={c} />
              {status && <span className="champion-pool-status">{status}</span>}
            </span>
            <span className="champion-pool-caption">
              <strong>{c.name}</strong>
              <small>
                {c.recommendedPositions
                  .map((p) => POSITION_SHORT[p])
                  .join(" / ")}
              </small>
            </span>
          </button>
        );
      }),
    [pool, blockedIds, selected, step, selectChampion],
  );
  const disabled = live.busy || !!live.error;
  const myTurn = selecting ? turn.side === own : assigning;
  const actingTeam = selecting
    ? turn.side === "BLUE"
      ? blue
      : red
    : own === "BLUE"
      ? blue
      : red;
  const phase = selecting ? turn.kind : assigning ? "ASSIGN" : "READY";
  const turnState = live.error
    ? "error"
    : live.busy
      ? "saving"
      : live.assignmentsConfirmed
        ? "ready"
        : myTurn
          ? "mine"
          : "opponent";
  const turnLabel = live.error
    ? "연결 확인 필요"
    : live.busy
      ? "서버에 저장 중"
      : live.assignmentsConfirmed
        ? "준비 완료"
        : myTurn
          ? "지금 내 차례"
          : "상대 선택 중";
  const prompt = live.assignmentsConfirmed
    ? "조합 확정"
    : assigning
      ? "챔피언 포지션 배정"
      : myTurn
        ? turn.kind === "BAN"
          ? "금지할 챔피언을 선택하세요"
          : "플레이할 챔피언을 선택하세요"
        : `${actingTeam.code}의 ${turn.kind === "BAN" ? "밴" : "픽"}을 기다리세요`;
  const turnHelp = live.error
    ? "서버 상태를 다시 불러와 주세요."
    : live.busy
      ? "선택 결과를 확인하고 있습니다…"
      : live.assignmentsConfirmed
        ? "경기 시작을 누르면 이번 세트를 진행합니다."
        : assigning
          ? "5개 포지션에 배치한 뒤 확정하세요."
          : myTurn
            ? `챔피언 클릭 → ${turn.kind === "BAN" ? "밴" : "픽"} 확정 · 30초 후 자동 선택`
            : "목록을 미리 살펴볼 수 있습니다. 아직 확정할 수 없습니다.";
  const myPicks = live.state.actions
    .filter((a) => a.kind === "PICK" && a.side === own)
    .map((a) => a.variantId);
  const validLineup =
    lineup &&
    DRAFT_POSITIONS.every((p) => myPicks.includes(lineup[p])) &&
    new Set(Object.values(lineup)).size === 5;
  const change = (position: Position, id: string) => {
    if (!disabled && assigning && lineup)
      setEdited({
        revision: live.assignmentRevision,
        lineup: swapChampion(lineup, position, id),
      });
  };
  const panel = (team: CareerTeam, side: DraftSide) => {
    const picks = live.state.actions.filter(
      (a) => a.kind === "PICK" && a.side === side,
    );
    const bans = live.state.actions.filter(
      (a) => a.kind === "BAN" && a.side === side,
    );
    const placed = side === own ? lineup : live.assignments?.[side];
    return (
      <aside
        className={`champion-team champion-team-${side.toLowerCase()}`}
        aria-label={`${team.code} 조합`}
        data-active={selecting && turn.side === side}
      >
        <header>
          <ClubLogo club={team} />
          <div>
            <small>
              {side} {side === own ? "· MY TEAM" : ""}
            </small>
            <h3>{team.code}</h3>
            <span className="champion-team-turn">
              {selecting && turn.side === side
                ? `${side === own ? "내 차례" : "상대 차례"} · ${turn.kind === "BAN" ? "밴" : "픽"} 중`
                : side === own
                  ? "내 팀"
                  : "상대 팀"}
            </span>
          </div>
        </header>
        {DRAFT_POSITIONS.map((p, i) => {
          const champion = byId.get(placed?.[p] ?? picks[i]?.variantId);
          const player = team.starters.find((s) => s.starterPosition === p)
            ?.careerPlayer.playerCard.player.nickname;
          return (
            <div
              className="champion-team-pick"
              key={p}
              data-active={
                selecting &&
                turn.side === side &&
                turn.kind === "PICK" &&
                picks.length === i
              }
            >
              <span>{placed ? POSITION_SHORT[p] : `${i + 1} PICK`}</span>
              {champion ? (
                <ChampionPortrait champion={champion} />
              ) : (
                <span className="champion-empty">?</span>
              )}
              <div>
                <strong>
                  {champion?.name ??
                    (selecting &&
                    turn.side === side &&
                    turn.kind === "PICK" &&
                    picks.length === i
                      ? "지금 선택 중…"
                      : "선택 대기")}
                </strong>
                <small>{placed ? player : "포지션은 픽 종료 후 배정"}</small>
              </div>
            </div>
          );
        })}
        <h4>BANS · {bans.length}/5</h4>
        <div className="champion-team-bans">
          {Array.from({ length: 5 }, (_, index) => {
            const c = byId.get(bans[index]?.variantId);
            return (
              <div
                key={index}
                title={c?.name ?? `${index + 1}번째 밴`}
                data-active={
                  selecting &&
                  turn.side === side &&
                  turn.kind === "BAN" &&
                  bans.length === index
                }
              >
                {c ? (
                  <>
                    <ChampionPortrait champion={c} />
                    <span>×</span>
                  </>
                ) : (
                  <span className="champion-ban-empty">{index + 1}</span>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    );
  };
  return (
    <div
      className="champion-draft-board"
      data-turn={turnState}
      data-phase={phase}
      data-urgent={myTurn && !disabled && remaining > 0 && remaining <= 5}
    >
      <header className="champion-draft-heading">
        <div className="champion-match-identity">
          <small>CHAMPION SELECT · SET {live.gameNumber}</small>
          <strong>
            {blue.code} <span>VS</span> {red.code}
          </strong>
          <p>
            {matchLabel} · 선픽{" "}
            {live.firstPickTeamId === red.id ? red.code : blue.code}
          </p>
        </div>
        <div className="champion-turn-prompt">
          <strong
            className="champion-clock"
            role="timer"
            aria-label={
              live.assignmentsConfirmed
                ? "배치 완료"
                : `남은 시간 ${remaining}초`
            }
          >
            {live.assignmentsConfirmed ? "✓" : remaining}
          </strong>
          <div role="status" aria-live="polite" aria-atomic="true">
            <span className="champion-turn-label">
              {turnLabel}
              {selecting &&
                ` · ${turn.kind === "BAN" ? "BAN 금지" : "PICK 선택"}`}
            </span>
            <h2>{prompt}</h2>
            <p>{turnHelp}</p>
          </div>
        </div>
        <div className="champion-header-actions">
          <DraftSoundControl
            turnKey={`set:${live.gameNumber}:${step}:${phase}`}
            blocked={disabled}
            confirmations={step + (live.assignmentsConfirmed ? 1 : 0)}
            confirmationKind={
              live.assignmentsConfirmed
                ? null
                : (live.state.actions.at(-1)?.kind ?? null)
            }
          />
          <button disabled={live.busy} onClick={onClose}>
            닫기
          </button>
        </div>
      </header>
      <ol className="champion-turn-sequence" aria-label="밴픽 진행 순서">
        {catalog.turns.map((item, index) => (
          <li
            key={index}
            aria-current={selecting && index === step ? "step" : undefined}
            data-side={item.side}
            data-owner={item.side === own ? "mine" : "opponent"}
            data-state={
              index < step ? "done" : index === step ? "current" : "waiting"
            }
            title={`${index + 1}턴 · ${item.side === own ? "내 팀" : "상대 팀"} ${item.kind === "BAN" ? "밴" : "픽"}${index < step ? " 완료" : ""}`}
          >
            <span>{item.side === own ? "나" : "상대"}</span>
            <b>{item.kind === "BAN" ? "밴" : "픽"}</b>
            <i aria-hidden="true">{index < step ? "✓" : index + 1}</i>
          </li>
        ))}
      </ol>
      <div className="champion-draft-note">
        모든 챔피언을 모든 포지션에 배치할 수 있습니다. 추천 포지션은 필터일 뿐
        선택 제한이 아닙니다.
        <details>
          <summary>
            피어리스 제한 {live.state.unavailable?.length ?? 0}명
          </summary>
          {live.state.unavailable
            ?.map((id) => byId.get(id)?.name ?? id)
            .join(" · ") || "이전 세트 사용 챔피언 없음"}
        </details>
      </div>
      <div className="champion-draft-layout">
        {panel(blue, "BLUE")}
        <section
          className={`champion-draft-center${selecting ? " is-selecting" : ""}`}
          aria-label={selecting ? "챔피언 선택" : "포지션 배정"}
        >
          {selecting ? (
            <>
              <div className="champion-filters">
                <input
                  aria-label="챔피언 검색"
                  placeholder="챔피언 이름 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div>
                  {(["ALL", ...DRAFT_POSITIONS] as const).map((p) => (
                    <button
                      key={p}
                      aria-pressed={filter === p}
                      onClick={() => setFilter(p)}
                    >
                      {p === "ALL" ? "전체" : POSITION_SHORT[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="champion-pool"
                aria-label="전체 챔피언 목록"
                role="region"
                tabIndex={0}
              >
                {poolTiles}
                {!pool.length && <p>검색 결과가 없습니다.</p>}
              </div>
              <div className="champion-detail" aria-live="polite">
                {current ? (
                  <>
                    <div>
                      <h3>
                        {current.name} <small>{current.title}</small>
                      </h3>
                      <p>
                        {current.early >= 90
                          ? "초반 압박에 강합니다. "
                          : current.late >= 94
                            ? "후반 성장이 강점입니다. "
                            : ""}
                        {current.engage >= 85 ? "교전 개시에 강합니다. " : ""}
                        {current.frontline >= 85
                          ? "앞라인을 맡기 좋습니다. "
                          : ""}
                        {current.protection >= 85
                          ? "아군 보호에 강합니다. "
                          : ""}
                        {current.damage < 45
                          ? "직접 피해량이 낮아 별도 딜러가 필요합니다. "
                          : ""}
                        {current.objectiveDamage < 40
                          ? "타워·오브젝트 공격력이 부족합니다. "
                          : ""}
                        {current.teamFight < 60
                          ? "정면 한타보다 사이드 운영에 적합합니다."
                          : ""}
                      </p>
                    </div>
                    <div className="champion-profile">
                      {(
                        [
                          ["초반", "early"],
                          ["중반", "mid"],
                          ["후반", "late"],
                          ["라인전", "lanePower"],
                          ["한타", "teamFight"],
                          ["앞라인", "frontline"],
                          ["이니시", "engage"],
                          ["보호", "protection"],
                          ["딜 수행", "damage"],
                          ["라인 정리", "waveClear"],
                          ["오브젝트 딜", "objectiveDamage"],
                        ] as const
                      ).map(([label, key]) => (
                        <span key={key}>
                          {label}
                          <b>{current[key]}</b>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p>챔피언을 눌러 특성과 조합에 필요한 역할을 확인하세요.</p>
                )}
              </div>
            </>
          ) : (
            <div className="champion-lineup-editor">
              <h3>
                {live.assignmentsConfirmed
                  ? "선수별 챔피언 확정"
                  : "5명을 원하는 포지션으로 배정하세요"}
              </h3>
              <p>
                드래그하거나 선택 상자를 바꾸면 두 챔피언의 자리가 교환됩니다.
                시간 종료 시 서버의 추천 배치로 확정됩니다.
              </p>
              {lineup &&
                DRAFT_POSITIONS.map((p) => {
                  const c = byId.get(lineup[p]);
                  const player = (own === "BLUE" ? blue : red).starters.find(
                    (s) => s.starterPosition === p,
                  )?.careerPlayer.playerCard.player.nickname;
                  return (
                    <div
                      key={p}
                      className="champion-lineup-row"
                      draggable={!disabled && assigning}
                      onDragStart={(e) => {
                        if (!c) return;
                        setDrag(c.id);
                        e.dataTransfer.setData("text/plain", c.id);
                      }}
                      onDragEnd={() => setDrag(null)}
                      onDragOver={(e) => {
                        if (assigning && !disabled) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = drag ?? e.dataTransfer.getData("text/plain");
                        change(p, id);
                        setDrag(null);
                      }}
                    >
                      <b>{POSITION_SHORT[p]}</b>
                      {c && <ChampionPortrait champion={c} />}
                      <div>
                        <strong>{player}</strong>
                        <small>
                          {c?.name} · 포지션 적합도 {c?.roleRatings[p]}
                        </small>
                      </div>
                      <select
                        aria-label={`${POSITION_SHORT[p]} 챔피언 배정`}
                        value={lineup[p]}
                        disabled={disabled || !assigning}
                        onChange={(e) => change(p, e.target.value)}
                      >
                        {myPicks.map((id) => (
                          <option key={id} value={id}>
                            {byId.get(id)?.name ?? id}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              <p className="champion-balance-note">
                적합도가 낮아도 배치는 가능합니다. 챔피언 특성·상대 상성·팀
                조합에 따라 경기 성능이 달라집니다.
              </p>
            </div>
          )}
        </section>
        {panel(red, "RED")}
      </div>
      <footer className="champion-draft-footer">
        <div>
          <strong className="champion-action-hint">
            {live.error
              ? "연결을 확인해 주세요"
              : live.busy
                ? "선택 저장 중…"
                : selecting
                  ? myTurn
                    ? current
                      ? `${current.name} · ${turn.kind === "BAN" ? "밴" : "픽"} 확정 대기`
                      : "챔피언을 먼저 선택하세요"
                    : `${actingTeam.code} 선택 중 · 다음 내 차례를 준비하세요`
                  : assigning
                    ? "배치를 확인한 뒤 확정하세요"
                    : "모든 준비가 끝났습니다"}
          </strong>
          <small>
            Riot Data Dragon {catalog.championDataVersion} · {champions.length}{" "}
            CHAMPIONS
          </small>
          <p>
            시뮬레이션 밸런스 {catalog.championBalanceVersion} · 테스트용 자체
            평가 수치 / 공식 승률 아님
          </p>
          {live.error && (
            <p role="alert">
              {live.error}{" "}
              <button disabled={live.busy} onClick={live.onReload}>
                서버 상태 다시 불러오기
              </button>
            </p>
          )}
        </div>
        {selecting ? (
          <button
            className="champion-confirm"
            disabled={
              disabled || turn.side !== own || !current || !!blocked(current.id)
            }
            onClick={() => {
              if (current) live.onAction(current.id, step);
            }}
          >
            {turn.side !== own
              ? "상대 선택 중"
              : turn.kind === "BAN"
                ? "밴 확정"
                : "픽 확정"}
          </button>
        ) : assigning ? (
          <button
            className="champion-confirm"
            disabled={disabled || !validLineup}
            onClick={() => {
              if (lineup && validLineup)
                live.onLineup(
                  DRAFT_POSITIONS.map((position) => ({
                    position,
                    championId: lineup[position],
                  })),
                  live.assignmentRevision,
                );
            }}
          >
            배치 확정
          </button>
        ) : (
          <button
            className="champion-confirm"
            disabled={disabled}
            onClick={live.onPlay}
          >
            경기 시작
          </button>
        )}
      </footer>
    </div>
  );
}

function ChampionPortrait({ champion }: { champion: Champion }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return failedUrl === champion.imageUrl ? (
    <span className="champion-image-fallback">{champion.name}</span>
  ) : (
    <img
      src={champion.imageUrl}
      alt={champion.name}
      loading="lazy"
      decoding="async"
      width={120}
      height={120}
      onError={() => setFailedUrl(champion.imageUrl)}
    />
  );
}
