import { useCallback, useEffect, useMemo, useState } from "react";
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
  QuickSimResponse,
} from "./types";

const EVENT_LABELS: Record<CalendarEvent["type"], string> = {
  SCHEDULED_GAME: "경기 일정",
  CONTRACT_RESPONSE: "계약 응답",
  LEGEND_REVEAL: "레전드 공개",
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
  FIXTURE_LIMIT: "한 번에 처리할 수 있는 경기 수에 도달했습니다.",
};

interface SeasonHubViewProps {
  career: Career;
  token: string;
  onBack: () => void;
  onCareerRefresh: () => Promise<void>;
}

export default function SeasonHubView({
  career,
  token,
  onBack,
  onCareerRefresh,
}: SeasonHubViewProps) {
  const managedTeam =
    career.teams.find((team) => team.isUserControlled) ?? career.teams[0];
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [splits, setSplits] = useState<LeagueSplit[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedSplitId, setSelectedSplitId] = useState<number | null>(null);
  const [quickResult, setQuickResult] = useState<QuickSimResponse | null>(null);
  const [fastResult, setFastResult] = useState<FastSimResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  const fetchSeasonData = useCallback(async () => {
    const [nextCalendar, nextSplits, nextEvents] = await Promise.all([
      apiRequest<CalendarResponse>(`/careers/${career.id}/calendar`, { token }),
      apiRequest<LeagueSplit[]>(`/careers/${career.id}/league-splits`, {
        token,
      }),
      apiRequest<CalendarEvent[]>(`/careers/${career.id}/events`, { token }),
    ]);

    setCalendar(nextCalendar);
    setSplits(nextSplits);
    setEvents(nextEvents);
    setSelectedSplitId((current) => {
      if (current && nextSplits.some((split) => split.id === current)) {
        return current;
      }

      return (
        nextSplits.find((split) => split.status === "IN_PROGRESS")?.id ??
        nextSplits.find((split) => split.status === "SCHEDULED")?.id ??
        nextSplits[0]?.id ??
        null
      );
    });
  }, [career.id, token]);

  useEffect(() => {
    let active = true;

    // oxlint-disable-next-line react/set-state-in-effect -- The async API result initializes this view.
    fetchSeasonData()
      .catch((loadError) => {
        if (active) setError(toMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
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

  async function performAction(key: string, action: () => Promise<void>) {
    setBusyAction(key);
    setError("");

    try {
      await action();
    } catch (actionError) {
      setError(toMessage(actionError));
    } finally {
      setBusyAction("");
    }
  }

  function advanceCalendar(mode: CalendarAdvanceMode) {
    void performAction(`advance-${mode}`, async () => {
      const result = await apiRequest<CalendarAdvanceResponse>(
        `/careers/${career.id}/calendar/advance`,
        { method: "POST", token, body: { mode } },
      );
      setCalendar(result);
      setFastResult(null);
      await refreshAfterMutation();
    });
  }

  function runFastSim(days: number) {
    void performAction(`fast-${days}`, async () => {
      const result = await apiRequest<FastSimResponse>(
        `/careers/${career.id}/simulations/fast`,
        { method: "POST", token, body: { days, maxFixtures: 50 } },
      );
      setCalendar(result.calendar);
      setFastResult(result);
      await refreshAfterMutation();
    });
  }

  function runQuickSim(fixture: CalendarFixture) {
    void performAction(`quick-${fixture.id}`, async () => {
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
      setQuickResult(result);
      setFastResult(null);
      await refreshAfterMutation();
    });
  }

  function resolveEvent(event: CalendarEvent) {
    void performAction(`event-${event.id}`, async () => {
      await apiRequest<CalendarEvent>(
        `/careers/${career.id}/events/${event.id}/resolve`,
        { method: "POST", token },
      );
      await refreshAfterMutation();
    });
  }

  function createSplit(splitNumber: number) {
    if (!managedTeam) return;

    void performAction(`split-${splitNumber}`, async () => {
      const created = await apiRequest<LeagueSplit>(
        `/careers/${career.id}/league-splits`,
        {
          method: "POST",
          token,
          body: { region: managedTeam.region, splitNumber },
        },
      );
      setSelectedSplitId(created.id);
      await refreshAfterMutation();
    });
  }

  if (!managedTeam) return null;

  if (loading || !calendar) {
    return (
      <section className="season-loading">
        <span className="season-loading-ball" />
        <strong>시즌 데이터를 불러오는 중</strong>
        <small>일정, 이벤트, 순위를 동기화하고 있습니다.</small>
      </section>
    );
  }

  const hasBlockingEvent = calendar.blockingEvents.length > 0;
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
            <small>{hasBlockingEvent ? "결정 대기 중" : "진행 가능"}</small>
          </div>
          <div className="time-control-grid">
            <button
              disabled={Boolean(busyAction) || hasBlockingEvent}
              onClick={() => advanceCalendar("ONE_DAY")}
            >
              <span>+1</span>
              <small>하루 진행</small>
            </button>
            <button
              disabled={Boolean(busyAction) || hasBlockingEvent}
              onClick={() => advanceCalendar("THREE_DAYS")}
            >
              <span>+3</span>
              <small>3일 진행</small>
            </button>
            <button
              disabled={Boolean(busyAction) || hasBlockingEvent || !nextFixture}
              onClick={() => runFastSim(7)}
            >
              <span>7D</span>
              <small>Fast Sim</small>
            </button>
            <button
              className="next-important-button"
              disabled={Boolean(busyAction) || hasBlockingEvent || !nextFixture}
              onClick={() => runFastSim(90)}
            >
              <span>▶</span>
              <small>다음 내 경기</small>
            </button>
          </div>
          <button
            className="next-event-button"
            disabled={
              Boolean(busyAction) || hasBlockingEvent || !nextScheduledEvent
            }
            onClick={() => advanceCalendar("NEXT_EVENT")}
          >
            다음 이벤트까지 진행
            <span>→</span>
          </button>
        </div>
      </header>

      {error && <div className="season-error-banner">{error}</div>}
      {fastResult && (
        <div className={`sim-status-banner stop-${fastResult.stopReason}`}>
          <div>
            <span>FAST SIM REPORT</span>
            <strong>{STOP_REASON_LABELS[fastResult.stopReason]}</strong>
          </div>
          <p>
            {fastResult.advancedDays}일 진행 · AI 경기 {fastResult.simulatedFixtures.length}개 처리
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
            {calendar.blockingEvents.map((event) => (
              <button
                key={event.id}
                disabled={Boolean(busyAction)}
                onClick={() => resolveEvent(event)}
              >
                {EVENT_LABELS[event.type]} 처리하기
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="season-primary-grid">
        <NextMatchCard
          fixture={nextFixture}
          currentDate={calendar.currentDate}
          managedTeamId={managedTeam.id}
          busy={Boolean(busyAction)}
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
              <i><b style={{ width: `${managedTeam.chemistry}%` }} /></i>
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
                  {split.region} S{split.splitNumber}
                </button>
              ))}
            </div>
          </div>

          {activeSplit && activeStage ? (
            <>
              <div className="active-stage-bar">
                <div>
                  <span>{activeSplit.name}</span>
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
              busy={Boolean(busyAction)}
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
              <b>{events.filter((event) => event.status !== "COMPLETED").length}</b>
            </div>
            <EventFeed
              events={events}
              busy={Boolean(busyAction)}
              onResolve={resolveEvent}
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
                disabled={Boolean(busyAction)}
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
        <strong>{fixture.region} · SPLIT {fixture.splitNumber}</strong>
      </div>
      <div className="match-date-line">
        <span>{formatCompactDate(fixture.scheduledDate)}</span>
        <i />
        <strong>{stageLabel(fixture.stageCode)}</strong>
        <em>BO{fixture.bestOf}</em>
      </div>
      <div className="fixture-versus">
        <TeamBadge team={fixture.teamA} managed={fixture.teamA.id === managedTeamId} />
        <div className="versus-mark">
          <span>ROUND {fixture.roundNumber}</span>
          <strong>VS</strong>
          <small>{due ? "MATCH DAY" : daysUntil(currentDate, fixture.scheduledDate)}</small>
        </div>
        <TeamBadge team={fixture.teamB} managed={fixture.teamB.id === managedTeamId} />
      </div>
      <button
        className="quick-sim-button"
        disabled={busy || !due || !managed}
        onClick={() => onQuickSim(fixture)}
      >
        <span>{due && managed ? "QUICK SIM" : managed ? "경기일 대기" : "AI 경기"}</span>
        <strong>{due && managed ? "시리즈 전체 진행 →" : "FAST SIM으로 처리"}</strong>
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
        <span>순위</span><span>구단</span><span>경기</span><span>승</span><span>패</span><span>세트 득실</span>
      </div>
      {stage.standings.map((standing) => (
        <div
          className={`standing-row ${standing.teamId === managedTeamId ? "managed" : ""}`}
          key={standing.teamId}
        >
          <strong className="standing-rank">{standing.rank}</strong>
          <div className="standing-team">
            <i>{standing.teamCode.slice(0, 3)}</i>
            <span><strong>{standing.teamCode}</strong><small>{standing.teamName}</small></span>
          </div>
          <span>{standing.played}</span>
          <b>{standing.seriesWins}</b>
          <span>{standing.seriesLosses}</span>
          <em className={standing.gameDifference >= 0 ? "positive" : "negative"}>
            {standing.gameDifference > 0 ? "+" : ""}{standing.gameDifference}
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
    .sort((left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate) || left.id - right.id,
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
          className={includesLeagueTeam(fixture, managedTeamId) ? "managed" : ""}
          key={fixture.id}
        >
          <div className="fixture-list-date">
            <strong>{formatDay(fixture.scheduledDate)}</strong>
            <span>{formatMonth(fixture.scheduledDate)}</span>
          </div>
          <div className="fixture-list-teams">
            <span>{fixture.teamA.code}</span>
            <b>{fixture.teamAWins} : {fixture.teamBWins}</b>
            <span>{fixture.teamB.code}</span>
          </div>
          <div className="fixture-list-state">
            <span>R{fixture.roundNumber}</span>
            <strong>{fixture.status === "IN_PROGRESS" ? "진행 중" : `BO${fixture.bestOf}`}</strong>
          </div>
        </article>
      ))}
    </div>
  );
}

function EventFeed({
  events,
  busy,
  onResolve,
}: {
  events: CalendarEvent[];
  busy: boolean;
  onResolve: (event: CalendarEvent) => void;
}) {
  const visibleEvents = events
    .filter((event) => event.status !== "COMPLETED")
    .slice(0, 5);

  if (visibleEvents.length === 0) {
    return <div className="panel-empty">대기 중인 이벤트가 없습니다.</div>;
  }

  return (
    <div className="event-feed">
      {visibleEvents.map((event) => (
        <article className={`event-${event.status}`} key={event.id}>
          <i>{event.requiresUserAction ? "!" : "•"}</i>
          <div>
            <span>{formatCompactDate(event.scheduledDate)}</span>
            <strong>{EVENT_LABELS[event.type]}</strong>
            <small>{event.status === "READY" ? "감독 결정 대기" : "예정"}</small>
          </div>
          {event.status === "READY" && (
            <button disabled={busy} onClick={() => onResolve(event)}>처리</button>
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
      [...team.starters, ...team.benches].map((roster) => [
        roster.careerPlayer.id,
        roster.careerPlayer.playerCard.player.nickname,
      ] as const),
    ),
  );

  return (
    <div className="quick-report-backdrop" role="presentation" onMouseDown={onClose}>
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
          <button aria-label="결과 닫기" onClick={onClose}>×</button>
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
                <div className="game-number"><span>GAME</span><strong>{index + 1}</strong></div>
                <div className="game-winner"><span>WIN</span><strong>{game.winnerTeamCode}</strong></div>
                <div className="game-duration"><span>TIME</span><strong>{Math.round(game.durationMinutes)}'</strong></div>
                <div className="game-mvp">
                  <span>MVP</span>
                  <strong>{bestPlayer ? playerNames.get(bestPlayer.careerPlayerId) ?? `PLAYER ${bestPlayer.careerPlayerId}` : "-"}</strong>
                  <small>{bestPlayer ? `${bestPlayer.kills}/${bestPlayer.deaths}/${bestPlayer.assists} · ${bestPlayer.rating.toFixed(1)}` : ""}</small>
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
  return standing ? `${standing.seriesWins}W ${standing.seriesLosses}L` : "0W 0L";
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
    Math.round((parseGameDate(to).getTime() - parseGameDate(from).getTime()) / 86_400_000),
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
