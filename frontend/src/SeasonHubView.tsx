import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiRequest } from "./api";
import "./SeasonHubView.css";
import type {
  CalendarAdvanceMode,
  CalendarAdvanceResponse,
  CalendarEvent,
  CalendarFixture,
  CalendarResponse,
  Career,
  FastSimResponse,
  LeagueFixture,
  LeagueSplit,
  LeagueStage,
  ManagerOverview,
  QuickSimResponse,
  SeasonPeriod,
} from "./types";

const EVENT_LABELS: Record<CalendarEvent["type"], string> = {
  SCHEDULED_GAME: "경기 일정",
  CONTRACT_RESPONSE: "계약 응답",
  LEGEND_REVEAL: "레전드 공개",
  LEGEND_SIGNING: "레전드 계약 소식",
  AI_CLUB_UPDATE: "구단 소식",
  MANAGER_REVIEW: "감독 평가",
  JOB_SECURITY_WARNING: "감독직 경고",
  MANAGER_DISMISSED: "감독 경질",
  PLAYER_MEETING: "선수 면담",
  INTERNATIONAL_ROSTER_REGISTRATION: "국제대회 로스터 등록",
  SEASON_REVIEW: "시즌 리뷰",
  TRANSFER_WINDOW_OPEN: "이적시장 개장",
};

const SPLIT_STATUS_LABELS: Record<LeagueSplit["status"], string> = {
  SCHEDULED: "예정",
  IN_PROGRESS: "진행 중",
  COMPLETED: "종료",
};

const STOP_REASON_LABELS: Record<FastSimResponse["stopReason"], string> = {
  TARGET_REACHED: "목표 날짜까지 진행했습니다.",
  MANAGED_MATCH: "내 구단 경기를 앞두고 멈췄습니다.",
  BLOCKING_EVENT: "감독의 결정이 필요한 이벤트에서 멈췄습니다.",
  MANAGER_DISMISSED: "감독 경질로 구단 운영과 일정 진행이 중단됐습니다. 기존 기록은 유지됩니다.",
  FIXTURE_LIMIT: "한 번에 처리할 수 있는 경기 수에 도달했습니다.",
  TRANSFER_WINDOW_BOUNDARY: "이적시장 개장 또는 폐장 날짜에 도착했습니다.",
  SEASON_BOUNDARY: "다음 시즌 구간에 도착했습니다. 일정과 선수단을 확인해 주세요.",
};

interface SeasonHubViewProps {
  career: Career;
  token: string;
  onBack: () => void;
  onCareerRefresh: () => Promise<void>;
  onOpenContracts: (offerId?: number) => void;
  onOpenLegends: () => void;
}

