import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import DraftBoard from "./DraftBoard";
import ChampionDraftBoard from "./ChampionDraftBoard";
import type { ChampionLineup } from './champion-draft';
import FirstSelectionPanel, {
  type FirstSelection,
  type SelectionChoice,
} from "./FirstSelectionPanel";
import DraftBackgroundMusic from "./DraftBackgroundMusic";
import QuickSimReport from "./QuickSimReport";
import MatchSpectator from "./MatchSpectator";
import { buildSpectatorReplay, type SpectatorReplay } from "./match-spectator";
import IntermissionPanel from "./IntermissionPanel";
import IntermissionDialog from "./IntermissionDialog";
import type { DraftCatalog, DraftPreviewState } from "./draft-preview";
import type { Career, MatchSeries, Position } from "./types";
import "./DraftPreview.css";

interface ServerDraft {
  version?: number;
  assignments?: Record<'BLUE'|'RED',ChampionLineup>;
  assignmentsConfirmed?: boolean;
  assignmentRevision?: number;
  gameNumber: number;
  actions: DraftPreviewState["actions"];
  deadline: string | null;
  serverNow: number;
  completed: boolean;
  blue: { id: number };
  red: { id: number };
  managedTeamId: number;
  selection?: FirstSelection;
  turns?: DraftCatalog["turns"];
  unavailable?: string[];
}
export interface MatchFlow {
  series: MatchSeries;
  fixturePath: string;
}

