import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import ClubLogo from "./ClubLogo";
import { describeVariant } from "./variant-description";
import {
  advancePreview,
  choiceReason,
  draftPicks,
  restorePreview,
  suggestPreview,
  DRAFT_POSITIONS,
  POSITION_SHORT,
} from "./draft-preview";
import type {
  DraftCatalog,
  DraftPreviewState,
  DraftSide,
  DraftVariant,
} from "./draft-preview";
import type { CareerTeam, Position } from "./types";

const SIDE_LABEL = { BLUE: "블루", RED: "레드" };
export interface LiveDraftControls {
  firstPickTeamId?: number;
  state: DraftPreviewState;
  gameNumber: number;
  busy: boolean;
  error: string;
  onAction: (variantId: string | null, expectedStep: number) => void;
  onPlay: () => void;
  onReload: () => void;
}
function loadSession(key: string, catalog: DraftCatalog) {
  try {
    return restorePreview(
      window.sessionStorage.getItem(key),
      catalog,
      Date.now(),
    );
  } catch {
    return restorePreview(null, catalog, Date.now());
  }
}

export default function DraftBoard({
  catalog,
  blue,
  red,
  managedTeamId,
  matchLabel,
  storageKey,
  onClose,
  live,
}: {
  catalog: DraftCatalog;
  blue: CareerTeam;
  red: CareerTeam;
  managedTeamId: number;
  matchLabel: string;
  storageKey: string;
  onClose: () => void;
  live?: LiveDraftControls;
}) {
  const [localState, setState] = useState<DraftPreviewState>(
    () => live?.state ?? loadSession(storageKey, catalog),
  );
  const state = live?.state ?? localState;
  const current = useRef(state);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
    if (live) current.current = live.state;
  }, [live]);
  const alive = useRef(true);
  const [now, setNow] = useState(() => Date.now());
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const step = state.actions.length;
  const turn = catalog.turns[step];
  const complete = !turn;
  const ownSide: DraftSide = blue.id === managedTeamId ? "BLUE" : "RED";
  const ownTurn = turn?.side === ownSide;
  const selected = catalog.variants.find(
    (variant) => variant.id === selectedId,
  );
  const descriptions = useMemo(
    () =>
      new Map(
        catalog.variants.map((variant) => [
          variant.id,
          describeVariant(variant),
        ]),
      ),
    [catalog.variants],
  );
  const selectedDescription = selected
    ? descriptions.get(selected.id)!
    : undefined;
  const remaining = complete
    ? 0
    : Math.max(0, Math.ceil((state.deadline - now) / 1000));
  const picksBefore = state.actions.filter(
    (action) => action.side === turn?.side && action.kind === turn?.kind,
  ).length;
  const turnLabel = turn
    ? `${SIDE_LABEL[turn.side]} ${picksBefore + 1}${turn.kind === "PICK" ? "픽" : "밴"}`
    : "양 팀 조합 완성";

  const persist = useCallback(
    (next: DraftPreviewState) => {
      current.current = next;
      setState(next);
      try {
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify({ version: catalog.version, state: next }),
        );
      } catch {
        setStorageWarning(true);
      }
    },
    [storageKey, catalog.version],
  );
  const commit = useCallback(
    (variantId: string | null, automatic: boolean, expectedStep: number) => {
      if (!alive.current || current.current.actions.length !== expectedStep)
        return;
      const snapshot = current.current;
      const currentTurn = catalog.turns[expectedStep];
      if (!currentTurn || (!automatic && currentTurn.side !== ownSide)) return;
      if (liveRef.current) {
        if (liveRef.current.busy || liveRef.current.error) return;
        liveRef.current.onAction(automatic ? null : variantId, expectedStep);
        setSelectedId(null);
        return;
      }
      // If the click arrived after the deadline, apply the same timeout policy.
      const expired = snapshot.deadline <= Date.now();
      const auto = automatic || expired;
      const choice = auto ? suggestPreview(snapshot, catalog)?.id : variantId;
      if (!choice) return;
      const next = advancePreview(snapshot, catalog, choice, auto, Date.now());
      if (next === snapshot) return;
      persist(next);
      setNow(Date.now());
      setSelectedId(null);
      setConfirmReset(false);
    },
    [catalog, ownSide, persist],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (complete) return;
    const clock = window.setInterval(() => {
      if (!alive.current) return;
      setNow(Date.now());
      if (current.current.deadline <= Date.now()) commit(null, true, step);
    }, 200);
    const opponent = !ownTurn
      ? window.setTimeout(() => commit(null, true, step), 1400)
      : null;
    return () => {
      window.clearInterval(clock);
      if (opponent !== null) window.clearTimeout(opponent);
    };
  }, [step, complete, ownTurn, commit]);

  const visible = catalog.variants.filter(
    (variant) =>
      (position === "ALL" || variant.position === position) &&
      `${variant.name} ${variant.id} ${POSITION_SHORT[variant.position]} ${descriptions.get(variant.id)!.short} ${descriptions.get(variant.id)!.timing}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const legalCount = visible.filter(
    (variant) => !choiceReason(variant, state, catalog),
  ).length;
  const close = () => {
    if (!alive.current || liveRef.current?.busy) return;
    if (!liveRef.current) alive.current = false;
    onClose();
  };
  const reset = () => {
    persist({ actions: [], deadline: Date.now() + catalog.turnSeconds * 1000 });
    setNow(Date.now());
    setSelectedId(null);
    setConfirmReset(false);
  };
  return (
    <div
      className={`draft-board ${turn?.side === "RED" ? "draft-red-turn" : "draft-blue-turn"} ${complete ? "draft-complete" : ""}`}
    >
      <div className="draft-utility-bar">
        <div>
          <span className="draft-mode-badge">
            {live ? "CHAMPION SELECT" : "DRAFT PREVIEW"}
          </span>
          <span>{matchLabel}</span>
          <span className="draft-set-label">SET {live?.gameNumber ?? 1}</span>
        </div>
        <button
          autoFocus
          className="draft-exit"
          disabled={live?.busy}
          type="button"
          onClick={close}
          aria-label="밴픽 화면 닫기"
        >
          나가기 <span aria-hidden="true">×</span>
        </button>
      </div>
      {live && (
        <div className="draft-fearless-summary">
          <strong>
            선픽: {live.firstPickTeamId === red.id ? red.code : blue.code} ·
            피어리스 제한 {state.unavailable?.length ?? 0}개
          </strong>
          {!!state.unavailable?.length && (
            <details>
              <summary>이전 세트에서 사용한 Variant 보기</summary>
              <p>
                {state.unavailable
                  .map(
                    (id) =>
                      catalog.variants.find((v) => v.id === id)?.name ?? id,
                  )
                  .join(" · ")}
              </p>
            </details>
          )}
        </div>
      )}
      <header className="draft-match-header">
        <div className="draft-club-heading blue">
          <ClubLogo club={blue} />
          <div>
            <small>BLUE SIDE {ownSide === "BLUE" ? "· MY CLUB" : ""}</small>
            <strong>{blue.code}</strong>
            <span>{blue.name}</span>
          </div>
        </div>
        <div className="draft-current-phase">
          <div
            className="draft-countdown"
            role="timer"
            aria-label={`선택 시간 ${remaining}초`}
            style={
              {
                "--clock-progress": `${(remaining / catalog.turnSeconds) * 100}%`,
              } as CSSProperties
            }
            data-urgent={!complete && remaining <= 5}
          >
            <span>{complete ? "✓" : String(remaining).padStart(2, "0")}</span>
          </div>
          <div>
            <span className="draft-eyebrow">
              {complete
                ? "DRAFT COMPLETE"
                : turn.kind === "BAN"
                  ? "BAN PHASE"
                  : "PICK PHASE"}
            </span>
            <h2 aria-live="polite">{turnLabel}</h2>
            <p>
              {complete
                ? "선택한 조합을 확인하세요"
                : ownTurn
                  ? "내 차례 · Variant를 선택하고 확정하세요"
                  : "상대 구단이 선택하고 있습니다"}
            </p>
          </div>
        </div>
        <div className="draft-club-heading red">
          <div>
            <small>RED SIDE {ownSide === "RED" ? "· MY CLUB" : ""}</small>
            <strong>{red.code}</strong>
            <span>{red.name}</span>
          </div>
          <ClubLogo club={red} />
        </div>
      </header>

      <div className="draft-sequence" aria-label="밴픽 진행 순서">
        {catalog.turns.map((value, index) => (
          <span
            key={index}
            className={`${value.side.toLowerCase()} ${index < step ? "done" : index === step ? "current" : ""}`}
            aria-current={index === step ? "step" : undefined}
            title={`${index + 1}. ${SIDE_LABEL[value.side]} ${value.kind === "BAN" ? "밴" : "픽"}`}
          >
            <i>{value.kind === "BAN" ? "×" : "◆"}</i>
            <b>{index + 1}</b>
          </span>
        ))}
      </div>

      <main className="draft-arena">
        <DraftTeamPanel
          team={blue}
          side="BLUE"
          state={state}
          catalog={catalog}
          own={ownSide === "BLUE"}
          active={turn?.side === "BLUE"}
          selected={ownTurn && turn?.kind === "PICK" ? selected : undefined}
        />
        <section className="draft-pool" aria-label="챔피언 Variant 선택판">
          <div className="draft-pool-toolbar">
            <div
              className="draft-position-filters"
              role="group"
              aria-label="포지션 필터"
            >
              {(["ALL", ...DRAFT_POSITIONS] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={position === value}
                  onClick={() => setPosition(value)}
                >
                  {value === "ALL" ? "전체" : POSITION_SHORT[value]}
                </button>
              ))}
            </div>
            <label className="draft-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Variant 검색"
                placeholder="유형 / 한타 강함 / 후반 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="draft-pool-caption">
            <span>
              {complete
                ? "최종 조합 확인"
                : ownTurn
                  ? "선택할 챔피언 유형"
                  : "상대 턴 · 다음 선택을 살펴보세요"}
            </span>
            <small>
              {legalCount} AVAILABLE / {visible.length}
            </small>
          </div>
          {selected && selectedDescription ? (
            <aside
              className="draft-variant-guide"
              aria-label="선택한 유형 설명"
              aria-live="polite"
            >
              <header>
                <span>{turn?.kind === "BAN" ? "밴 검토" : "유형 분석"}</span>
                <strong>{selected.name}</strong>
                <b>{selectedDescription.timing}</b>
              </header>
              <p className="draft-guide-summary">
                {selectedDescription.summary}
              </p>
              <p className="draft-guide-timing">
                {selectedDescription.timingDetail}
              </p>
              <ul className="draft-guide-traits">
                {selectedDescription.traits.map((trait) => (
                  <li key={trait.label} className={`trait-${trait.tone}`}>
                    <span>{trait.label}</span> <b>{trait.value}</b>{" "}
                    <em>{trait.detail}</em>
                  </li>
                ))}
              </ul>
              <small title="라인전·한타: 80 이상 강함, 70~79 무난, 69 이하 약함. 시간대 설명은 초·중·후반 수치를 비교합니다.">
                기본 유형 수치 기준 · 선수 상태와 상대 조합은 별도 반영
              </small>
            </aside>
          ) : (
            <p className="draft-guide-hint">
              카드를 누르면 강한 시간대와 약점을 확인할 수 있습니다. 선택 후
              확정해야 밴·픽에 반영됩니다.
            </p>
          )}
          <div className="draft-variant-grid">
            {visible.map((variant) => {
              const reason = choiceReason(variant, state, catalog);
              const taken = state.actions.find(
                (action) => action.variantId === variant.id,
              );
              const description = descriptions.get(variant.id)!;
              return (
                <button
                  type="button"
                  key={variant.id}
                  className={`draft-variant-tile pos-${variant.position} ${selectedId === variant.id ? "selected" : ""} ${taken ? `taken ${taken.kind.toLowerCase()}` : ""}`}
                  aria-label={`${POSITION_SHORT[variant.position]} ${variant.name}${reason ? ` · ${reason}` : ""}`}
                  aria-pressed={selectedId === variant.id}
                  aria-description={`${description.short}. ${description.timingDetail}`}
                  disabled={complete}
                  title={`${variant.name} · ${description.short}\n${description.timingDetail}${reason ? `\n${reason}` : ""}`}
                  onClick={() => setSelectedId(variant.id)}
                >
                  <span className="draft-variant-art">
                    <VariantSigil variant={variant} />
                    <span className="draft-variant-letter">
                      {variant.variant}
                    </span>
                    <span className="draft-variant-position">
                      {POSITION_SHORT[variant.position]}
                    </span>
                    {taken && (
                      <span className="draft-taken-mark">
                        {taken.kind === "BAN"
                          ? "BANNED"
                          : `${SIDE_LABEL[taken.side]} PICK`}
                      </span>
                    )}
                  </span>
                  <strong>{variant.typeName}</strong>
                  <span className="draft-tile-summary">
                    {description.short}
                  </span>
                  <small>
                    {variant.variant} · {description.timing}
                  </small>
                </button>
              );
            })}
            {!visible.length && (
              <p className="draft-no-results">
                검색 결과가 없습니다. 다른 유형이나 포지션을 선택해 주세요.
              </p>
            )}
          </div>
          <div className="draft-pool-footnote">
            <span>◆ 유형 × Variant</span>
            <span>실제 챔피언 대신 성능 프로필로 선택</span>
          </div>
        </section>
        <DraftTeamPanel
          team={red}
          side="RED"
          state={state}
          catalog={catalog}
          own={ownSide === "RED"}
          active={turn?.side === "RED"}
          selected={ownTurn && turn?.kind === "PICK" ? selected : undefined}
        />
      </main>

      <footer className="draft-bottom-panel">
        <section
          className="draft-selection-detail"
          aria-label="선택한 Variant 상세"
        >
          {selected ? (
            <>
              <div className={`draft-detail-icon pos-${selected.position}`}>
                <VariantSigil variant={selected} />
                <b>{selected.variant}</b>
              </div>
              <div className="draft-detail-name">
                <small>
                  {POSITION_SHORT[selected.position]} · VARIANT{" "}
                  {selected.variant}
                </small>
                <h3>{selected.name}</h3>
                <span>챔피언 숙련도 · 미설정</span>
              </div>
              <div className="draft-phase-stats">
                {(
                  [
                    ["EARLY", selected.early],
                    ["MID", selected.mid],
                    ["LATE", selected.late],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <i>
                      <b style={{ width: `${value}%` }} />
                    </i>
                  </div>
                ))}
              </div>
              <div className="draft-profile-stats">
                <span>
                  라인전 <b>{selected.lanePower}</b>
                </span>
                <span>
                  한타 <b>{selected.teamFight}</b>
                </span>
                <span>
                  성장성 <b>{selected.scaling}</b>
                </span>
              </div>
            </>
          ) : (
            <div className="draft-selection-placeholder">
              <span aria-hidden="true">◇</span>
              <div>
                <h3>
                  {complete ? "DRAFT LOCKED IN" : "챔피언 유형을 선택하세요"}
                </h3>
                <p>
                  {complete
                    ? "블루 · 레드 각 5픽, 5밴이 완료되었습니다."
                    : "Variant의 초반·중반·후반 성능을 비교할 수 있습니다."}
                </p>
              </div>
            </div>
          )}
        </section>
        <div className="draft-actions">
          {complete ? (
            <button
              type="button"
              className="draft-lock-button"
              disabled={live?.busy || !!live?.error}
              onClick={live ? live.onPlay : close}
            >
              {live
                ? live.busy
                  ? "경기 처리 중…"
                  : `${live.gameNumber}세트 경기 시작 →`
                : "조합 확인 완료 →"}
            </button>
          ) : (
            <button
              type="button"
              className={`draft-lock-button ${turn.kind === "BAN" ? "ban" : ""}`}
              disabled={
                !ownTurn ||
                live?.busy ||
                !!live?.error ||
                !selected ||
                !!choiceReason(selected, state, catalog)
              }
              onClick={() => commit(selectedId, false, step)}
            >
              {!ownTurn
                ? "상대 선택 중…"
                : turn.kind === "BAN"
                  ? "밴 확정"
                  : "픽 확정"}
              <span>
                {selected && ownTurn
                  ? (choiceReason(selected, state, catalog) ?? selected.name)
                  : "30초 초과 시 자동 선택"}
              </span>
            </button>
          )}
          <div className="draft-secondary-actions">
            {live ? (
              <span>선택 즉시 서버 저장 · 확정 후 변경 불가</span>
            ) : confirmReset ? (
              <>
                <span>현재 구성을 초기화할까요?</span>
                <button type="button" onClick={reset}>
                  초기화
                </button>
                <button type="button" onClick={() => setConfirmReset(false)}>
                  취소
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)}>
                처음부터 다시
              </button>
            )}
          </div>
        </div>
        <p className="draft-preview-notice">
          {live
            ? "세트별 밴픽 · 선택한 Variant가 실제 경기 계산에 반영됩니다. 챔피언 숙련도 보정은 아직 적용하지 않습니다."
            : "화면 미리보기 · 이 탭에만 임시 저장됩니다. 선택한 밴픽은 아직 경기 결과에 반영되지 않습니다."}
          {storageWarning
            ? " 브라우저 임시 저장을 사용할 수 없어 닫으면 초기화될 수 있습니다."
            : ""}
          {live?.error && (
            <span role="alert">
              {" "}
              {live.error}{" "}
              <button
                type="button"
                disabled={live.busy}
                onClick={live.onReload}
              >
                서버 상태 다시 불러오기
              </button>
            </span>
          )}
        </p>
      </footer>
    </div>
  );
}

function DraftTeamPanel({
  team,
  side,
  state,
  catalog,
  own,
  active,
  selected,
}: {
  team: CareerTeam;
  side: DraftSide;
  state: DraftPreviewState;
  catalog: DraftCatalog;
  own: boolean;
  active: boolean;
  selected?: DraftVariant;
}) {
  const picks = draftPicks(state, side, catalog);
  const bans = state.actions.filter(
    (action) => action.side === side && action.kind === "BAN",
  );
  return (
    <aside
      className={`draft-team-panel ${side.toLowerCase()} ${active ? "active" : ""}`}
      aria-label={`${SIDE_LABEL[side]} 선수단과 밴 목록`}
    >
      <div className="draft-team-caption">
        <span>{own ? "MY TEAM" : "OPPONENT"}</span>
        <small>{picks.length} / 5 PICKS</small>
      </div>
      <div className="draft-player-slots">
        {DRAFT_POSITIONS.map((position, index) => {
          const roster = team.starters.find(
            (slot) => slot.starterPosition === position,
          );
          const pick = picks.find((variant) => variant.position === position);
          const hovering = active && !pick && selected?.position === position;
          const variant = pick ?? (hovering ? selected : undefined);
          return (
            <article
              key={position}
              className={`draft-player-slot pos-${position} ${pick ? "locked" : ""} ${hovering ? "hovering" : ""}`}
            >
              <span className="draft-slot-number">0{index + 1}</span>
              <div className="draft-slot-art">
                {variant ? (
                  <VariantSigil variant={variant} />
                ) : (
                  <span className="draft-slot-empty">◇</span>
                )}
                <small>{POSITION_SHORT[position]}</small>
              </div>
              <div className="draft-slot-text">
                <strong>
                  {roster?.careerPlayer.playerCard.player.nickname ??
                    "선수 미등록"}
                </strong>
                <span>{variant?.name ?? "선택 대기"}</span>
                <small>
                  {pick
                    ? "LOCKED IN"
                    : hovering
                      ? "선택 중"
                      : (roster?.playerInstruction?.replaceAll("_", " ") ??
                        "역할 미지정")}
                </small>
              </div>
              {pick && (
                <span className="draft-slot-check" aria-label="선택 확정">
                  ✓
                </span>
              )}
            </article>
          );
        })}
      </div>
      <div className="draft-bans-header">
        <span>BANS</span>
        <small>{bans.length} / 5</small>
      </div>
      <div className="draft-ban-slots">
        {Array.from({ length: 5 }, (_, index) => {
          const ban = bans[index];
          const variant = catalog.variants.find(
            (value) => value.id === ban?.variantId,
          );
          return (
            <div
              key={index}
              className={variant ? `filled pos-${variant.position}` : ""}
              title={variant?.name ?? `${index + 1}밴 대기`}
            >
              {variant ? (
                <>
                  <VariantSigil variant={variant} />
                  <span>×</span>
                  <small>
                    {POSITION_SHORT[variant.position]} {variant.variant}
                  </small>
                </>
              ) : (
                <span>−</span>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function VariantSigil({ variant }: { variant: DraftVariant }) {
  const paths: Record<Position, string> = {
    TOP: "M50 12 79 25 73 61 50 83 27 61 21 25ZM50 24V69M32 32 50 40 68 32",
    JUNGLE:
      "M47 12 32 43 19 32 29 66 49 83 71 65 81 33 65 44 58 20M47 43 42 62 51 69 61 57",
    MID: "M50 10 60 37 86 47 60 58 50 87 39 58 14 47 39 37ZM50 31 65 48 50 66 35 48Z",
    ADC: "M30 17Q76 49 30 82L43 50ZM19 50H84M70 36 84 50 70 64",
    SUPPORT:
      "M50 24 60 41 55 67 50 83 45 67 40 41ZM38 43 13 25 18 49 39 62M62 43 87 25 82 49 61 62",
  };
  return (
    <svg
      className={`draft-sigil sigil-${variant.variant}`}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="sigil-orbit" cx="50" cy="49" r="39" />
      <path className="sigil-glyph" d={paths[variant.position]} />
      <path className="sigil-ornament" d="M7 12H25M7 12V30M93 88H75M93 88V70" />
      <circle
        cx="50"
        cy="49"
        r="46"
        strokeDasharray={
          variant.variant === "A"
            ? "4 12"
            : variant.variant === "B"
              ? "1 8"
              : "10 6"
        }
        className="sigil-runes"
      />
    </svg>
  );
}