export default function SeasonHubView({
  career,
  token,
  onBack,
  onCareerRefresh,
  onOpenContracts,
  onOpenLegends,
}: SeasonHubViewProps) {
  const managedTeam =
    career.teams.find((team) => team.isUserControlled) ?? career.teams[0];
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [splits, setSplits] = useState<LeagueSplit[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedSplitId, setSelectedSplitId] = useState<number | null>(null);
  const [quickResult, setQuickResult] = useState<QuickSimResponse | null>(null);
  const [fastResult, setFastResult] = useState<FastSimResponse | null>(null);
  const [advanceResult, setAdvanceResult] = useState<CalendarAdvanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const sessionVersion = useRef(0);
  const loadVersion = useRef(0);
  const inFlight = useRef(false);
  const managementAllowed = useRef(true);

  const fetchSeasonData = useCallback(async () => {
    const session = sessionVersion.current;
    const request = ++loadVersion.current;
    const data = await Promise.all([
      apiRequest<CalendarResponse>(`/careers/${career.id}/calendar`, { token }),
      apiRequest<LeagueSplit[]>(`/careers/${career.id}/league-splits`, {
        token,
      }),
      apiRequest<CalendarEvent[]>(`/careers/${career.id}/events`, { token }),
    ]).catch((reason: unknown) => {
      if (!mounted.current || session !== sessionVersion.current || request !== loadVersion.current) return null;
      throw reason;
    });

    if (!data || !mounted.current || session !== sessionVersion.current || request !== loadVersion.current) return;
    const [nextCalendar, nextSplits, nextEvents] = data;
    managementAllowed.current = nextCalendar.manager?.canManage !== false;
    setCalendar(nextCalendar);
    setSplits(nextSplits);
    setEvents(
      nextEvents.filter(
        (event) =>
          event.type !== "LEGEND_REVEAL" || event.status !== "SCHEDULED",
      ),
    );
    setSelectedSplitId((current) => {
      if (current && nextSplits.some((split) => split.id === current)) {
        return current;
      }

      const currentYearSplits = nextSplits.filter(
        (split) => split.year === nextCalendar.currentYear,
      );
      const managedYearSplits = currentYearSplits.filter(
        (split) => split.region === managedTeam?.region,
      );
      const preferredSplits = managedYearSplits.length > 0
        ? managedYearSplits
        : currentYearSplits.length > 0
          ? currentYearSplits
          : nextSplits;

      return (
        preferredSplits.find((split) => split.status === "IN_PROGRESS")?.id ??
        preferredSplits.find((split) => split.status === "SCHEDULED")?.id ??
        preferredSplits[0]?.id ??
        null
      );
    });
  }, [career.id, managedTeam?.region, token]);

  useEffect(() => {
    mounted.current = true;
    const session = ++sessionVersion.current;
    inFlight.current = false;
    managementAllowed.current = true;
    function initialize() {
      setLoading(true);
      setCalendar(null);
      setSplits([]);
      setEvents([]);
      setSelectedSplitId(null);
      setQuickResult(null);
      setFastResult(null);
      setAdvanceResult(null);
      setBusyAction("");
      setError("");
    }
    // oxlint-disable-next-line react/set-state-in-effect -- Reset state when switching the active career or session.
    initialize();

    // oxlint-disable-next-line react/set-state-in-effect -- The async API result initializes this view.
    fetchSeasonData()
      .catch((loadError) => {
        if (mounted.current && session === sessionVersion.current) setError(toMessage(loadError));
      })
      .finally(() => {
        if (mounted.current && session === sessionVersion.current) setLoading(false);
      });

    return () => {
      mounted.current = false;
      sessionVersion.current = session + 1;
    };
  }, [fetchSeasonData]);

  const activeSplit = useMemo(
    () =>
      splits.find((split) => split.id === selectedSplitId) ?? splits[0] ?? null,
    [selectedSplitId, splits],
  );
  const activeStage = useMemo(
    () => pickVisibleStage(activeSplit),
    [activeSplit],
  );
  const managedDueFixture = calendar?.dueMatches.find((fixture) =>
    includesTeam(fixture, managedTeam?.id),
  );
  const missingSplitNumbers = [1, 2, 3].filter(
    (splitNumber) =>
      !splits.some(
        (split) =>
          split.year === calendar?.currentYear &&
          split.region === managedTeam?.region &&
          split.splitNumber === splitNumber,
      ),
  );
  const nextScheduledEvent = events.find(
    (event) => event.status === "SCHEDULED",
  );

  async function refreshAfterMutation() {
    await Promise.all([fetchSeasonData(), onCareerRefresh()]);
  }

  async function performAction(key: string, action: (isCurrent: () => boolean) => Promise<void>, requiresManagement = true) {
    if (inFlight.current || !mounted.current || (requiresManagement && !managementAllowed.current)) return;
    inFlight.current = true;
    const session = sessionVersion.current;
    const isCurrent = () => mounted.current && session === sessionVersion.current;
    setBusyAction(key);
    setError("");

    try {
      await action(isCurrent);
    } catch (actionError) {
      if (isCurrent()) setError(toMessage(actionError));
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setBusyAction("");
      }
    }
  }

  function advanceCalendar(mode: CalendarAdvanceMode) {
    void performAction(`advance-${mode}`, async (isCurrent) => {
      const result = await apiRequest<CalendarAdvanceResponse>(
        `/careers/${career.id}/calendar/advance`,
        { method: "POST", token, body: { mode } },
      );
      if (!isCurrent()) return;
      managementAllowed.current = result.manager?.canManage !== false;
      setCalendar(result);
      setAdvanceResult(result);
      setFastResult(null);
      await refreshAfterMutation();
    });
  }

  function runFastSim(days: number) {
    void performAction(`fast-${days}`, async (isCurrent) => {
      const result = await apiRequest<FastSimResponse>(
        `/careers/${career.id}/simulations/fast`,
        { method: "POST", token, body: { days, maxFixtures: 50 } },
      );
      if (!isCurrent()) return;
      managementAllowed.current = result.calendar.manager?.canManage !== false;
      setCalendar(result.calendar);
      setFastResult(result);
      setAdvanceResult(null);
      await refreshAfterMutation();
    });
  }

  function runQuickSim(fixture: CalendarFixture) {
    void performAction(`quick-${fixture.id}`, async (isCurrent) => {
      const result = await apiRequest<QuickSimResponse>(
        `/careers/${career.id}/simulations/quick`,
        {
          method: "POST",
          token,
          body: {
            leagueSplitId: fixture.leagueSplitId,
            fixtureId: fixture.id,
          },
        },
      );
      if (!isCurrent()) return;
      setQuickResult(result);
      setFastResult(null);
      setAdvanceResult(null);
      await refreshAfterMutation();
    });
  }

  function resolveEvent(event: CalendarEvent) {
    if (!managementAllowed.current || isManagerNewsEvent(event)) return;
    if (event.type === "LEGEND_REVEAL") {
      onOpenLegends();
      return;
    }
    if (
      event.type === "CONTRACT_RESPONSE" &&
      typeof event.payload?.contractOfferId === "number"
    ) {
      onOpenContracts(event.payload.contractOfferId);
      return;
    }
    acknowledgeEvent(event);
  }

  function acknowledgeEvent(event: CalendarEvent) {
    if (isManagerNewsEvent(event)) return;
    void performAction(`event-${event.id}`, async (isCurrent) => {
      await apiRequest<CalendarEvent>(
        `/careers/${career.id}/events/${event.id}/resolve`,
        { method: "POST", token },
      );
      if (!isCurrent()) return;
      await refreshAfterMutation();
    });
  }

  function createSplit(splitNumber: number) {
    if (!managedTeam) return;

    void performAction(`split-${splitNumber}`, async (isCurrent) => {
      const created = await apiRequest<LeagueSplit>(
        `/careers/${career.id}/league-splits`,
        {
          method: "POST",
          token,
          body: { region: managedTeam.region, splitNumber },
        },
      );
      if (!isCurrent()) return;
      setSelectedSplitId(created.id);
      await refreshAfterMutation();
    });
  }

  function startSeasonSchedule() {
    void performAction("start-season", async (isCurrent) => {
      const result = await apiRequest<CalendarResponse>(
        `/careers/${career.id}/calendar/start-season`,
        { method: "POST", token },
      );
      if (!isCurrent()) return;
      managementAllowed.current = result.manager?.canManage !== false;
      setCalendar(result);
      setAdvanceResult(null);
      setFastResult(null);
      await refreshAfterMutation();
    });
  }

  if (!managedTeam) return null;

  if (loading) {
    return (
      <section className="season-loading">
        <span className="season-loading-ball" />
        <strong>시즌 데이터를 불러오는 중</strong>
        <small>일정, 이벤트, 순위를 동기화하고 있습니다.</small>
      </section>
    );
  }

  if (!calendar) {
    return (
      <section className="season-loading">
        <strong>시즌 정보를 불러오지 못했습니다.</strong>
        <p role="alert">{error}</p>
        <button
          disabled={Boolean(busyAction)}
          onClick={() => void performAction("retry", fetchSeasonData, false)}
        >
          다시 시도
        </button>
        <button onClick={onBack}>구단으로 돌아가기</button>
      </section>
    );
  }

  const blockingEvents = calendar.blockingEvents.filter((event) => !isManagerNewsEvent(event));
  const hasBlockingEvent = blockingEvents.length > 0;
  const canManage = calendar.manager?.canManage !== false;
  const mutationBlocked = Boolean(busyAction) || !canManage;
  const nextFixture = calendar.nextMatch;

  return (
    <section className="season-hub-page">
      <div className="season-navline">
        <button className="season-back-button" onClick={onBack}>
          ← 구단 사무실
        </button>
        <div>
          <span>CAREER #{String(career.id).padStart(4, "0")}</span>
          <i />
          <strong>{managedTeam.code}</strong>
        </div>
      </div>

      <header className="season-command-header">
        <div className="season-command-copy">
          <p>SEASON COMMAND CENTER</p>
          <h1>
            {calendar.currentYear}
            <span>시즌 허브</span>
          </h1>
          <div className="current-date-block">
            <small>CURRENT DATE</small>
            <strong>{formatGameDate(calendar.currentDate)}</strong>
            <span>{formatWeekday(calendar.currentDate)}</span>
          </div>
        </div>

        <div className="time-control-panel">
          <div className="time-control-heading">
            <div>
              <span>TIME CONTROL</span>
              <strong>일정 진행</strong>
            </div>
            <small>{!canManage ? "감독직 종료" : hasBlockingEvent ? "결정 대기 중" : "진행 가능"}</small>
          </div>
          <div className="time-control-grid">
            <button
              disabled={mutationBlocked || hasBlockingEvent}
              onClick={() => advanceCalendar("ONE_DAY")}
            >
              <span>+1</span>
              <small>하루 진행</small>
            </button>
            <button
              disabled={mutationBlocked || hasBlockingEvent}
              onClick={() => advanceCalendar("THREE_DAYS")}
            >
              <span>+3</span>
              <small>3일 진행</small>
            </button>
            <button
              disabled={mutationBlocked || hasBlockingEvent}
              onClick={() => runFastSim(7)}
            >
              <span>7D</span>
              <small>Fast Sim</small>
            </button>
            <button
              className="next-important-button"
              disabled={mutationBlocked || hasBlockingEvent}
              onClick={() => runFastSim(90)}
            >
              <span>▶</span>
              <small>{nextFixture ? "다음 내 경기" : "다음 주요 일정"}</small>
            </button>
          </div>
          <button
            className="next-event-button"
            disabled={
              mutationBlocked ||
              hasBlockingEvent ||
              (!nextScheduledEvent && !calendar.transferWindow.nextBoundaryDate && !calendar.season?.nextBoundaryDate)
            }
            onClick={() => advanceCalendar("NEXT_EVENT")}
          >
            다음 주요 일정까지 진행
            <span>→</span>
          </button>
        </div>
      </header>

      {error && <div className="season-error-banner">{error}</div>}
      {calendar.manager && <ManagerReviewCard manager={calendar.manager} />}
      {advanceResult?.stopReason === "SEASON_BOUNDARY" && (
        <div className="season-boundary-banner" role="status">
          <strong>{advanceResult.season.currentPhase.label} 시작</strong>
          <span>시즌 구간이 바뀌어 멈췄습니다. 연간 일정과 선수단을 확인하고 계속 진행하세요.</span>
        </div>
      )}
      {fastResult && (
        <div className={`sim-status-banner stop-${fastResult.stopReason}`}>
          <div>
            <span>FAST SIM REPORT</span>
            <strong>{STOP_REASON_LABELS[fastResult.stopReason]}</strong>
          </div>
          <p>
            {fastResult.advancedDays}일 진행 · AI 경기{" "}
            {fastResult.simulatedFixtures.length}개 처리
          </p>
          <button onClick={() => setFastResult(null)}>닫기</button>
        </div>
      )}

      {hasBlockingEvent && (
        <section className="decision-strip">
          <div className="decision-icon">!</div>
          <div>
            <span>MANAGER DECISION REQUIRED</span>
            <strong>진행 전에 처리해야 할 이벤트가 있습니다.</strong>
          </div>
          <div className="decision-actions">
            {blockingEvents.map((event) => (
              <Fragment key={event.id}>
                <button
                  disabled={mutationBlocked}
                  onClick={() => resolveEvent(event)}
                >
                  {event.type === "LEGEND_REVEAL"
                    ? "레전드 이벤트 확인"
                    : `${EVENT_LABELS[event.type]} 처리하기`}
                </button>
                {event.type === "LEGEND_REVEAL" && (
                  <button
                    disabled={mutationBlocked}
                    onClick={() => acknowledgeEvent(event)}
                  >
                    확인 완료 · 일정 계속하기
                  </button>
                )}
              </Fragment>
            ))}
            {calendar.canCloseTransferWindow && (
              <button
                disabled={mutationBlocked}
                onClick={() => advanceCalendar("ONE_DAY")}
                title="진행 중인 영입 제안과 이적 합의를 종료하고 1월 1일로 이동합니다."
              >
                미완료 영입 종료하고 새해로
              </button>
            )}
          </div>
        </section>
      )}

      <SeasonCalendarView
        calendar={calendar}
        busy={mutationBlocked}
        onStart={startSeasonSchedule}
      />

      <div className="season-primary-grid">
        <NextMatchCard
          fixture={nextFixture}
          currentDate={calendar.currentDate}
          managedTeamId={managedTeam.id}
          busy={mutationBlocked}
          onQuickSim={runQuickSim}
        />

        <section className="season-overview-card">
          <div className="season-section-heading">
            <div>
              <span>CLUB SNAPSHOT</span>
              <h2>{managedTeam.name}</h2>
            </div>
            <b>{managedTeam.region}</b>
          </div>
          <div className="snapshot-metrics">
            <div>
              <span>팀 케미스트리</span>
              <strong>{managedTeam.chemistry}</strong>
              <i>
                <b style={{ width: `${managedTeam.chemistry}%` }} />
              </i>
            </div>
            <div>
              <span>현재 순위</span>
              <strong>
                {findManagedStanding(activeStage, managedTeam.id)?.rank ?? "-"}
                <small>위</small>
              </strong>
            </div>
            <div>
              <span>시리즈 전적</span>
              <strong>
                {formatRecord(findManagedStanding(activeStage, managedTeam.id))}
              </strong>
            </div>
          </div>
          <div className="due-match-summary">
            <span>오늘 대기 중인 경기</span>
            <strong>{calendar.dueMatches.length}</strong>
            <small>
              {managedDueFixture
                ? "내 구단 경기가 준비됐습니다."
                : calendar.dueMatches.length > 0
                  ? "AI 경기는 Fast Sim으로 처리할 수 있습니다."
                  : "처리할 경기가 없습니다."}
            </small>
          </div>
        </section>
      </div>

      <div className="season-content-grid">
        <section className="league-center-panel">
          <div className="season-section-heading league-heading">
            <div>
              <span>LEAGUE CENTER</span>
              <h2>리그 순위</h2>
            </div>
            <div className="split-tabs">
              {splits.map((split) => (
                <button
                  key={split.id}
                  className={activeSplit?.id === split.id ? "active" : ""}
                  onClick={() => setSelectedSplitId(split.id)}
                >
                  {split.year} {split.region} S{split.splitNumber}
                </button>
              ))}
            </div>
          </div>

          {activeSplit && activeStage ? (
            <>
              <div className="active-stage-bar">
                <div>
                  <span>{activeSplit.year} · {activeSplit.name}</span>
                  <strong>{activeStage.name}</strong>
                </div>
                <div>
                  <small>ROUND</small>
                  <b>{activeStage.currentRound}</b>
                  <em className={`split-status status-${activeSplit.status}`}>
                    {SPLIT_STATUS_LABELS[activeSplit.status]}
                  </em>
                </div>
              </div>
              <StandingsTable
                stage={activeStage}
                managedTeamId={managedTeam.id}
              />
            </>
          ) : (
            <EmptyLeagueState
              region={managedTeam.region}
              splitNumber={missingSplitNumbers[0] ?? 1}
              busy={mutationBlocked}
              onCreate={createSplit}
            />
          )}
        </section>

        <aside className="season-side-column">
          <section className="schedule-panel">
            <div className="season-section-heading">
              <div>
                <span>FIXTURES</span>
                <h2>경기 일정</h2>
              </div>
              <b>{activeStage?.fixtures.length ?? 0}</b>
            </div>
            <FixtureList
              fixtures={activeStage?.fixtures ?? []}
              managedTeamId={managedTeam.id}
            />
          </section>

          <section className="event-feed-panel">
            <div className="season-section-heading">
              <div>
                <span>INBOX</span>
                <h2>이벤트 큐</h2>
              </div>
              <b>
                {events.filter((event) => event.status !== "COMPLETED").length}
              </b>
            </div>
            <EventFeed
              events={events}
              busy={mutationBlocked}
              onResolve={resolveEvent}
              onAcknowledge={acknowledgeEvent}
            />
          </section>

          {missingSplitNumbers.length > 0 && splits.length > 0 && (
            <section className="add-split-panel">
              <span>NEXT COMPETITION</span>
              <strong>
                {managedTeam.region} Split {missingSplitNumbers[0]}
              </strong>
              <p>다음 스플릿 일정을 미리 생성할 수 있습니다.</p>
              <button
                disabled={mutationBlocked}
                onClick={() => createSplit(missingSplitNumbers[0])}
              >
                일정 생성
              </button>
            </section>
          )}
        </aside>
      </div>

      {quickResult && (
        <QuickSimReport
          result={quickResult}
          career={career}
          onClose={() => setQuickResult(null)}
        />
      )}
    </section>
  );
}

