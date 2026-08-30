import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./App.css";
import SquadView from "./SquadView";
import {
  ApiError,
  apiRequest,
  clearStoredAccessToken,
  getStoredAccessToken,
  storeAccessToken,
} from "./api";
import {
  POSITIONS,
  type Account,
  type AuthResponse,
  type Career,
  type CareerPlayer,
  type CareerSummary,
  type CreateCareerPayload,
  type PlayerCard,
  type Position,
  type Region,
  type SwapStarterResponse,
} from "./types";

type AppView = "saves" | "create" | "career" | "squad";
type AuthMode = "login" | "register";

interface TeamDraft {
  code: string;
  name: string;
  region: Region;
  selections: Record<Position, string>;
}

const POSITION_LABELS: Record<Position, string> = {
  TOP: "TOP",
  JUNGLE: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUP",
};

const LOCKED_START_YEAR = 2026;

const PLAYER_STAT_LABELS = [
  ["mechanics", "메카닉"],
  ["gameSense", "게임 이해도"],
  ["laning", "라인전"],
  ["teamFight", "한타"],
  ["macro", "운영"],
  ["teamPlay", "팀플레이"],
  ["mental", "멘탈"],
  ["championPool", "챔피언 폭"],
] as const;

const STRATEGY_LABELS: Record<string, string> = {
  BALANCED: "균형 운영",
  TOP_CARRY: "탑 캐리",
  TOP_JUNGLE: "탑·정글",
  MID_CARRY: "미드 캐리",
  MID_JUNGLE: "미드·정글",
  UPPER_SIDE: "상체 중심",
  BOT_CARRY: "바텀 캐리",
  BOT_PRESSURE: "바텀 압박",
};

