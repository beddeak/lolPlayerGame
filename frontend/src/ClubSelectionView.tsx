import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, apiRequest } from "./api";
import ClubLogo from "./ClubLogo";
import {
  POSITIONS,
  type ClubsResponse,
  type CreateCareerFromClubPayload,
  type PlayerCard,
} from "./types";
import "./ClubSelectionView.css";

interface Props {
  token: string;
  creatingClubCode?: string | null;
  onBack: () => void;
  onSubmit: (payload: CreateCareerFromClubPayload) => Promise<void>;
  onSessionError: (error: unknown) => void;
}

interface CatalogState {
  token: string;
  data: ClubsResponse | null;
  loading: boolean;
  error: string;
}

export default function ClubSelectionView({
  token,
  creatingClubCode = null,
  onBack,
  onSubmit,
  onSessionError,
}: Props) {
  const [catalog, setCatalog] = useState<CatalogState>({
    token,
    data: null,
    loading: true,
    error: "",
  });
  const [reload, setReload] = useState(0);
  const [region, setRegion] = useState("ALL");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const requestVersion = useRef(0);
  const pendingSubmit = useRef(false);
  const mounted = useRef(false);
  const currentToken = useRef(token);
  const sessionErrorHandler = useRef(onSessionError);
  useEffect(() => {
    currentToken.current = token;
    sessionErrorHandler.current = onSessionError;
  }, [token, onSessionError]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    let active = true;
    const isCurrent = () =>
      active &&
      mounted.current &&
      currentToken.current === token &&
      requestVersion.current === version;
    pendingSubmit.current = false;
    apiRequest<ClubsResponse>("/clubs", { token, signal: controller.signal })
      .then((data) => {
        if (!isCurrent()) return;
        setCatalog({ token, data, loading: false, error: "" });
        const firstClub =
          data.clubs.find((club) => club.selectable) ?? data.clubs[0];
        setSelectedCode(firstClub?.code ?? null);
        setRegion("ALL");
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        setCatalog({
          token,
          data: null,
          loading: false,
          error: errorMessage(error),
        });
        if (error instanceof ApiError && error.status === 401)
          sessionErrorHandler.current(error);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, reload]);

  const data = catalog.token === token ? catalog.data : null;
  const loading = catalog.token !== token || catalog.loading;
  const regions = [...new Set(data?.clubs.map((club) => club.region) ?? [])];
  const leagueFilters = ["ALL", ...regions];
  const visibleClubs =
    data?.clubs.filter((club) => region === "ALL" || club.region === region) ??
    [];
  const selectedClub =
    data?.clubs.find((club) => club.code === selectedCode) ?? null;
  const busy = submitting || creatingClubCode !== null;
  const canStart = Boolean(
    data?.ready && selectedClub?.selectable && !loading && !busy,
  );

  function retry() {
    if (pendingSubmit.current || busy) return;
    requestVersion.current++;
    setCatalog({ token, data: null, loading: true, error: "" });
    setReload((value) => value + 1);
  }

  function changeRegion(nextRegion: string) {
    if (pendingSubmit.current || busy) return;
    setRegion(nextRegion);
    const candidates =
      data?.clubs.filter(
        (club) => nextRegion === "ALL" || club.region === nextRegion,
      ) ?? [];
    if (!candidates.some((club) => club.code === selectedCode)) {
      setSelectedCode(
        (candidates.find((club) => club.selectable) ?? candidates[0])?.code ??
          null,
      );
    }
    setSubmitError("");
  }

  function navigateLeagues(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const offsets: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: -index,
      End: leagueFilters.length - 1 - index,
    };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const nextIndex =
      (index + offsets[event.key] + leagueFilters.length) %
      leagueFilters.length;
    changeRegion(leagueFilters[nextIndex]);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  }

  async function startCareer() {
    if (
      !canStart ||
      !selectedClub ||
      pendingSubmit.current ||
      currentToken.current !== token ||
      !mounted.current
    )
      return;
    pendingSubmit.current = true;
    setSubmitting(true);
    setSubmitError("");
    const version = requestVersion.current;
    try {
      await onSubmit({ clubCode: selectedClub.code });
    } catch (error) {
      if (
        mounted.current &&
        currentToken.current === token &&
        requestVersion.current === version
      )
        setSubmitError(errorMessage(error));
    } finally {
      if (
        mounted.current &&
        currentToken.current === token &&
        requestVersion.current === version
      ) {
        pendingSubmit.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <section
      className="club-selection-page"
      aria-labelledby="club-selection-heading"
    >
      <button className="back-button" onClick={onBack}>
        ← 커리어 목록
      </button>
      <div className="club-selection-heading">
        <div>
          <p className="eyebrow">YOUR CLUB. YOUR STORY.</p>
          <h1 id="club-selection-heading">당신의 구단을 선택하세요.</h1>
          <p>등록된 구단의 감독이 되어 새로운 시즌을 시작합니다.</p>
        </div>
        <span className="club-season-label">
          NEW CAREER{data && <strong>{data.startYear} SEASON</strong>}
        </span>
      </div>

      {loading ? (
        <div className="club-state-panel" role="status">
          <span className="loading-line" />
          <h2>구단을 불러오는 중입니다.</h2>
          <p>리그와 등록 로스터를 확인하고 있습니다.</p>
        </div>
      ) : catalog.error ? (
        <div className="club-state-panel">
          <h2>구단 목록을 불러오지 못했습니다.</h2>
          <p role="alert">{catalog.error}</p>
          <button className="secondary-button" onClick={retry} disabled={busy}>
            다시 불러오기
          </button>
        </div>
      ) : !data || data.clubs.length === 0 ? (
        <div className="club-state-panel">
          <h2>등록된 구단이 없습니다.</h2>
          <p>구단과 로스터가 등록되면 새 커리어를 시작할 수 있습니다.</p>
          <button className="secondary-button" onClick={retry} disabled={busy}>
            다시 불러오기
          </button>
        </div>
      ) : (
        <>
          {!data.ready && (
            <div className="club-world-warning" role="status">
              <strong>시즌 준비 중</strong>
              <span>
                {data.unavailableReason ??
                  "등록된 전체 구단의 로스터 준비가 끝나면 시즌을 시작할 수 있습니다."}
              </span>
              <button className="text-button" onClick={retry} disabled={busy}>
                다시 확인
              </button>
            </div>
          )}
          <div className="club-selection-layout">
            <section className="club-browser" aria-label="리그 및 구단 선택">
              <div className="club-browser-title">
                <h2>구단 선택</h2>
                <span>{data.clubs.length} CLUBS</span>
              </div>
              <div
                className="club-league-tabs"
                role="tablist"
                aria-label="리그 선택"
              >
                {leagueFilters.map((filter, index) => (
                  <button
                    key={filter}
                    type="button"
                    id={`league-tab-${filter}`}
                    role="tab"
                    aria-selected={region === filter}
                    aria-controls="club-league-panel"
                    tabIndex={region === filter ? 0 : -1}
                    disabled={busy}
                    onKeyDown={(event) => navigateLeagues(event, index)}
                    onClick={() => changeRegion(filter)}
                  >
                    {filter === "ALL" ? "전체 리그" : filter}
                    <span>
                      {filter === "ALL"
                        ? data.clubs.length
                        : data.clubs.filter((club) => club.region === filter)
                            .length}
                    </span>
                  </button>
                ))}
              </div>
              <div
                id="club-league-panel"
                role="tabpanel"
                aria-labelledby={`league-tab-${region}`}
                tabIndex={0}
              >
                <div className="club-tile-grid">
                  {visibleClubs.map((club) => (
                    <button
                      type="button"
                      key={club.code}
                      className={`club-tile${selectedCode === club.code ? " is-selected" : ""}`}
                      aria-pressed={selectedCode === club.code}
                      aria-label={`${club.name} · ${club.region}${club.selectable ? "" : ` · ${club.unavailableReason ?? "로스터 준비 중"}`}`}
                      disabled={!club.selectable || busy}
                      title={club.unavailableReason ?? club.name}
                      onClick={() => {
                        if (!pendingSubmit.current && !busy && club.selectable) {
                          setSelectedCode(club.code);
                          setSubmitError("");
                        }
                      }}
                    >
                      <span className="club-tile-league">{club.region}</span>
                      <ClubLogo
                        key={`${club.code}-${club.logoUrl}`}
                        club={club}
                      />
                      <strong>{club.code}</strong>
                      <span className="club-tile-name">{club.name}</span>
                      {!club.selectable && (
                        <span className="club-tile-unavailable">
                          로스터 준비 중
                        </span>
                      )}
                      <span className="club-selected-mark" aria-hidden="true">
                        ✓
                      </span>
                    </button>
                  ))}
                </div>
                {visibleClubs.length === 0 && (
                  <p className="club-filter-empty">
                    이 리그에 등록된 구단이 없습니다.
                  </p>
                )}
              </div>
              <div className="club-world-note">
                <span aria-hidden="true">◎</span>
                <p>
                  구단 하나를 선택하면 다른 팀도 모두 자동 생성됩니다.
                  <small>
                    등록된 모든 리그 · 총 {data.worldTeamCount}개 팀 · 각 팀의
                    주전과 후보 로스터 포함
                  </small>
                </p>
              </div>
            </section>
            <aside
              className="club-preview"
              aria-label="선택한 구단 미리보기"
              aria-live="polite"
              aria-busy={busy}
            >
              {selectedClub ? (
                <>
                  <div className="club-preview-heading">
                    <span>YOUR NEXT CHAPTER</span>
                    <strong>{selectedClub.region}</strong>
                  </div>
                  <div className="club-preview-identity">
                    <ClubLogo
                      key={`${selectedClub.code}-${selectedClub.logoUrl}`}
                      club={selectedClub}
                    />
                    <p>{selectedClub.code}</p>
                    <h2>{selectedClub.name}</h2>
                  </div>
                  <dl className="club-preview-stats">
                    <div>
                      <dt>시작 전력</dt>
                      <dd>
                        {selectedClub.startingStrength ?? "—"}
                        <small>평균</small>
                      </dd>
                    </div>
                    <div>
                      <dt>주전</dt>
                      <dd>
                        {selectedClub.starters.length}
                        <small>명</small>
                      </dd>
                    </div>
                    <div>
                      <dt>후보</dt>
                      <dd>
                        {selectedClub.benches.length}
                        <small>명</small>
                      </dd>
                    </div>
                  </dl>
                  <div className="club-lineup-title">
                    <h3>주전 선수</h3>
                    <span>시작 로스터</span>
                  </div>
                  <div className="club-preview-roster">
                    {POSITIONS.map((position) => {
                      const starter = selectedClub.starters.find(
                        (entry) => entry.position === position,
                      );
                      return (
                        <div className="club-preview-player" key={position}>
                          <span className="club-player-position">
                            {position === "JUNGLE"
                              ? "JGL"
                              : position === "SUPPORT"
                                ? "SUP"
                                : position}
                          </span>
                          {starter ? (
                            <>
                              <PlayerPortrait
                                key={`${starter.playerCard.id}-${starter.playerCard.imageUrl}`}
                                card={starter.playerCard}
                              />
                              <div>
                                <strong>
                                  {starter.playerCard.player.nickname}
                                </strong>
                                <small>
                                  {starter.playerCard.player.nationality}
                                </small>
                              </div>
                              <span className="club-player-overall">
                                {overall(starter.playerCard)}
                                <small>OVR</small>
                              </span>
                            </>
                          ) : (
                            <span className="club-missing-player">
                              등록 대기
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="club-bench-summary">
                    <strong>후보 {selectedClub.benches.length}명</strong>
                    <span>
                      {selectedClub.benches.length
                        ? selectedClub.benches
                            .map((entry) => entry.playerCard.player.nickname)
                            .join(" · ")
                        : "등록된 후보 없음"}
                    </span>
                  </div>
                  {!selectedClub.selectable && (
                    <p className="club-start-error">
                      {selectedClub.unavailableReason ??
                        "이 구단의 로스터가 아직 준비되지 않았습니다."}
                    </p>
                  )}
                </>
              ) : (
                <div className="club-preview-empty">
                  운영할 구단을 선택하세요.
                </div>
              )}
              {submitError && (
                <p className="club-start-error" role="alert">
                  {submitError}
                </p>
              )}
              <button
                className="club-start-button"
                disabled={!canStart}
                onClick={() => void startCareer()}
              >
                {busy ? "시즌 생성 중..." : "이 구단으로 시작하기"}
                <span aria-hidden="true">→</span>
              </button>
              <p className="club-start-note">
                {creatingClubCode
                  ? `${creatingClubCode} 새 게임 생성이 끝날 때까지 기다려 주세요. 완료한 게임은 커리어 목록에서 확인할 수 있습니다.`
                  : submitting
                    ? "전체 리그와 로스터를 생성하고 있습니다."
                    : `${data.startYear} 시즌 · 생성한 커리어는 자동 저장됩니다.`}
              </p>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

export function PlayerPortrait({ card }: { card: PlayerCard }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="club-player-portrait" aria-hidden="true">
      {card.imageUrl && !failed ? (
        <img src={card.imageUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>{card.player.nickname.slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

function overall(card: PlayerCard) {
  return Math.round(
    (card.mechanics +
      card.gameSense +
      card.laning +
      card.teamFight +
      card.macro +
      card.teamPlay +
      card.mental +
      card.championPool) /
      8,
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