export function ManagerReviewCard({ manager }: { manager: ManagerOverview }) {
  const statusLabel = { ACTIVE: "재직 중", WARNING: "개선 경고", DISMISSED: "감독직 종료" }[manager.status];
  const warning = manager.warning;
  const additionalSeries = warning ? Math.max(0, manager.record.played - warning.issuedAtPlayed) : 0;
  const remainingSeries = warning ? Math.max(0, warning.minimumAdditionalSeries - additionalSeries) : 0;
  const deltaLabel = (value: number) => value > 0 ? `+${value}` : String(value);

  return (
    <section className={`manager-review-panel manager-${manager.status}`} aria-label="감독 평가">
      <div className="season-section-heading manager-review-heading">
        <div>
          <span>MANAGER REVIEW · {manager.reviewYear}</span>
          <h2>팬과 이사회의 평가</h2>
        </div>
        <strong className="manager-status-label">{statusLabel}</strong>
      </div>
      <div className="manager-confidence-grid">
        <div className="manager-confidence fan-confidence">
          <span>팬 지지도</span>
          <strong>{manager.fanApproval}<small> / 100</small></strong>
          <div className="manager-confidence-track" role="progressbar" aria-label="팬 지지도" aria-valuemin={0} aria-valuemax={100} aria-valuenow={manager.fanApproval}>
            <i style={{ width: `${Math.max(0, Math.min(100, manager.fanApproval))}%` }} />
          </div>
        </div>
        <div className="manager-confidence board-confidence">
          <span>이사회 신뢰</span>
          <strong>{manager.boardConfidence}<small> / 100</small></strong>
          <div className="manager-confidence-track" role="progressbar" aria-label="이사회 신뢰" aria-valuemin={0} aria-valuemax={100} aria-valuenow={manager.boardConfidence}>
            <i style={{ width: `${Math.max(0, Math.min(100, manager.boardConfidence))}%` }} />
          </div>
        </div>
      </div>
      <div className="manager-season-record">
        <div><span>평가 대상 시리즈</span><strong>{manager.record.played}경기 · {manager.record.wins}승 {manager.record.losses}패</strong></div>
        <div><span>같은 경기수의 기대 승수</span><strong>{manager.record.expectedWins.toFixed(1)}승</strong></div>
        <div><span>최근 흐름</span><strong>{manager.record.winningStreak > 0 ? `${manager.record.winningStreak}연승` : manager.record.losingStreak > 0 ? `${manager.record.losingStreak}연패` : "시리즈 결과 대기"}</strong></div>
      </div>
      <p className="manager-evaluation-copy">
        팬 지지도와 이사회 신뢰는 별도 평가입니다. 성적 부진 · 낮은 팬 지지도 · 낮은 이사회 신뢰가 모두 겹치면 경고와 개선 기회를 거쳐 경질을 검토합니다. 한 지표가 낮다는 이유만으로 경질되지 않습니다.
      </p>
      <p className="manager-tracking-note">
        {manager.trackingStartedDate ? `${formatGameDate(manager.trackingStartedDate)}부터 평가를 기록합니다. 이전 저장의 과거 경기는 소급 평가하지 않습니다.` : "첫 평가 시점부터 기록을 시작합니다. 이전 저장의 과거 경기는 소급 평가하지 않습니다."}
      </p>
      {manager.status === "WARNING" && warning && (
        <div className="manager-warning-note" role="status">
          <strong>감독직 개선 경고 · {formatGameDate(warning.issuedDate)}</strong>
          <p>경고 후 최소 {warning.minimumAdditionalSeries}시리즈의 개선 기회가 주어집니다. 현재 {additionalSeries}시리즈 진행 · 최소 {remainingSeries}시리즈 남음.</p>
          <p>유예가 끝나도 즉시 경질되는 것은 아닙니다. 이후 평가에서 성적·팬·이사회의 세 조건을 함께 확인합니다.</p>
        </div>
      )}
      {manager.status === "DISMISSED" && (
        <div className="manager-dismissed-note" role="status">
          <strong>감독직이 종료되었습니다{manager.dismissedDate ? ` · ${formatGameDate(manager.dismissedDate)}` : ""}.</strong>
          <p>저장 데이터와 선수·계약·경기 기록은 유지됩니다. 이 커리어의 구단 운영과 일정 진행은 중단되며, 지난 순위와 평가 기록은 계속 볼 수 있습니다.</p>
          <p>다른 구단의 감독 제안과 재취업은 아직 구현되지 않았습니다.</p>
        </div>
      )}
      <div className="manager-review-history">
        <h3>최근 평가 기록</h3>
        {manager.recentReviews.length === 0 ? <p>아직 평가 기록이 없습니다.</p> : (
          <ol>
            {manager.recentReviews.map((review) => (
              <li key={review.id}>
                <div className="manager-review-title"><strong>{review.title}</strong><time dateTime={review.date}>{formatCompactDate(review.date)}</time></div>
                <p>{review.reason}</p>
                <div className="manager-review-deltas">
                  <span>팬 {deltaLabel(review.fanDelta)} → {review.fanApproval}</span>
                  <span>이사회 {deltaLabel(review.boardDelta)} → {review.boardConfidence}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function SeasonCalendarView({
  calendar,
  busy,
  onStart,
}: {
  calendar: CalendarResponse;
  busy: boolean;
  onStart: () => void;
}) {
  // A server update may precede a browser refresh; older API responses remain usable.
  if (!calendar.season) return null;
  const { season } = calendar;
  const current = season.currentPhase;
  const next = season.nextPhase;
  const warnings = calendar.scheduleWarnings ?? [];
  const readiness = calendar.autoSchedule
    ? (calendar.seasonReadiness ?? []).filter((item) => item.status !== "READY")
    : [];

  return (
    <section className="annual-season-panel" aria-label="연간 시즌 일정">
      <div className="season-section-heading annual-season-heading">
        <div>
          <span>SEASON CALENDAR · {season.year}</span>
          <h2>올해의 여정</h2>
        </div>
        {calendar.autoSchedule ? (
          <strong className="schedule-connected">연간 리그 일정 연결됨</strong>
        ) : (
          <button className="schedule-connect-button" disabled={busy} onClick={onStart}>
            연간 리그 일정 연결
          </button>
        )}
      </div>
      <p className="schedule-mode-copy">
        {calendar.autoSchedule
          ? "날짜 진행에 맞춰 참가 가능한 지역 리그를 자동으로 준비합니다. 기존 경기와 결과는 유지됩니다."
          : "현재는 수동 일정 모드입니다. 연결하면 기존 일정은 유지하고, 날짜에 맞춰 지역 리그를 준비합니다."}
      </p>
      <div className="season-period-summary">
        <div>
          <span>지금</span>
          <strong>{current.label}</strong>
          <small>{periodDateRange(current)}</small>
        </div>
        <div>
          <span>다음 구간</span>
          <strong>{next?.label ?? "다음 시즌 준비"}</strong>
          <small>{next ? periodDateRange(next) : "일정이 확정되면 표시됩니다."}</small>
        </div>
      </div>
      <ol className="season-year-timeline" aria-label={`${season.year} 시즌 구간`}>
        {season.periods.map((period) => (
          <li
            key={period.code}
            className={`season-period period-${period.kind} period-${period.status}`}
            aria-current={period.status === "CURRENT" ? "date" : undefined}
          >
            <span className="period-status">
              {period.status === "CURRENT" ? "현재 구간" : period.status === "COMPLETED" ? "지난 구간" : "예정"}
            </span>
            <strong>{period.label}</strong>
            <small>{periodDateRange(period)}</small>
            {period.kind === "INTERNATIONAL" && <em>기간 예약 · 경기 시스템 미구현</em>}
          </li>
        ))}
      </ol>
      <div className="season-current-activities">
        <strong>{current.label} · 지금 할 수 있는 준비</strong>
        {current.kind === "INTERNATIONAL" && <p>국제대회는 일정만 예약되어 있습니다. 참가 선발·대진·경기 진행은 다음 단계에서 연결합니다.</p>}
        <ul>
          {current.activities.map((activity) => <li key={activity}>{activity}</li>)}
        </ul>
      </div>
      {readiness.length > 0 && (
        <div className="season-readiness-note">
          <strong>지역 리그 준비 상태</strong>
          <ul>
            {readiness.map((item) => (
              <li key={item.region}><b>{item.region}</b> · {item.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <details className="season-schedule-warnings">
          <summary>기존 경기 일정 확인 필요 · {warnings.length}건</summary>
          <p>저장된 경기를 임의로 옮기거나 삭제하지 않았습니다. 아래 경기는 시즌 구간 밖에 남아 있습니다.</p>
          <ul>
            {warnings.map((warning) => (
              <li key={warning.fixtureId}>
                <strong>경기 #{warning.fixtureId} · {warning.scheduledDate}</strong>
                <span>{warning.message} (구간 종료 {warning.expectedEndDate})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function periodDateRange(period: SeasonPeriod): string {
  const display = (date: string) => `${date.slice(0, 4)}.${date.slice(5, 7)}.${date.slice(8, 10)}`;
  return `${display(period.startsAt)} – ${display(period.endsAt)}`;
}

function NextMatchCard({
  fixture,
  currentDate,
  managedTeamId,
  busy,
  onQuickSim,
}: {
  fixture: CalendarFixture | null;
  currentDate: string;
  managedTeamId: number;
  busy: boolean;
  onQuickSim: (fixture: CalendarFixture) => void;
}) {
  if (!fixture) {
    return (
      <section className="next-match-card empty-next-match">
        <span>NEXT FIXTURE</span>
        <strong>예정된 경기가 없습니다.</strong>
        <p>리그 일정을 생성하면 다음 경기가 여기에 표시됩니다.</p>
      </section>
    );
  }

  const due = fixture.scheduledDate <= currentDate;
  const managed = includesTeam(fixture, managedTeamId);

  return (
    <section className={`next-match-card ${due ? "is-due" : ""}`}>
      <div className="next-match-topline">
        <span>{managed ? "MY NEXT FIXTURE" : "LEAGUE FIXTURE"}</span>
        <strong>
          {fixture.region} · SPLIT {fixture.splitNumber}
        </strong>
      </div>
      <div className="match-date-line">
        <span>{formatCompactDate(fixture.scheduledDate)}</span>
        <i />
        <strong>{stageLabel(fixture.stageCode)}</strong>
        <em>BO{fixture.bestOf}</em>
      </div>
      <div className="fixture-versus">
        <TeamBadge
          team={fixture.teamA}
          managed={fixture.teamA.id === managedTeamId}
        />
        <div className="versus-mark">
          <span>ROUND {fixture.roundNumber}</span>
          <strong>VS</strong>
          <small>
            {due ? "MATCH DAY" : daysUntil(currentDate, fixture.scheduledDate)}
          </small>
        </div>
        <TeamBadge
          team={fixture.teamB}
          managed={fixture.teamB.id === managedTeamId}
        />
      </div>
      <button
        className="quick-sim-button"
        disabled={busy || !due || !managed}
        onClick={() => onQuickSim(fixture)}
      >
        <span>
          {due && managed ? "QUICK SIM" : managed ? "경기일 대기" : "AI 경기"}
        </span>
        <strong>
          {due && managed ? "시리즈 전체 진행 →" : "FAST SIM으로 처리"}
        </strong>
      </button>
    </section>
  );
}

function TeamBadge({
  team,
  managed,
}: {
  team: CalendarFixture["teamA"];
  managed: boolean;
}) {
  return (
    <div className={`fixture-team ${managed ? "managed" : ""}`}>
      <div>{team.code.slice(0, 3)}</div>
      <strong>{team.code}</strong>
      <span>{team.name}</span>
      {managed && <em>MY CLUB</em>}
    </div>
  );
}

function StandingsTable({
  stage,
  managedTeamId,
}: {
  stage: LeagueStage;
  managedTeamId: number;
}) {
  if (stage.standings.length === 0) {
    return <div className="panel-empty">순위 데이터가 아직 없습니다.</div>;
  }

  return (
    <div className="standings-table">
      <div className="standings-head">
        <span>순위</span>
        <span>구단</span>
        <span>경기</span>
        <span>승</span>
        <span>패</span>
        <span>세트 득실</span>
      </div>
      {stage.standings.map((standing) => (
        <div
          className={`standing-row ${standing.teamId === managedTeamId ? "managed" : ""}`}
          key={standing.teamId}
        >
          <strong className="standing-rank">{standing.rank}</strong>
          <div className="standing-team">
            <i>{standing.teamCode.slice(0, 3)}</i>
            <span>
              <strong>{standing.teamCode}</strong>
              <small>{standing.teamName}</small>
            </span>
          </div>
          <span>{standing.played}</span>
          <b>{standing.seriesWins}</b>
          <span>{standing.seriesLosses}</span>
          <em
            className={standing.gameDifference >= 0 ? "positive" : "negative"}
          >
            {standing.gameDifference > 0 ? "+" : ""}
            {standing.gameDifference}
          </em>
        </div>
      ))}
    </div>
  );
}

function FixtureList({
  fixtures,
  managedTeamId,
}: {
  fixtures: LeagueFixture[];
  managedTeamId: number;
}) {
  const visibleFixtures = [...fixtures]
    .sort(
      (left, right) =>
        left.scheduledDate.localeCompare(right.scheduledDate) ||
        left.id - right.id,
    )
    .filter((fixture) => fixture.status !== "COMPLETED")
    .slice(0, 6);

  if (visibleFixtures.length === 0) {
    return <div className="panel-empty">남은 경기가 없습니다.</div>;
  }

  return (
    <div className="fixture-list">
      {visibleFixtures.map((fixture) => (
        <article
          className={
            includesLeagueTeam(fixture, managedTeamId) ? "managed" : ""
          }
          key={fixture.id}
        >
          <div className="fixture-list-date">
            <strong>{formatDay(fixture.scheduledDate)}</strong>
            <span>{formatMonth(fixture.scheduledDate)}</span>
          </div>
          <div className="fixture-list-teams">
            <span>{fixture.teamA.code}</span>
            <b>
              {fixture.teamAWins} : {fixture.teamBWins}
            </b>
            <span>{fixture.teamB.code}</span>
          </div>
          <div className="fixture-list-state">
            <span>R{fixture.roundNumber}</span>
            <strong>
              {fixture.status === "IN_PROGRESS"
                ? "진행 중"
                : `BO${fixture.bestOf}`}
            </strong>
          </div>
        </article>
      ))}
    </div>
  );
}

function isManagerNewsEvent(event: CalendarEvent) {
  return event.type === "MANAGER_REVIEW" || event.type === "JOB_SECURITY_WARNING" || event.type === "MANAGER_DISMISSED";
}

function EventFeed({
  events,
  busy,
  onResolve,
  onAcknowledge,
}: {
  events: CalendarEvent[];
  busy: boolean;
  onResolve: (event: CalendarEvent) => void;
  onAcknowledge: (event: CalendarEvent) => void;
}) {
  const isClubNews = (event: CalendarEvent) =>
    event.type === "LEGEND_SIGNING" || event.type === "AI_CLUB_UPDATE" || isManagerNewsEvent(event);
  const visibleEvents = events
    .filter((event) => event.status !== "COMPLETED" || isClubNews(event))
    .sort((left, right) => {
      const priority = (event: CalendarEvent) =>
        event.status === "READY" && !isManagerNewsEvent(event) ? 0 : isClubNews(event) ? 1 : 2;
      return (
        priority(left) - priority(right) ||
        (priority(left) === 1
          ? right.scheduledDate.localeCompare(left.scheduledDate)
          : left.scheduledDate.localeCompare(right.scheduledDate)) ||
        left.id - right.id
      );
    })
    .slice(0, 5);

  if (visibleEvents.length === 0) {
    return <div className="panel-empty">대기 중인 이벤트가 없습니다.</div>;
  }

  return (
    <div className="event-feed">
      {visibleEvents.map((event) => (
        <article className={`event-${event.status}`} key={event.id}>
          <i>{event.requiresUserAction && !isManagerNewsEvent(event) ? "!" : "•"}</i>
          <div>
            <span>{formatCompactDate(event.scheduledDate)}</span>
            <strong>{EVENT_LABELS[event.type]}</strong>
            <small>
              {isClubNews(event) && typeof event.payload?.message === "string"
                ? event.payload.message
                : isManagerNewsEvent(event)
                  ? typeof event.payload?.reason === "string" ? event.payload.reason : "감독 평가 기록에서 내용을 확인하세요."
                : event.status === "READY"
                  ? "감독 결정 대기"
                  : "예정"}
            </small>
          </div>
          {event.status === "READY" && !isManagerNewsEvent(event) && (
            <div className="event-feed-actions">
              <button disabled={busy} onClick={() => onResolve(event)}>
                {event.type === "LEGEND_REVEAL" ? "이벤트 확인" : "처리"}
              </button>
              {event.type === "LEGEND_REVEAL" && (
                <button disabled={busy} onClick={() => onAcknowledge(event)}>
                  확인 완료
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function EmptyLeagueState({
  region,
  splitNumber,
  busy,
  onCreate,
}: {
  region: string;
  splitNumber: number;
  busy: boolean;
  onCreate: (splitNumber: number) => void;
}) {
  return (
    <div className="empty-league-state">
      <div>{region}</div>
      <span>NO ACTIVE COMPETITION</span>
      <strong>아직 생성된 리그 일정이 없습니다.</strong>
      <p>Thunder Client 없이 여기서 바로 첫 스플릿을 시작할 수 있습니다.</p>
      <button disabled={busy} onClick={() => onCreate(splitNumber)}>
        {region} SPLIT {splitNumber} 일정 생성
      </button>
    </div>
  );
}

function QuickSimReport({
  result,
  career,
  onClose,
}: {
  result: QuickSimResponse;
  career: Career;
  onClose: () => void;
}) {
  const winner = result.series.teams.find(
    (team) => team.teamId === result.series.winnerTeamId,
  );
  const loser = result.series.teams.find(
    (team) => team.teamId !== result.series.winnerTeamId,
  );
  const playerNames = new Map(
    career.teams.flatMap((team) =>
      [...team.starters, ...team.benches].map(
        (roster) =>
          [
            roster.careerPlayer.id,
            roster.careerPlayer.playerCard.player.nickname,
          ] as const,
      ),
    ),
  );

  return (
    <div
      className="quick-report-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="quick-report-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Sim 경기 결과"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="quick-report-header">
          <div>
            <span>FULL TIME · QUICK SIM</span>
            <h2>시리즈 종료</h2>
          </div>
          <button aria-label="결과 닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="series-scoreboard">
          <div className="winner-side">
            <span>WINNER</span>
            <strong>{winner?.teamCode ?? "-"}</strong>
          </div>
          <div className="series-score">
            <strong>{winner?.wins ?? 0}</strong>
            <span>:</span>
            <strong>{loser?.wins ?? 0}</strong>
            <small>BO{result.series.bestOf}</small>
          </div>
          <div>
            <span>RUNNER-UP</span>
            <strong>{loser?.teamCode ?? "-"}</strong>
          </div>
        </div>
        <div className="game-report-list">
          {result.series.games.map((game, index) => {
            const bestPlayer = game.teams
              .flatMap((team) => team.playerStats)
              .sort((left, right) => right.rating - left.rating)[0];

            return (
              <article key={game.matchId}>
                <div className="game-number">
                  <span>GAME</span>
                  <strong>{index + 1}</strong>
                </div>
                <div className="game-winner">
                  <span>WIN</span>
                  <strong>{game.winnerTeamCode}</strong>
                </div>
                <div className="game-duration">
                  <span>TIME</span>
                  <strong>{Math.round(game.durationMinutes)}'</strong>
                </div>
                <div className="game-mvp">
                  <span>MVP</span>
                  <strong>
                    {bestPlayer
                      ? (playerNames.get(bestPlayer.careerPlayerId) ??
                        `PLAYER ${bestPlayer.careerPlayerId}`)
                      : "-"}
                  </strong>
                  <small>
                    {bestPlayer
                      ? `${bestPlayer.kills}/${bestPlayer.deaths}/${bestPlayer.assists} · ${bestPlayer.rating.toFixed(1)}`
                      : ""}
                  </small>
                </div>
              </article>
            );
          })}
        </div>
        <button className="report-confirm-button" onClick={onClose}>
          시즌 허브로 돌아가기
        </button>
      </section>
    </div>
  );
}

function pickVisibleStage(split: LeagueSplit | null): LeagueStage | null {
  if (!split) return null;

  return (
    split.stages.find((stage) => stage.status === "ACTIVE") ??
    [...split.stages].reverse().find((stage) => stage.status === "COMPLETED") ??
    split.stages[0] ??
    null
  );
}

function findManagedStanding(stage: LeagueStage | null, teamId: number) {
  return stage?.standings.find((standing) => standing.teamId === teamId);
}

function formatRecord(
  standing: ReturnType<typeof findManagedStanding>,
): string {
  return standing
    ? `${standing.seriesWins}W ${standing.seriesLosses}L`
    : "0W 0L";
}

function includesTeam(fixture: CalendarFixture, teamId?: number): boolean {
  return Boolean(
    teamId && (fixture.teamA.id === teamId || fixture.teamB.id === teamId),
  );
}

function includesLeagueTeam(fixture: LeagueFixture, teamId: number): boolean {
  return fixture.teamA.id === teamId || fixture.teamB.id === teamId;
}

function parseGameDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

function formatGameDate(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(parseGameDate(date));
}

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(
    parseGameDate(date),
  );
}

function formatCompactDate(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(parseGameDate(date));
}

function formatDay(date: string): string {
  return String(parseGameDate(date).getDate()).padStart(2, "0");
}

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short" })
    .format(parseGameDate(date))
    .toUpperCase();
}

function daysUntil(from: string, to: string): string {
  const difference = Math.max(
    0,
    Math.round(
      (parseGameDate(to).getTime() - parseGameDate(from).getTime()) /
        86_400_000,
    ),
  );
  return `D-${difference}`;
}

function stageLabel(code: string): string {
  return code.replaceAll("_", " ");
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "요청을 처리하지 못했습니다.";
}