const FALLBACK_IMAGES: Record<Position, [string, string]> = {
  TOP: ["/player-cards/dev-blue-top.svg", "/player-cards/dev-red-top.svg"],
  JUNGLE: [
    "/player-cards/dev-blue-jungle.svg",
    "/player-cards/dev-red-jungle.svg",
  ],
  MID: ["/player-cards/dev-blue-mid.svg", "/player-cards/dev-red-mid.svg"],
  ADC: ["/player-cards/dev-blue-adc.svg", "/player-cards/dev-red-adc.svg"],
  SUPPORT: [
    "/player-cards/dev-blue-support.svg",
    "/player-cards/dev-red-support.svg",
  ],
};

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [careers, setCareers] = useState<CareerSummary[]>([]);
  const [playerCards, setPlayerCards] = useState<PlayerCard[]>([]);
  const [activeCareer, setActiveCareer] = useState<Career | null>(null);
  const [view, setView] = useState<AppView>("saves");
  const [booting, setBooting] = useState(() => Boolean(getStoredAccessToken()));
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    const savedToken = getStoredAccessToken();

    if (!savedToken) {
      return;
    }

    Promise.all([
      apiRequest<Account>("/auth/me", { token: savedToken }),
      apiRequest<CareerSummary[]>("/careers", { token: savedToken }),
    ])
      .then(([savedAccount, savedCareers]) => {
        setToken(savedToken);
        setAccount(savedAccount);
        setCareers(savedCareers);
      })
      .catch(() => clearStoredAccessToken())
      .finally(() => setBooting(false));
  }, []);

  async function finishAuthentication(response: AuthResponse) {
    const savedCareers = await apiRequest<CareerSummary[]>("/careers", {
      token: response.accessToken,
    });
    storeAccessToken(response.accessToken);
    setToken(response.accessToken);
    setAccount(response.account);
    setCareers(savedCareers);
    setPageError("");
    setView("saves");
  }

  async function logout() {
    if (token) {
      await apiRequest<{ message: string }>("/auth/logout", {
        method: "POST",
        token,
      }).catch(() => undefined);
    }
    clearStoredAccessToken();
    setToken(null);
    setAccount(null);
    setCareers([]);
    setActiveCareer(null);
    setView("saves");
  }

  async function openCareer(id: number) {
    if (!token) return;
    setPageError("");
    try {
      const career = await apiRequest<Career>(`/careers/${id}`, { token });
      setActiveCareer(career);
      setView("career");
    } catch (error) {
      handleAuthenticatedError(error);
    }
  }

  async function openCreateCareer() {
    setPageError("");
    setView("create");

    if (playerCards.length > 0) return;

    try {
      setPlayerCards(await apiRequest<PlayerCard[]>("/player-cards"));
    } catch (error) {
      setPageError(toMessage(error));
    }
  }

  async function createCareer(payload: CreateCareerPayload) {
    if (!token) return;
    setPageError("");
    try {
      const career = await apiRequest<Career>("/careers", {
        method: "POST",
        token,
        body: payload,
      });
      const savedCareers = await apiRequest<CareerSummary[]>("/careers", {
        token,
      });
      setCareers(savedCareers);
      setActiveCareer(career);
      setView("career");
    } catch (error) {
      handleAuthenticatedError(error);
      throw error;
    }
  }

  async function swapStarter(
    teamId: number,
    position: Position,
    benchCareerPlayerId: number,
  ) {
    if (!token || !activeCareer) return;
    setPageError("");

    try {
      await apiRequest<SwapStarterResponse>(
        `/careers/${activeCareer.id}/teams/${teamId}/starters/${position}/swap`,
        {
          method: "PATCH",
          token,
          body: { benchCareerPlayerId },
        },
      );
      const refreshedCareer = await apiRequest<Career>(
        `/careers/${activeCareer.id}`,
        { token },
      );
      setActiveCareer(refreshedCareer);
    } catch (error) {
      handleAuthenticatedError(error);
      throw error;
    }
  }

  function handleAuthenticatedError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      void logout();
      return;
    }
    setPageError(toMessage(error));
  }

  if (booting) return <LoadingScreen />;
  if (!account || !token)
    return <AuthScreen onAuthenticated={finishAuthentication} />;

  return (
    <div className="app-shell">
      <AppHeader
        account={account}
        view={view}
        onHome={() => setView("saves")}
        onCreate={() => void openCreateCareer()}
        onSquad={() => setView("squad")}
        hasActiveCareer={activeCareer !== null}
        onLogout={() => void logout()}
      />

      <main className="app-main">
        {pageError && <div className="notice error-notice">{pageError}</div>}

        {view === "saves" && (
          <SaveSelectScreen
            account={account}
            careers={careers}
            onOpen={openCareer}
            onCreate={() => void openCreateCareer()}
          />
        )}

        {view === "create" && (
          <CreateCareerScreen
            key={playerCards.length}
            playerCards={playerCards}
            onBack={() => setView("saves")}
            onSubmit={createCareer}
          />
        )}

        {view === "career" && activeCareer && (
          <CareerDashboard
            career={activeCareer}
            onBack={() => setView("saves")}
            onOpenSquad={() => setView("squad")}
          />
        )}

        {view === "squad" && activeCareer && (
          <SquadView
            career={activeCareer}
            onBack={() => setView("career")}
            onSwapStarter={swapStarter}
          />
        )}
      </main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">GM</div>
      <p>세이브 데이터를 불러오는 중</p>
      <span className="loading-line" />
    </main>
  );
}