export default function MatchFlowDialog({
  career,
  token,
  flow,
  onClose,
}: {
  career: Career;
  token: string;
  flow: MatchFlow;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const pendingGame = useRef<number | null>(null);
  const [series, setSeries] = useState(flow.series);
  const [spectator, setSpectator] = useState<SpectatorReplay | null>(null);
  const [currentCareer, setCurrentCareer] = useState(career);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackOpenRef = useRef(false);
  const [intermission, setIntermission] = useState({
    busy: false,
    ready: false,
    afterGameNumber: 0,
  });
  const intermissionRef = useRef(intermission);
  function updateIntermission(state: {
    busy: boolean;
    ready: boolean;
    afterGameNumber: number;
  }) {
    intermissionRef.current = state;
    if (alive.current) setIntermission(state);
  }
  const [catalog, setCatalog] = useState<DraftCatalog | null>(null);
  const catalogRef = useRef<DraftCatalog | null>(null);
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<MatchSeries | null>(
    flow.series.games.length ? flow.series : null,
  );
  const gameRef = useRef(flow.series.nextGameNumber);
  const draftRef = useRef<ServerDraft | null>(null);
  const path = `/match-series/${flow.series.seriesId}`;
  function showReport(fresh: MatchSeries) {
    feedbackOpenRef.current = false;
    setFeedbackOpen(false);
    updateIntermission({ busy: false, ready: false, afterGameNumber: 0 });
    setReport(fresh);
  }
  function acceptDraft(value: ServerDraft) {
    draftRef.current = value;
    setDraft(value);
    setDeadline(
      value.deadline
        ? Date.now() + Math.max(0, Date.parse(value.deadline) - value.serverNow)
        : 0,
    );
  }
  async function request(work: () => Promise<void>) {
    if (!alive.current || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "경기를 처리하지 못했습니다.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadCatalog() {
    const value = await apiRequest<DraftCatalog>("/drafts/catalog", { token });
    if (!alive.current) return;
    catalogRef.current = value;
    setCatalog(value);
  }
  async function load(prepare: boolean) {
    if (!catalogRef.current) await loadCatalog();
    if (!alive.current) return;
    // An uncertain simulation is retried only with the SAME idempotent set key.
    // Draft action requests themselves are never replayed on a reload.
    if (pendingGame.current !== null) {
      await apiRequest(`${flow.fixturePath}/games/simulate`, {
        method: "POST",
        token,
        body: { gameNumber: pendingGame.current },
      });
      if (!alive.current) return;
      pendingGame.current = null;
    }
    const fresh = await apiRequest<MatchSeries>(path, { token });
    if (!alive.current) return;
    setSeries(fresh);
    gameRef.current = fresh.nextGameNumber;
    if (
      fresh.status === "COMPLETED" ||
      fresh.games.length > series.games.length
    ) {
      showReport(fresh);
      return;
    }
    const next = await apiRequest<ServerDraft>(
      `${path}/drafts/${fresh.nextGameNumber}`,
      { token, method: prepare ? "POST" : "GET" },
    );
    if (alive.current) acceptDraft(next);
  }
  useEffect(() => {
    alive.current = true;
    void request(async () => {
      await loadCatalog();
      if (!alive.current) return;
      if (!flow.series.games.length) await load(true);
    });
    return () => {
      alive.current = false;
    };
    // The parent keys this workflow by account token, career and series.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (report || spectator) return;
    const node = dialog.current;
    const previous = document.body.style.overflow;
    node?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = previous;
    };
  }, [report, spectator]);
  const close = () => {
    if (alive.current && !pending.current && !intermissionRef.current.busy) {
      alive.current = false;
      onClose();
    }
  };
  const action = (variantId: string | null, expectedStep: number) => {
    if (draftRef.current?.actions.length !== expectedStep) return;
    void request(async () => {
      const next = await apiRequest<ServerDraft>(
        `${path}/drafts/${gameRef.current}/actions`,
        {
          method: "POST",
          token,
          body: { expectedStep, ...(variantId ? { variantId } : {}) },
        },
      );
      if (alive.current) acceptDraft(next);
    });
  };
  const play = () => {
    if (!draftRef.current?.completed) return;
    if (draftRef.current.version===3 && !draftRef.current.assignmentsConfirmed) return;
    const gameNumber = draftRef.current.gameNumber;
    void request(async () => {
      pendingGame.current = gameNumber;
      await apiRequest(`${flow.fixturePath}/games/simulate`, {
        method: "POST",
        token,
        body: { gameNumber },
      });
      if (!alive.current) return;
      pendingGame.current = null;
      const fresh = await apiRequest<MatchSeries>(path, { token });
      if (!alive.current) return;
      setSeries(fresh);
      gameRef.current = fresh.nextGameNumber;
      showReport(fresh);
      const game = fresh.games.find(g => g.seriesGameNumber === gameNumber) ?? fresh.games.at(-1);
      setSpectator(game ? buildSpectatorReplay(game, currentCareer) : null);
    });
  };
  const choose = (choice?: SelectionChoice) => {
    const selection = draftRef.current?.selection;
    if (!selection || selection.choices.length >= 2) return;
    void request(async () => {
      const next = await apiRequest<ServerDraft>(
        `${path}/drafts/${gameRef.current}/selection`,
        {
          method: "POST",
          token,
          body: {
            expectedStep: selection.choices.length,
            ...(choice ? { choice } : {}),
          },
        },
      );
      if (alive.current) acceptDraft(next);
    });
  };
  const assign = (entries: Array<{position: Position; championId: string}> | undefined, expectedRevision: number) => {
    if (!draftRef.current?.completed || draftRef.current.version!==3 || draftRef.current.assignmentsConfirmed
      || (draftRef.current.assignmentRevision??0)!==expectedRevision) return;
    void request(async()=>{
      const next = await apiRequest<ServerDraft>(`${path}/drafts/${gameRef.current}/lineup`,{
        method:'POST',token,body:{expectedRevision,...(entries?{entries}:{})},
      });
      if(alive.current) acceptDraft(next);
    });
  };
  if (spectator) return <MatchSpectator key={spectator.key} replay={spectator} onClose={() => setSpectator(null)} />;
  if (report) {
    if (feedbackOpen && report.status !== "COMPLETED")
      return (
        <IntermissionDialog
          series={report}
          busy={busy || intermission.busy}
          nextDisabled={
            !intermission.ready ||
            intermission.afterGameNumber !== report.games.length
          }
          onClose={close}
          onBack={() => {
            if (pending.current || intermissionRef.current.busy) return;
            feedbackOpenRef.current = false;
            setFeedbackOpen(false);
          }}
          onNext={() => {
            if (
              !feedbackOpenRef.current ||
              pending.current ||
              intermissionRef.current.busy ||
              !intermissionRef.current.ready ||
              intermissionRef.current.afterGameNumber !== report.games.length
            )
              return;
            feedbackOpenRef.current = false;
            setFeedbackOpen(false);
            updateIntermission({
              busy: false,
              ready: false,
              afterGameNumber: 0,
            });
            setReport(null);
            setDraft(null);
            draftRef.current = null;
            void request(() => load(true));
          }}
        >
          <IntermissionPanel
            key={`${token}:${career.id}:${report.seriesId}:${report.games.at(-1)?.matchId}`}
            series={report}
            career={currentCareer}
            token={token}
            onState={(state) =>
              updateIntermission({
                ...state,
                afterGameNumber: report.games.length,
              })
            }
            onSync={(fresh, latestCareer) => {
              if (!alive.current) return;
              if (
                fresh.games.length !== report.games.length ||
                fresh.status === "COMPLETED"
              )
                showReport(fresh);
              else setReport(fresh);
              setSeries(fresh);
              gameRef.current = fresh.nextGameNumber;
              setCurrentCareer(latestCareer);
            }}
          />
        </IntermissionDialog>
      );
    return (
      <QuickSimReport
        result={{ series: report }}
        career={currentCareer}
        onClose={close}
        closeDisabled={busy}
        nextDisabled={busy}
        onNext={
          report.status === "COMPLETED"
            ? undefined
            : () => {
                if (
                  !alive.current ||
                  pending.current ||
                  feedbackOpenRef.current
                )
                  return;
                updateIntermission({
                  busy: false,
                  ready: false,
                  afterGameNumber: 0,
                });
                feedbackOpenRef.current = true;
                setFeedbackOpen(true);
              }
        }
      />
    );
  }
  const blue = currentCareer.teams.find((team) => team.id === draft?.blue.id);
  const red = currentCareer.teams.find((team) => team.id === draft?.red.id);
  return (
    <dialog
      ref={dialog}
      className="draft-preview-dialog"
      aria-label="경기 밴픽"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {draft && <DraftBackgroundMusic />}
      {catalog && draft && blue && red ? (
        draft.selection && draft.selection.choices.length < 2 ? (
          <FirstSelectionPanel
            selection={draft.selection}
            teams={[blue, red]}
            managedTeamId={draft.managedTeamId}
            deadline={deadline}
            busy={busy}
            error={error}
            onChoose={choose}
            onReload={() => void request(() => load(true))}
            onClose={close}
          />
        ) : draft.version === 3 ? (
          <ChampionDraftBoard
            key={`champions:${draft.gameNumber}`}
            catalog={draft.turns ? {...catalog,turns:draft.turns} : catalog}
            blue={blue} red={red} managedTeamId={draft.managedTeamId}
            matchLabel={`BO${series.bestOf} · ${series.teams.map(team=>`${team.teamCode} ${team.wins}`).join(' : ')}`}
            onClose={close}
            live={{state:{actions:draft.actions,deadline,unavailable:draft.unavailable},
              firstPickTeamId:draft.selection?.firstPickTeamId??undefined,
              assignments:draft.assignments, assignmentsConfirmed:draft.assignmentsConfirmed??false,
              assignmentRevision:draft.assignmentRevision??0, onLineup:assign,
              gameNumber:draft.gameNumber,busy,error,onAction:action,onPlay:play,
              onReload:()=>void request(()=>load(true)),
            }}
          />
        ) : (
          <DraftBoard
            key={draft.gameNumber}
            catalog={draft.turns ? { ...catalog, turns: draft.turns } : catalog}
            blue={blue}
            red={red}
            managedTeamId={draft.managedTeamId}
            matchLabel={`BO${series.bestOf} · ${series.teams.map((team) => `${team.teamCode} ${team.wins}`).join(" : ")}`}
            storageKey="server-draft"
            onClose={close}
            live={{
              state: {
                actions: draft.actions,
                deadline,
                unavailable: draft.unavailable,
              },
              firstPickTeamId: draft.selection?.firstPickTeamId ?? undefined,
              gameNumber: draft.gameNumber,
              busy,
              error,
              onAction: action,
              onPlay: play,
              onReload: () => {
                void request(() => load(true));
              },
            }}
          />
        )
      ) : (
        <div className="draft-loading-screen">
          <h2>경기 밴픽 준비</h2>
          <p role={error ? "alert" : "status"}>
            {error || "저장된 경기 정보를 불러오는 중…"}
          </p>
          {error && (
            <button
              disabled={busy}
              onClick={() => {
                void request(async () => {
                  await loadCatalog();
                  if (!alive.current) return;
                  await load(true);
                });
              }}
            >
              다시 불러오기
            </button>
          )}
          <button disabled={busy} onClick={close}>
            시즌으로 돌아가기
          </button>
        </div>
      )}
    </dialog>
  );
}
