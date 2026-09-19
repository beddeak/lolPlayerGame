import { useEffect, useRef, useState, type FormEvent } from "react";
import ClubSelectionView from "./ClubSelectionView";
import ClubLogo from "./ClubLogo";
import GoogleAuthButton from "./GoogleAuthButton";
import GoogleAccountLink from "./GoogleAccountLink";
import "./App.css";
import ContractsView from "./ContractsView";
import MarketView from "./MarketView";
import SeasonHubView from "./SeasonHubView";
import SquadView from "./SquadView";
import TrainingPanel from "./TrainingPanel";
import {
  ApiError,
  apiRequest,
  clearStoredAccessToken,
  getStoredAccessToken,
  storeAccessToken,
} from "./api";
import {
  type Account,
  type AuthResponse,
  type Career,
  type CareerPlayer,
  type CareerSummary,
  type CreateCareerFromClubPayload,
  type PlayerCard,
  type Position,
  type SwapStarterResponse,
} from "./types";

type AppView =
  "saves" | "create" | "career" | "squad" | "season" | "contracts" | "legends";
type AuthMode = "login" | "register";

const POSITION_LABELS: Record<Position, string> = {
  TOP: "TOP",
  JUNGLE: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUP",
};

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
  const [activeCareer, setActiveCareer] = useState<Career | null>(null);
  const [view, setView] = useState<AppView>("saves");
  const [selectedContractOfferId, setSelectedContractOfferId] = useState<
    number | null
  >(null);
  const [marketSection, setMarketSection] = useState<"players" | "legends">(
    "players",
  );
  const [booting, setBooting] = useState(() => Boolean(getStoredAccessToken()));
  const [pageError, setPageError] = useState("");
  const [creatingClubCode, setCreatingClubCode] = useState<string | null>(null);
  const sessionVersion = useRef(0);
  const sessionToken = useRef<string | null>(null);
  const careerSelection = useRef(0);
  const careerRequestVersion = useRef(0);
  const selectedCareerId = useRef<number | null>(null);
  const pendingCreation = useRef<number | null>(null);

  function isCurrentSession(requestToken: string, session: number) {
    return (
      sessionVersion.current === session &&
      sessionToken.current === requestToken
    );
  }

  function isCurrentSelection(
    requestToken: string,
    session: number,
    selection: number,
  ) {
    return (
      isCurrentSession(requestToken, session) &&
      careerSelection.current === selection
    );
  }

  function isCurrentCareerRequest(
    requestToken: string,
    session: number,
    selection: number,
    request: number,
  ) {
    return (
      isCurrentSelection(requestToken, session, selection) &&
      careerRequestVersion.current === request
    );
  }

  useEffect(
    () => () => {
      sessionVersion.current++;
      sessionToken.current = null;
      careerSelection.current++;
      pendingCreation.current = null;
    },
    [],
  );

  useEffect(() => {
    const savedToken = getStoredAccessToken();

    if (!savedToken) {
      return;
    }

    let active = true;
    const session = ++sessionVersion.current;
    sessionToken.current = savedToken;

    Promise.all([
      apiRequest<Account>("/auth/me", { token: savedToken }),
      apiRequest<CareerSummary[]>("/careers", { token: savedToken }),
    ])
      .then(([savedAccount, savedCareers]) => {
        if (!active || !isCurrentSession(savedToken, session)) return;
        setToken(savedToken);
        setAccount(savedAccount);
        setCareers(savedCareers);
      })
      .catch(() => {
        if (!active || !isCurrentSession(savedToken, session)) return;
        sessionToken.current = null;
        clearStoredAccessToken();
      })
      .finally(() => {
        if (active && sessionVersion.current === session) setBooting(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function finishAuthentication(response: AuthResponse) {
    const session = ++sessionVersion.current;
    sessionToken.current = response.accessToken;
    pendingCreation.current = null;
    setCreatingClubCode(null);
    careerSelection.current++;
    selectedCareerId.current = null;
    const savedCareers = await apiRequest<CareerSummary[]>("/careers", {
      token: response.accessToken,
    });
    if (!isCurrentSession(response.accessToken, session)) return;
    storeAccessToken(response.accessToken);
    setToken(response.accessToken);
    setAccount(response.account);
    setCareers(savedCareers);
    setActiveCareer(null);
    setSelectedContractOfferId(null);
    setPageError("");
    setView("saves");
  }

  async function logout() {
    const logoutToken = sessionToken.current;
    sessionVersion.current++;
    sessionToken.current = null;
    careerSelection.current++;
    selectedCareerId.current = null;
    pendingCreation.current = null;
    clearStoredAccessToken();
    setCreatingClubCode(null);
    setToken(null);
    setAccount(null);
    setCareers([]);
    setActiveCareer(null);
    setSelectedContractOfferId(null);
    setPageError("");
    setView("saves");
    if (logoutToken) {
      await apiRequest<{ message: string }>("/auth/logout", {
        method: "POST",
        token: logoutToken,
      }).catch(() => undefined);
    }
  }

  async function openCareer(id: number) {
    if (!token || token !== sessionToken.current) return;
    const session = sessionVersion.current;
    const selection = ++careerSelection.current;
    const request = ++careerRequestVersion.current;
    selectedCareerId.current = id;
    setPageError("");
    try {
      const career = await apiRequest<Career>(`/careers/${id}`, { token });
      if (!isCurrentCareerRequest(token, session, selection, request)) return;
      setActiveCareer(career);
      setSelectedContractOfferId(null);
      setView("career");
    } catch (error) {
      if (!isCurrentCareerRequest(token, session, selection, request)) return;
      selectedCareerId.current = activeCareer?.id ?? null;
      handleAuthenticatedError(error);
    }
  }

  function openCreateCareer() {
    if (!token || token !== sessionToken.current) return;
    careerSelection.current++;
    setPageError("");
    setView("create");
  }

  function navigate(nextView: AppView) {
    if (view === "create" && nextView !== "create") careerSelection.current++;
    setPageError("");
    setView(nextView);
  }

  async function createCareer(payload: CreateCareerFromClubPayload) {
    if (
      !token ||
      token !== sessionToken.current ||
      pendingCreation.current !== null
    )
      return;
    const session = sessionVersion.current;
    const selection = careerSelection.current;
    pendingCreation.current = session;
    setCreatingClubCode(payload.clubCode);
    setPageError("");
    try {
      const career = await apiRequest<Career>("/careers/from-club", {
        method: "POST",
        token,
        body: payload,
      });
      if (!isCurrentSession(token, session)) return;
      const managedTeam = career.teams.find((team) => team.isUserControlled);
      if (managedTeam) {
        const summary: CareerSummary = {
          id: career.id,
          startYear: career.startYear,
          currentYear: career.currentYear,
          currentDate: career.currentDate,
          currentMeta: career.currentMeta,
          managedTeamId: managedTeam.id,
          managedTeamCode: managedTeam.code,
          managedTeamName: managedTeam.name,
        };
        setCareers((current) => [
          summary,
          ...current.filter((item) => item.id !== career.id),
        ]);
      }
      if (!isCurrentSelection(token, session, selection)) return;
      const request = ++careerRequestVersion.current;
      selectedCareerId.current = career.id;
      setActiveCareer(career);
      setSelectedContractOfferId(null);
      setView("career");
      try {
        const savedCareers = await apiRequest<CareerSummary[]>("/careers", {
          token,
        });
        if (isCurrentCareerRequest(token, session, selection, request))
          setCareers(savedCareers);
      } catch (error) {
        if (!isCurrentCareerRequest(token, session, selection, request)) return;
        setPageError(
          `커리어는 저장했습니다. 목록을 새로 불러오지 못했습니다: ${toMessage(error)}`,
        );
      }
    } catch (error) {
      if (!isCurrentSession(token, session)) return;
      handleAuthenticatedError(error);
      if (isCurrentSelection(token, session, selection)) throw error;
    } finally {
      if (pendingCreation.current === session) {
        pendingCreation.current = null;
        setCreatingClubCode(null);
      }
    }
  }

  async function swapStarter(
    teamId: number,
    position: Position,
    benchCareerPlayerId: number,
  ) {
    if (
      !token ||
      token !== sessionToken.current ||
      !activeCareer ||
      selectedCareerId.current !== activeCareer.id
    )
      return;
    const session = sessionVersion.current;
    const selection = careerSelection.current;
    let request = ++careerRequestVersion.current;
    let mutationCompleted = false;
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
      mutationCompleted = true;
      if (!isCurrentSelection(token, session, selection)) return;
      // Reads during the PATCH must not cancel its required post-write refresh.
      request = ++careerRequestVersion.current;
      const refreshedCareer = await apiRequest<Career>(
        `/careers/${activeCareer.id}`,
        { token },
      );
      if (!isCurrentCareerRequest(token, session, selection, request)) return;
      setActiveCareer(refreshedCareer);
    } catch (error) {
      if (!isCurrentSelection(token, session, selection)) return;
      if (!isCurrentCareerRequest(token, session, selection, request)) {
        // A failed write must still reject for its caller; only stale reads are discarded.
        if (!mutationCompleted) throw error;
        return;
      }
      handleAuthenticatedError(error);
      throw error;
    }
  }

  async function refreshActiveCareer() {
    if (
      !token ||
      token !== sessionToken.current ||
      !activeCareer ||
      selectedCareerId.current !== activeCareer.id
    )
      return;
    const session = sessionVersion.current;
    const selection = careerSelection.current;
    const request = ++careerRequestVersion.current;

    try {
      const [refreshedCareer, savedCareers] = await Promise.all([
        apiRequest<Career>(`/careers/${activeCareer.id}`, { token }),
        apiRequest<CareerSummary[]>("/careers", { token }),
      ]);
      if (!isCurrentCareerRequest(token, session, selection, request)) return;
      setActiveCareer(refreshedCareer);
      setCareers(savedCareers);
    } catch (error) {
      if (!isCurrentCareerRequest(token, session, selection, request)) return;
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

  function openContracts(offerId?: number) {
    setSelectedContractOfferId(offerId ?? null);
    navigate("contracts");
  }

  if (booting) return <LoadingScreen />;
  if (!account || !token)
    return <AuthScreen onAuthenticated={finishAuthentication} />;

  return (
    <div className="app-shell">
      <AppHeader
        account={account}
        view={view}
        onHome={() => navigate("saves")}
        onCreate={() => void openCreateCareer()}
        onSeason={() => navigate("season")}
        onSquad={() => navigate("squad")}
        onContracts={() => openContracts()}
        onLegends={() => {
          setMarketSection("players");
          navigate("legends");
        }}
        hasActiveCareer={activeCareer !== null}
        onLogout={() => void logout()}
      />

      <main className="app-main">
        {pageError && <div className="notice error-notice">{pageError}</div>}
        {creatingClubCode && (
          <div className="notice" role="status">
            {creatingClubCode} 새 게임을 생성하고 있습니다. 완료한 게임은 커리어
            목록에서 확인할 수 있습니다.
          </div>
        )}

        {view === "saves" && (
          <>
            <SaveSelectScreen
              account={account}
              careers={careers}
              onOpen={openCareer}
              onCreate={() => void openCreateCareer()}
            />
            <GoogleAccountLink key={token} token={token} />
          </>
        )}

        {view === "create" && (
          <ClubSelectionView
            key={token}
            token={token}
            creatingClubCode={creatingClubCode}
            onBack={() => navigate("saves")}
            onSubmit={createCareer}
            onSessionError={handleAuthenticatedError}
          />
        )}

        {view === "career" && activeCareer && (
          <CareerDashboard
            key={`${token}:${activeCareer.id}`}
            token={token}
            onCareerRefresh={refreshActiveCareer}
            career={activeCareer}
            onBack={() => navigate("saves")}
            onOpenSeason={() => navigate("season")}
            onOpenSquad={() => navigate("squad")}
            onOpenContracts={() => openContracts()}
          />
        )}

        {view === "season" && activeCareer && (
          <SeasonHubView
            career={activeCareer}
            token={token}
            onBack={() => navigate("career")}
            onCareerRefresh={refreshActiveCareer}
            onOpenContracts={openContracts}
            onOpenLegends={() => {
              setMarketSection("legends");
              navigate("legends");
            }}
          />
        )}

        {view === "contracts" && activeCareer && (
          <ContractsView
            key={activeCareer.id}
            career={activeCareer}
            token={token}
            initialOfferId={selectedContractOfferId}
            onBack={() => navigate("career")}
            onOpenSeason={() => navigate("season")}
            onCareerRefresh={refreshActiveCareer}
          />
        )}

        {view === "legends" && activeCareer && (
          <MarketView
            key={`${activeCareer.id}-${marketSection}`}
            initialSection={marketSection}
            career={activeCareer}
            token={token}
            onBack={() => navigate("career")}
            onOpenSeason={() => navigate("season")}
            onCareerUpdated={refreshActiveCareer}
            onOpenContractOffer={openContracts}
          />
        )}

        {view === "squad" && activeCareer && (
          <SquadView
            career={activeCareer}
            onBack={() => navigate("career")}
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
  const [googlePending, setGooglePending] = useState(false);
  const authState = useRef({
    method: null as "local" | "google" | null,
    version: 0,
    mounted: true,
  });

  useEffect(() => {
    const lifecycle = authState.current;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false;
      lifecycle.version++;
      lifecycle.method = null;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authState.current.method !== null || !authState.current.mounted) return;
    authState.current.method = "local";
    const request = ++authState.current.version;
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
      if (!authState.current.mounted || authState.current.version !== request)
        return;
      await onAuthenticated(response);
    } catch (submitError) {
      if (authState.current.mounted && authState.current.version === request)
        setError(toMessage(submitError));
    } finally {
      if (authState.current.mounted && authState.current.version === request) {
        authState.current.method = null;
        setSubmitting(false);
      }
    }
  }

  function changeMode(nextMode: AuthMode) {
    if (authState.current.method !== null) return;
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
          <strong>2026</strong>
          <span>YOUR NEXT SEASON</span>
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
              disabled={submitting || googlePending}
              onClick={() => changeMode("login")}
            >
              로그인
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              disabled={submitting || googlePending}
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
              disabled={submitting || googlePending}
            >
              {submitting
                ? "처리 중..."
                : mode === "login"
                  ? "커리어 불러오기"
                  : "감독 등록하기"}
            </button>
          </form>

          <div className="auth-local-separator">또는 Google 계정 사용</div>
          <GoogleAuthButton
            disabled={submitting}
            onBegin={() => {
              if (
                !authState.current.mounted ||
                authState.current.method !== null
              )
                return false;
              authState.current.method = "google";
              setError("");
              setGooglePending(true);
              return true;
            }}
            onEnd={() => {
              if (authState.current.method === "google")
                authState.current.method = null;
              if (authState.current.mounted) setGooglePending(false);
            }}
            onAuthenticated={async (response) => {
              if (
                authState.current.mounted &&
                authState.current.method === "google"
              )
                await onAuthenticated(response);
            }}
          />

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
  onSeason,
  onSquad,
  onContracts,
  onLegends,
  hasActiveCareer,
  onLogout,
}: {
  account: Account;
  view: AppView;
  onHome: () => void;
  onCreate: () => void;
  onSeason: () => void;
  onSquad: () => void;
  onContracts: () => void;
  onLegends: () => void;
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
          <>
            <button
              className={view === "season" ? "active" : ""}
              onClick={onSeason}
            >
              시즌
            </button>
            <button
              className={view === "squad" ? "active" : ""}
              onClick={onSquad}
            >
              선수단
            </button>
            <button
              className={view === "contracts" ? "active" : ""}
              onClick={onContracts}
            >
              계약
            </button>
            <button
              className={view === "legends" ? "active" : ""}
              onClick={onLegends}
            >
              일반 시장
            </button>
          </>
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
            <ClubLogo
              club={{ code: career.managedTeamCode }}
              className="team-monogram"
            />
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
            운영할 구단을 선택해
            <br />
            새로운 시즌을 시작합니다.
          </small>
        </button>
      </div>

      {careers.length === 0 && (
        <div className="empty-hint">
          아직 저장된 커리어가 없습니다. 첫 번째 구단을 선택해 보세요.
        </div>
      )}
    </section>
  );
}

function CareerDashboard({
  career,
  token,
  onCareerRefresh,
  onBack,
  onOpenSeason,
  onOpenSquad,
  onOpenContracts,
}: {
  career: Career;
  token: string;
  onCareerRefresh: () => Promise<void>;
  onBack: () => void;
  onOpenSeason: () => void;
  onOpenSquad: () => void;
  onOpenContracts: () => void;
}) {
  const managedTeam =
    career.teams.find((team) => team.isUserControlled) ?? career.teams[0];
  const [detailPlayer, setDetailPlayer] = useState<CareerPlayer | null>(null);
  const selectedTeam = managedTeam;

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
          <span>
            {career.currentYear} SEASON · {career.currentDate}
          </span>
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
            className="season-link-button"
            type="button"
            onClick={onOpenSeason}
          >
            시즌 진행하기 →
          </button>
          <button
            className="squad-link-button"
            type="button"
            onClick={onOpenSquad}
          >
            선수단 전체 보기 →
          </button>
          <button
            className="squad-link-button"
            type="button"
            onClick={onOpenContracts}
          >
            계약 협상 →
          </button>
        </div>
      </div>

      <section className="club-hero">
        <div className="club-identity">
          <ClubLogo club={managedTeam} className="club-crest" />
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
        <TrainingPanel
          key={`${career.id}:${token}:${career.currentDate}`}
          career={career}
          team={managedTeam}
          token={token}
          onCareerRefresh={onCareerRefresh}
          onOpenPlayer={setDetailPlayer}
        />

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
            <span>FRONTEND 02</span>
            <strong>시즌 진행 준비 완료</strong>
            <p>
              일정 생성부터 날짜 진행, 이벤트 처리, Quick Sim까지 시즌 허브에서
              이어집니다.
            </p>
            <button type="button" onClick={onOpenSeason}>
              시즌 허브 열기
            </button>
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

function toMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "알 수 없는 오류가 발생했습니다.";
}

export default App;