function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (response: AuthResponse) => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await apiRequest<AuthResponse>(`/auth/${mode}`, {
        method: "POST",
        body:
          mode === "register"
            ? { email, password, displayName }
            : { email, password },
      });
      await onAuthenticated(response);
    } catch (submitError) {
      setError(toMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
  }

  return (
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="auth-brand">
          <span>GM</span> LEAGUE OFFICE
        </div>
        <div className="hero-copy">
          <p className="eyebrow">THE SEASON STARTS HERE</p>
          <h1>
            당신의 팀.
            <br />
            당신의 왕조.
          </h1>
          <p>
            신인 선발부터 메타 대응까지. 감독의 모든 결정이 다음 시즌의 기록이
            됩니다.
          </p>
        </div>
        <div className="card-fan" aria-hidden="true">
          <img src="/player-cards/dev-red-mid.svg" alt="" />
          <img src="/player-cards/dev-blue-adc.svg" alt="" />
          <img src="/player-cards/dev-blue-top.svg" alt="" />
        </div>
        <div className="hero-stat">
          <strong>10</strong>
          <span>STARTING PLAYERS</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">FRONT OFFICE ACCESS</p>
          <h2>{mode === "login" ? "감독실로 돌아가기" : "새 감독 프로필"}</h2>
          <p className="form-intro">
            {mode === "login"
              ? "계정에 연결된 커리어를 불러와 마지막 시즌부터 계속합니다."
              : "계정을 만들면 커리어 진행 상황이 서버에 저장됩니다."}
          </p>

          <div className="mode-tabs" role="tablist" aria-label="계정 메뉴">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => changeMode("login")}
            >
              로그인
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => changeMode("register")}
            >
              회원가입
            </button>
          </div>

          <form onSubmit={submit}>
            {mode === "register" && (
              <label>
                감독 이름
                <input
                  required
                  maxLength={50}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="게임에서 사용할 이름"
                />
              </label>
            )}
            <label>
              이메일
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="coach@example.com"
                autoComplete="email"
              />
            </label>
            <label>
              비밀번호
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="8자 이상"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </label>
            {error && <div className="inline-error">{error}</div>}
            <button
              className="primary-button auth-submit"
              disabled={submitting}
            >
              {submitting
                ? "처리 중..."
                : mode === "login"
                  ? "커리어 불러오기"
                  : "감독 등록하기"}
            </button>
          </form>

          <div className="save-note">
            <span className="save-dot" />
            <div>
              <strong>서버 자동 저장</strong>
              <small>사이트를 닫아도 MySQL에 저장된 커리어는 유지됩니다.</small>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function AppHeader({
  account,
  view,
  onHome,
  onCreate,
  onSquad,
  hasActiveCareer,
  onLogout,
}: {
  account: Account;
  view: AppView;
  onHome: () => void;
  onCreate: () => void;
  onSquad: () => void;
  hasActiveCareer: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="app-header">
      <button className="wordmark" onClick={onHome}>
        <span>GM</span> LEAGUE OFFICE
      </button>
      <nav aria-label="주요 메뉴">
        <button className={view === "saves" ? "active" : ""} onClick={onHome}>
          커리어
        </button>
        {hasActiveCareer && (
          <button
            className={view === "squad" ? "active" : ""}
            onClick={onSquad}
          >
            선수단
          </button>
        )}
        <button
          className={view === "create" ? "active" : ""}
          onClick={onCreate}
        >
          새 게임
        </button>
      </nav>
      <div className="account-menu">
        <div className="avatar">
          {account.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <strong>{account.displayName}</strong>
          <small>HEAD COACH</small>
        </div>
        <button className="text-button" onClick={onLogout}>
          로그아웃
        </button>
      </div>
    </header>
  );
}

function SaveSelectScreen({
  account,
  careers,
  onOpen,
  onCreate,
}: {
  account: Account;
  careers: CareerSummary[];
  onOpen: (id: number) => Promise<void>;
  onCreate: () => void;
}) {
  const [openingId, setOpeningId] = useState<number | null>(null);

  async function open(id: number) {
    setOpeningId(id);
    await onOpen(id);
    setOpeningId(null);
  }

  return (
    <section className="page-section">
      <div className="page-heading split-heading">
        <div>
          <p className="eyebrow">CAREER ARCHIVE</p>
          <h1>
            다시 지휘할 시간입니다,
            <br />
            {account.displayName} 감독님.
          </h1>
          <p>계정에 저장된 구단을 선택하거나 새로운 시즌을 시작하세요.</p>
        </div>
        <div className="sync-status">
          <span className="save-dot" />
          <strong>DB CONNECTED</strong>
          <small>커리어 자동 저장 활성</small>
        </div>
      </div>

      <div className="save-grid">
        {careers.map((career, index) => (
          <article className="save-card" key={career.id}>
            <div className={`save-card-accent accent-${index % 3}`} />
            <div className="save-card-top">
              <span className="season-tag">{career.currentYear} SEASON</span>
              <span className="autosave-label">
                <i />
                AUTO SAVED
              </span>
            </div>
            <div className="team-monogram">
              {career.managedTeamCode.slice(0, 3)}
            </div>
            <p className="team-code">{career.managedTeamCode}</p>
            <h2>{career.managedTeamName}</h2>
            <dl className="save-meta">
              <div>
                <dt>시작 시즌</dt>
                <dd>{career.startYear}</dd>
              </div>
              <div>
                <dt>현재 메타</dt>
                <dd>
                  {STRATEGY_LABELS[career.currentMeta] ?? career.currentMeta}
                </dd>
              </div>
              <div>
                <dt>세이브 ID</dt>
                <dd>#{String(career.id).padStart(4, "0")}</dd>
              </div>
            </dl>
            <button
              className="primary-button"
              disabled={openingId !== null}
              onClick={() => void open(career.id)}
            >
              {openingId === career.id ? "불러오는 중..." : "커리어 계속하기"}{" "}
              <span>→</span>
            </button>
          </article>
        ))}

        <button className="new-save-card" onClick={onCreate}>
          <span className="plus-mark">+</span>
          <strong>새 커리어</strong>
          <small>
            두 팀과 선발 로스터를 구성해
            <br />
            새로운 시즌을 시작합니다.
          </small>
        </button>
      </div>

      {careers.length === 0 && (
        <div className="empty-hint">
          아직 저장된 커리어가 없습니다. 첫 번째 팀을 만들어 보세요.
        </div>
      )}
    </section>
  );
}

function CreateCareerScreen({
  playerCards,
  onBack,
  onSubmit,
}: {
  playerCards: PlayerCard[];
  onBack: () => void;
  onSubmit: (payload: CreateCareerPayload) => Promise<void>;
}) {
  const defaults = useMemo(
    () => createDefaultSelections(playerCards),
    [playerCards],
  );
  const [managedTeam, setManagedTeam] = useState(0);
  const [teams, setTeams] = useState<[TeamDraft, TeamDraft]>([
    {
      code: "SVG",
      name: "Seoul Vanguard",
      region: "LCK",
      selections: defaults[0],
    },
    {
      code: "BSB",
      name: "Busan Breakers",
      region: "LCK",
      selections: defaults[1],
    },
  ]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [detailCard, setDetailCard] = useState<PlayerCard | null>(null);

  function updateSelection(
    teamIndex: number,
    position: Position,
    cardId: string,
  ) {
    setTeams(
      (current) =>
        current.map((team, index) =>
          index === teamIndex
            ? {
                ...team,
                selections: { ...team.selections, [position]: cardId },
              }
            : team,
        ) as [TeamDraft, TeamDraft],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const codes = teams.map((team) => normalizeTeamCode(team.code));
    const allCardIds = teams.flatMap((team) =>
      POSITIONS.map((position) => Number(team.selections[position])),
    );

    if (codes[0] === codes[1]) {
      setError("두 팀의 코드는 서로 달라야 합니다.");
      return;
    }
    if (
      allCardIds.some((id) => !id) ||
      new Set(allCardIds).size !== allCardIds.length
    ) {
      setError("10명의 선발 선수는 중복 없이 모두 선택해야 합니다.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        startYear: LOCKED_START_YEAR,
        managedTeamCode: codes[managedTeam],
        teams: teams.map((team, index) => ({
          code: codes[index],
          name: team.name.trim(),
          region: team.region,
          starters: POSITIONS.map((position) => ({
            playerCardId: Number(team.selections[position]),
            position,
          })),
        })),
      });
    } catch (submitError) {
      setError(toMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  if (playerCards.length === 0) {
    return (
      <section className="center-panel">
        <div className="loading-line" />
        <p>선수 카드를 불러오는 중입니다.</p>
        <button className="text-button" onClick={onBack}>
          돌아가기
        </button>
      </section>
    );
  }

  return (
    <section className="page-section create-page">
      <button className="back-button" onClick={onBack}>
        ← 커리어 목록
      </button>
      <div className="page-heading">
        <p className="eyebrow">NEW CAREER</p>
        <h1>
          리그의 새로운 역사를
          <br />
          설계하세요.
        </h1>
        <p>
          두 구단과 각 포지션의 선발 선수를 확정하면 첫 시즌이 서버에
          생성됩니다.
        </p>
      </div>

      <form onSubmit={submit}>
        <div className="career-settings">
          <div className="locked-setting">
            <span>시작 연도</span>
            <strong>{LOCKED_START_YEAR}</strong>
            <small>고정</small>
          </div>
          <div className="managed-team-field">
            <span>내가 운영할 팀</span>
            <div className="segmented-control">
              {teams.map((team, index) => (
                <button
                  type="button"
                  className={managedTeam === index ? "active" : ""}
                  key={index}
                  onClick={() => setManagedTeam(index)}
                >
                  TEAM {index + 1} · {team.code || "---"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="team-builder-grid">
          {teams.map((team, index) => (
            <TeamBuilder
              key={index}
              index={index}
              team={team}
              playerCards={playerCards}
              isManaged={managedTeam === index}
              onSelect={(position, cardId) =>
                updateSelection(index, position, cardId)
              }
              onOpenDetail={setDetailCard}
            />
          ))}
        </div>

        {error && <div className="inline-error form-wide-error">{error}</div>}
        <div className="create-actions">
          <div>
            <strong>생성 즉시 저장</strong>
            <small>계정 소유권과 함께 MySQL에 기록됩니다.</small>
          </div>
          <button className="primary-button large-button" disabled={submitting}>
            {submitting ? "리그 생성 중..." : "새 시즌 시작하기"} <span>→</span>
          </button>
        </div>
      </form>
      {detailCard && (
        <PlayerDetailModal
          card={detailCard}
          onClose={() => setDetailCard(null)}
        />
      )}
    </section>
  );
}

function TeamBuilder({
  index,
  team,
  playerCards,
  isManaged,
  onSelect,
  onOpenDetail,
}: {
  index: number;
  team: TeamDraft;
  playerCards: PlayerCard[];
  isManaged: boolean;
  onSelect: (position: Position, cardId: string) => void;
  onOpenDetail: (card: PlayerCard) => void;
}) {
  return (
    <fieldset className={`team-builder team-${index + 1}`}>
      <legend>
        <span>TEAM {index + 1}</span>
        {isManaged && <em>MY CLUB</em>}
      </legend>
      <div className="locked-team-data">
        <div className="locked-team-name">
          <span>구단</span>
          <strong>{team.name}</strong>
        </div>
        <div>
          <span>코드</span>
          <strong>{team.code}</strong>
        </div>
        <div>
          <span>지역</span>
          <strong>{team.region}</strong>
        </div>
        <small>리그 기본 설정 · 변경 불가</small>
      </div>
      <div className="lineup-title">
        <strong>STARTING FIVE</strong>
        <span>OVR과 주요 능력치를 비교해 선발을 정하세요.</span>
      </div>
      <div className="starter-table-head" aria-hidden="true">
        <span>POS</span>
        <span>PLAYER</span>
        <span>OVR</span>
        <span>MEC</span>
        <span>LAN</span>
        <span>FIGHT</span>
        <span />
      </div>
      <div className="starter-list">
        {POSITIONS.map((position) => {
          const candidates = playerCards.filter(
            (card) => card.mainPosition === position,
          );
          const selected = candidates.find(
            (card) => String(card.id) === team.selections[position],
          );
          return (
            <article className="starter-row" key={position}>
              <span className="position-chip">{POSITION_LABELS[position]}</span>
              <div className="starter-player-control">
                {selected && <img src={cardImage(selected, index)} alt="" />}
                <div>
                  <select
                    required
                    aria-label={`${POSITION_LABELS[position]} 선발 선수`}
                    value={team.selections[position]}
                    onChange={(event) => onSelect(position, event.target.value)}
                  >
                    <option value="">선수 선택</option>
                    {candidates.map((card) => (
                      <option value={card.id} key={card.id}>
                        {card.player.nickname} · OVR{" "}
                        {calculateCardOverall(card)}
                      </option>
                    ))}
                  </select>
                  <small>
                    {selected
                      ? `${selected.player.nationality} · ${selected.theme.name}`
                      : "선수를 선택하세요"}
                  </small>
                </div>
              </div>
              <strong className="starter-ovr">
                {selected ? calculateCardOverall(selected) : "-"}
              </strong>
              <span className="starter-stat">{selected?.mechanics ?? "-"}</span>
              <span className="starter-stat">{selected?.laning ?? "-"}</span>
              <span className="starter-stat">{selected?.teamFight ?? "-"}</span>
              <button
                className="detail-button"
                type="button"
                disabled={!selected}
                onClick={() => selected && onOpenDetail(selected)}
              >
                상세
              </button>
            </article>
          );
        })}
      </div>
    </fieldset>
  );
}

function CareerDashboard({
  career,
  onBack,
  onOpenSquad,
}: {
  career: Career;
  onBack: () => void;
  onOpenSquad: () => void;
}) {
  const managedTeam =
    career.teams.find((team) => team.isUserControlled) ?? career.teams[0];
  const [selectedTeamId, setSelectedTeamId] = useState(
    managedTeam?.id ?? career.teams[0]?.id,
  );
  const [detailPlayer, setDetailPlayer] = useState<CareerPlayer | null>(null);
  const selectedTeam =
    career.teams.find((team) => team.id === selectedTeamId) ?? managedTeam;

  if (!selectedTeam) return null;

  const rosterOverall = Math.round(
    selectedTeam.starters.reduce(
      (total, roster) => total + calculatePlayerOverall(roster.careerPlayer),
      0,
    ) / Math.max(selectedTeam.starters.length, 1),
  );

  return (
    <section className="dashboard-page">
      <div className="dashboard-topbar">
        <button className="back-button" onClick={onBack}>
          ← 세이브 목록
        </button>
        <div className="season-info">
          <span>{career.currentYear} SEASON</span>
          <strong>
            {STRATEGY_LABELS[career.currentMeta] ?? career.currentMeta} META
          </strong>
        </div>
        <div className="dashboard-actions">
          <div className="saved-state">
            <span className="save-dot" />
            ALL CHANGES SAVED
          </div>
          <button
            className="squad-link-button"
            type="button"
            onClick={onOpenSquad}
          >
            선수단 전체 보기 →
          </button>
        </div>
      </div>

      <section className="club-hero">
        <div className="club-identity">
          <div className="club-crest">{managedTeam.code.slice(0, 3)}</div>
          <div>
            <p className="eyebrow">MANAGED CLUB · {managedTeam.region}</p>
            <h1>{managedTeam.name}</h1>
            <p>
              {managedTeam.code} · Career #{career.id}
            </p>
          </div>
        </div>
        <div className="club-metrics">
          <Metric label="TEAM OVR" value={rosterOverall} />
          <Metric label="CHEMISTRY" value={managedTeam.chemistry} suffix="%" />
          <Metric
            label="STRATEGY"
            value={
              STRATEGY_LABELS[managedTeam.teamStrategy] ??
              managedTeam.teamStrategy
            }
            text
          />
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="roster-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ACTIVE ROSTER</p>
              <h2>선발 라인업</h2>
            </div>
            <div className="team-switcher">
              {career.teams.map((team) => (
                <button
                  className={team.id === selectedTeam.id ? "active" : ""}
                  key={team.id}
                  onClick={() => setSelectedTeamId(team.id)}
                >
                  {team.code}
                </button>
              ))}
            </div>
          </div>
          <div className="roster-table-head">
            <span>POS</span>
            <span>PLAYER</span>
            <span>OVR</span>
            <span>FORM</span>
            <span>COND</span>
          </div>
          <div className="roster-list">
            {selectedTeam.starters.map((roster, index) => (
              <PlayerRow
                key={roster.id}
                player={roster.careerPlayer}
                position={
                  roster.starterPosition ?? roster.careerPlayer.currentPosition
                }
                imageIndex={index}
                onOpen={() => setDetailPlayer(roster.careerPlayer)}
              />
            ))}
          </div>
        </section>

        <aside className="side-panels">
          <section className="info-panel">
            <p className="eyebrow">TEAM IDENTITY</p>
            <h2>{selectedTeam.name}</h2>
            <dl className="compact-stats">
              <div>
                <dt>지역</dt>
                <dd>{selectedTeam.region}</dd>
              </div>
              <div>
                <dt>운영 전술</dt>
                <dd>
                  {STRATEGY_LABELS[selectedTeam.teamStrategy] ??
                    selectedTeam.teamStrategy}
                </dd>
              </div>
              <div>
                <dt>팀워크</dt>
                <dd>{selectedTeam.chemistry}</dd>
              </div>
            </dl>
          </section>
          <section className="info-panel">
            <p className="eyebrow">STRATEGY MASTERY</p>
            <h2>전술 숙련도</h2>
            <div className="proficiency-list">
              {selectedTeam.strategyProficiencies
                .slice()
                .sort((a, b) => b.proficiency - a.proficiency)
                .slice(0, 5)
                .map((item) => (
                  <div key={item.strategy}>
                    <span>
                      {STRATEGY_LABELS[item.strategy] ?? item.strategy}
                    </span>
                    <strong>{item.proficiency}</strong>
                    <i>
                      <b style={{ width: `${item.proficiency}%` }} />
                    </i>
                  </div>
                ))}
            </div>
          </section>
          <section className="phase-note">
            <span>FRONTEND 01</span>
            <strong>저장 데이터 연결 완료</strong>
            <p>
              다음 화면부터 일정 진행, 훈련, 경기 운영을 이 커리어에 이어 붙일
              수 있습니다.
            </p>
          </section>
        </aside>
      </div>
      {detailPlayer && (
        <PlayerDetailModal
          card={detailPlayer.playerCard}
          careerPlayer={detailPlayer}
          onClose={() => setDetailPlayer(null)}
        />
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  suffix = "",
  text = false,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  text?: boolean;
}) {
  return (
    <div className={`metric ${text ? "text-metric" : ""}`}>
      <span>{label}</span>
      <strong>
        {value}
        {suffix}
      </strong>
    </div>
  );
}

function PlayerRow({
  player,
  position,
  imageIndex,
  onOpen,
}: {
  player: CareerPlayer;
  position: Position;
  imageIndex: number;
  onOpen: () => void;
}) {
  return (
    <button
      className="player-row"
      type="button"
      onClick={onOpen}
      aria-label={`${player.playerCard.player.nickname} 상세 보기`}
    >
      <span className="position-chip">{POSITION_LABELS[position]}</span>
      <div className="player-profile">
        <img
          src={cardImage(player.playerCard, imageIndex)}
          alt={`${player.playerCard.player.nickname} 선수 카드`}
        />
        <div>
          <small>
            {player.playerCard.player.nationality} · AGE {player.currentAge}
          </small>
          <strong>{player.playerCard.player.nickname}</strong>
          <span>{player.playerCard.theme.name}</span>
        </div>
      </div>
      <strong className="ovr-value">{calculatePlayerOverall(player)}</strong>
      <div className="mini-stat">
        <strong>{player.form}</strong>
        <i>
          <b style={{ width: `${player.form}%` }} />
        </i>
      </div>
      <div className="mini-stat">
        <strong>{player.condition}</strong>
        <i>
          <b style={{ width: `${player.condition}%` }} />
        </i>
      </div>
    </button>
  );
}

function PlayerDetailModal({
  card,
  careerPlayer,
  onClose,
}: {
  card: PlayerCard;
  careerPlayer?: CareerPlayer;
  onClose: () => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const currentValues = careerPlayer
    ? [
        careerPlayer.currentMechanics,
        careerPlayer.currentGameSense,
        careerPlayer.currentLaning,
        careerPlayer.currentTeamFight,
        careerPlayer.currentMacro,
        careerPlayer.currentTeamPlay,
        careerPlayer.currentMental,
        careerPlayer.currentChampionPool,
      ]
    : null;
  const stats = PLAYER_STAT_LABELS.map(([key, label], index) => ({
    key,
    label,
    value: currentValues?.[index] ?? card[key],
  }));
  const overall = careerPlayer
    ? calculatePlayerOverall(careerPlayer)
    : calculateCardOverall(card);
  const age = careerPlayer?.currentAge ?? card.startingAge;

  return (
    <div
      className="player-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="player-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-detail-title"
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="선수 상세 닫기"
        >
          ×
        </button>
        <div className="player-modal-visual">
          <span className="modal-position">
            {POSITION_LABELS[card.mainPosition]}
          </span>
          <img
            src={cardImage(card, card.id)}
            alt={`${card.player.nickname} 선수 카드`}
          />
          <div className="modal-overall">
            <small>OVR</small>
            <strong>{overall}</strong>
          </div>
        </div>

        <div className="player-modal-content">
          <p className="modal-kicker">PLAYER PROFILE</p>
          <h2 id="player-detail-title">{card.player.nickname}</h2>
          <p className="modal-subtitle">
            {card.player.nationality} · AGE {age} · {card.theme.name}
          </p>

          <div className="player-meta-grid">
            <div>
              <span>주 포지션</span>
              <strong>{POSITION_LABELS[card.mainPosition]}</strong>
            </div>
            <div>
              <span>성향</span>
              <strong>{careerPlayer?.personality ?? card.personality}</strong>
            </div>
            <div>
              <span>시즌</span>
              <strong>{card.cardYear}</strong>
            </div>
            {careerPlayer && (
              <div>
                <span>감독 신뢰</span>
                <strong>{careerPlayer.coachTrust}</strong>
              </div>
            )}
          </div>

          <div className="detail-stat-grid">
            {stats.map((stat) => (
              <div className="detail-stat" key={stat.key}>
                <div>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
                <i>
                  <b
                    className={
                      stat.value >= 85
                        ? "elite"
                        : stat.value >= 75
                          ? "good"
                          : ""
                    }
                    style={{ width: `${stat.value}%` }}
                  />
                </i>
              </div>
            ))}
          </div>

          {careerPlayer && (
            <div className="live-state-strip">
              <div>
                <span>FORM</span>
                <strong>{careerPlayer.form}</strong>
              </div>
              <div>
                <span>CONDITION</span>
                <strong>{careerPlayer.condition}</strong>
              </div>
              <div>
                <span>현재 포지션</span>
                <strong>{POSITION_LABELS[careerPlayer.currentPosition]}</strong>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function calculateCardOverall(card: PlayerCard) {
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

function calculatePlayerOverall(player: CareerPlayer) {
  return Math.round(
    (player.currentMechanics +
      player.currentGameSense +
      player.currentLaning +
      player.currentTeamFight +
      player.currentMacro +
      player.currentTeamPlay +
      player.currentMental +
      player.currentChampionPool) /
      8,
  );
}

function cardImage(card: PlayerCard, index: number) {
  return card.imageUrl || FALLBACK_IMAGES[card.mainPosition][index % 2];
}

function emptySelections(): Record<Position, string> {
  return { TOP: "", JUNGLE: "", MID: "", ADC: "", SUPPORT: "" };
}

function createDefaultSelections(
  cards: PlayerCard[],
): [Record<Position, string>, Record<Position, string>] {
  const first = emptySelections();
  const second = emptySelections();
  for (const position of POSITIONS) {
    const candidates = cards.filter((card) => card.mainPosition === position);
    first[position] = candidates[0] ? String(candidates[0].id) : "";
    second[position] = candidates[1] ? String(candidates[1].id) : "";
  }
  return [first, second];
}

function normalizeTeamCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, 32);
}

function toMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "알 수 없는 오류가 발생했습니다.";
}

export default App;
