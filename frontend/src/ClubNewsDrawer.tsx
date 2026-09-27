import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { apiRequest } from "./api";
import type { TransferCandidate } from "./market-types";
import { formatMoney } from "./money";
import type { ManagerOverview } from "./types";
import "./ClubNewsDrawer.css";

interface ClubNewsDrawerProps {
  careerId: number;
  token: string;
  manager?: ManagerOverview;
  managerOffers?: ReactNode;
  onOpenMarket: () => void;
  children: ReactNode;
}

interface TransferNews {
  id: number;
  type: "TRANSFER" | "FREE_AGENT_SIGNING" | "RELEASE" | "CONTRACT_EXPIRATION";
  completedDate: string;
  transferFee: number;
  player: { nickname: string; position: string };
  fromTeam: { id: number; code: string; name: string } | null;
  toTeam: { id: number; code: string; name: string } | null;
}

interface NewsSnapshot {
  owner: string;
  loading: boolean;
  error: string | null;
  market: TransferCandidate[] | null;
  history: TransferNews[] | null;
}

const TABS = ["구단 소식", "이적시장", "팬 반응"] as const;
const emptySnapshot = (owner: string): NewsSnapshot => ({
  owner, loading: false, error: null, market: null, history: null,
});

export default function ClubNewsDrawer({
  careerId, token, manager, managerOffers, onOpenMarket, children,
}: ClubNewsDrawerProps) {
  const owner = `${careerId}:${token}`;
  const ownerRef = useRef(owner);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openRef = useRef(false);
  const requestRef = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0, controller: null,
  });
  const [visibility, setVisibility] = useState({ owner, open: false });
  const [selection, setSelection] = useState({ owner, index: 0 });
  const isOpen = visibility.owner === owner && visibility.open;
  const tab = selection.owner === owner ? selection.index : 0;
  const hasManagerOffers = managerOffers !== undefined && managerOffers !== null && managerOffers !== false;
  const pendingJobOffers = manager?.pendingJobOfferCount ?? 0;
  const tabs = hasManagerOffers ? [...TABS, "감독 제안"] : TABS;
  const activeTab = tab < tabs.length ? tab : 0;
  const [snapshot, setSnapshot] = useState<NewsSnapshot>(() => emptySnapshot(owner));
  const current = snapshot.owner === owner ? snapshot : emptySnapshot(owner);
  const id = `club-news-${careerId}`;

  useEffect(() => {
    ownerRef.current = owner;
    const request = requestRef.current;
    request.generation++;
    request.controller?.abort();
    request.controller = null;
    openRef.current = false;
    dialogRef.current?.close();
    return () => {
      openRef.current = false;
      request.generation++;
      request.controller?.abort();
      request.controller = null;
    };
  }, [owner]);

  const endSession = () => {
    openRef.current = false;
    requestRef.current.generation++;
    requestRef.current.controller?.abort();
    requestRef.current.controller = null;
    setVisibility({ owner, open: false });
  };

  const close = () => {
    endSession();
    dialogRef.current?.close();
  };

  const loadNews = async () => {
    if (!openRef.current || requestRef.current.controller) return;
    const controller = new AbortController();
    const generation = ++requestRef.current.generation;
    requestRef.current.controller = controller;
    setSnapshot({ ...emptySnapshot(owner), loading: true });
    const isCurrent = () => openRef.current && ownerRef.current === owner &&
      requestRef.current.generation === generation && !controller.signal.aborted;
    try {
      const [market, history] = await Promise.all([
        apiRequest<TransferCandidate[]>(`/careers/${careerId}/transfers/market`, {
          token, signal: controller.signal,
        }),
        apiRequest<TransferNews[]>(`/careers/${careerId}/transfers/history`, {
          token, signal: controller.signal,
        }),
      ]);
      if (isCurrent()) setSnapshot({ owner, loading: false, error: null, market, history });
    } catch (error) {
      if (isCurrent()) {
        controller.abort();
        setSnapshot({
          ...emptySnapshot(owner),
          error: error instanceof Error ? error.message : "소식을 불러오지 못했습니다.",
        });
      }
    } finally {
      if (requestRef.current.generation === generation) requestRef.current.controller = null;
    }
  };

  const open = () => {
    if (openRef.current || !dialogRef.current) return;
    dialogRef.current.showModal();
    openRef.current = true;
    setVisibility({ owner, open: true });
    void loadNews();
  };

  const switchTab = (index: number) => {
    setSelection({ owner, index });
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    switchTab(next);
    tabRefs.current[next]?.focus();
  };

  const freeAgents = current.market?.filter((player) => player.availability === "FREE_AGENT") ?? [];
  const availableTransfers = current.market?.filter((player) => player.availability === "CONTRACTED" && player.canNegotiate) ?? [];
  const candidates = [...freeAgents, ...availableTransfers]
    .sort((left, right) => right.overall - left.overall || left.nickname.localeCompare(right.nickname))
    .slice(0, 6);
  const recentHistory = [...(current.history ?? [])]
    .sort((left, right) => right.completedDate.localeCompare(left.completedDate) || right.id - left.id)
    .slice(0, 6);
  const latestReview = manager?.recentReviews.slice().sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id)[0];
  const approval = manager ? Math.max(0, Math.min(100, manager.fanApproval)) : 0;
  const fanMood = approval < 40 ? "교체 요구" : approval < 65 ? "기대와 우려" : "감독 지지";
  const reactions = manager ? fanReactions(manager, latestReview?.fanDelta ?? 0) : [];

  return (
    <>
      <button type="button" className="club-news-trigger" aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={id} onClick={open}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
        </svg>
        구단 소식
        {pendingJobOffers > 0 && <span className="club-news-offer-badge">감독 제안 {pendingJobOffers}</span>}
      </button>
      <dialog
        ref={dialogRef}
        id={id}
        className="club-news-dialog"
        aria-labelledby={`${id}-title`}
        onCancel={endSession}
        onClose={() => { if (!dialogRef.current?.open) endSession(); }}
      >
        <header className="club-news-header">
          <div><span>CLUB NEWSROOM</span><h2 id={`${id}-title`}>구단 소식</h2><p>구단의 오늘, 시장의 움직임, 팬들의 목소리</p></div>
          <button type="button" className="club-news-close" aria-label="구단 소식 닫기" onClick={close} autoFocus>×</button>
        </header>
        <div className={`club-news-tabs${hasManagerOffers ? " club-news-tabs--four" : ""}`} role="tablist" aria-label="소식 종류">
          {tabs.map((label, index) => (
            <button
              key={label} ref={(element) => { tabRefs.current[index] = element; }}
              type="button" role="tab" id={`${id}-tab-${index}`}
              aria-selected={activeTab === index} aria-controls={`${id}-panel-${index}`}
              tabIndex={activeTab === index ? 0 : -1}
              onClick={() => switchTab(index)} onKeyDown={(event) => onTabKeyDown(event, index)}
            >{index === 3 && pendingJobOffers > 0 ? <>{label}<span className="club-news-tab-badge">{pendingJobOffers}</span></> : label}</button>
          ))}
        </div>
        <div className="club-news-scroll">
          {activeTab < 2 && current.loading && <p className="club-news-status" role="status">최신 소식을 불러오는 중입니다.</p>}
          {activeTab < 2 && current.error && (
            <div className="club-news-error" role="alert"><p>{current.error}</p><button type="button" onClick={() => void loadNews()}>다시 불러오기</button></div>
          )}
          <section
            role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={activeTab !== 0} tabIndex={0}
            onClickCapture={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest?.("[data-close-news]")) close();
            }}
          >
            <div className="club-news-section-heading"><h3>구단 브리핑</h3><span>일정 · 운영</span></div>
            {children}
            <div className="club-news-section-heading club-news-section-heading--spaced"><h3>최근 계약·이적</h3><span>모든 구단</span></div>
            {current.history && recentHistory.length === 0 && <p className="club-news-empty">아직 완료된 계약·이적 소식이 없습니다.</p>}
            <div className="club-news-items">
              {recentHistory.map((record) => (
                <article className="club-news-transfer" key={record.id}>
                  <div className="club-news-item-meta"><span>{transferLabel(record.type)}</span><time dateTime={record.completedDate}>{record.completedDate.replaceAll("-", ".")}</time></div>
                  <h4>{record.player.nickname} <small>{record.player.position}</small></h4>
                  <p>{record.fromTeam?.name ?? "FA"} <span aria-label="에서">→</span> {record.toTeam?.name ?? "FA"}</p>
                  <strong className="club-news-fee">이적료 {formatMoney(record.transferFee)}</strong>
                </article>
              ))}
            </div>
          </section>
          <section role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={activeTab !== 1} tabIndex={0}>
            <div className="club-news-section-heading"><h3>현재 시장 현황</h3><span>주요 선수</span></div>
            <p className="club-news-description">현재 FA 선수와 이적 협상이 가능한 선수를 모았습니다.</p>
            {current.market && (
              <>
                <div className="club-news-market-counts"><span>FA <strong>{freeAgents.length}</strong>명</span><span>소속 구단과 협상 가능 <strong>{availableTransfers.length}</strong>명</span></div>
                {candidates.length === 0 && <p className="club-news-empty">현재 표시할 FA·이적 협상 가능 선수가 없습니다.</p>}
                <div className="club-news-items">
                  {candidates.map((player) => (
                    <article className="club-news-candidate" key={player.careerPlayerId}>
                      <span className="club-news-position">{player.position}</span>
                      <div><h4>{player.nickname} <small>OVR {player.overall}</small></h4><p>{player.currentTeam?.name ?? "자유 계약 선수"}</p><small>{player.availability === "FREE_AGENT" ? "FA · 이적료 없음" : `필요 이적료 ${formatMoney(player.requiredFee)}`}</small>{!player.canNegotiate && player.blockedReason && <span className="club-news-availability">{player.blockedReason}</span>}</div>
                    </article>
                  ))}
                </div>
              </>
            )}
            <button type="button" className="club-news-market-button" onClick={() => { close(); onOpenMarket(); }}>전체 이적시장 보기 →</button>
          </section>
          <section role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-tab-2`} hidden={activeTab !== 2} tabIndex={0}>
            <div className="club-news-section-heading"><h3>팬들의 목소리</h3><span>게임 내 팬 반응</span></div>
            {!manager ? <p className="club-news-empty">아직 팬 평가가 없습니다.</p> : (
              <>
                <div className={`club-news-fan-score ${approval < 40 ? "is-critical" : ""}`}><div><span>팬 지지도</span><strong>{approval}<small> / 100</small></strong></div><b>{manager.status === "DISMISSED" ? "새 출발을 기다리며" : fanMood}</b></div>
                <p className="club-news-description">현재 팬 지지도와 최근 구단 평가를 바탕으로 한 게임 내 반응입니다.</p>
                <div className="club-news-items">{reactions.map((reaction, index) => <article className="club-news-fan-comment" key={reaction}><span>팬의 목소리 {index + 1}</span><p>“{reaction}”</p></article>)}</div>
                {latestReview && <div className="club-news-review"><span>최근 평가 · {latestReview.date.replaceAll("-", ".")}</span><strong>{latestReview.title}</strong><p>{latestReview.reason}</p></div>}
              </>
            )}
          </section>
          {hasManagerOffers && <section role="tabpanel" id={`${id}-panel-3`} aria-labelledby={`${id}-tab-3`} hidden={activeTab !== 3} tabIndex={0}>{isOpen && activeTab === 3 ? managerOffers : null}</section>}
        </div>
      </dialog>
    </>
  );
}

function transferLabel(type: TransferNews["type"]): string {
  return ({ TRANSFER: "이적 완료", FREE_AGENT_SIGNING: "FA 계약", RELEASE: "계약 해지", CONTRACT_EXPIRATION: "계약 만료" })[type];
}

function fanReactions(manager: ManagerOverview, recentDelta: number): string[] {
  if (manager.status === "DISMISSED") return ["감독 교체 이후에는 팀이 달라졌으면 좋겠습니다.", "새 감독과 함께 다시 올라갑시다."];
  const base = manager.fanApproval < 40
    ? ["이제 감독 교체가 필요합니다.", "팬들의 신뢰를 되찾기 어렵다면 물러나세요."]
    : manager.fanApproval < 65
      ? ["조금 더 지켜보겠지만 결과로 보여줘야 합니다.", "우리 선수들이 더 잘할 수 있다고 믿어요."]
      : ["지금 방향을 믿습니다. 감독님 계속 응원할게요.", "이 분위기로 다음 경기까지 이어갑시다."];
  return [...base, recentDelta < 0 ? "최근 구단 평가를 보니 걱정이 됩니다. 변화가 필요해요."
    : recentDelta > 0 ? "최근에는 좋은 변화가 보입니다. 계속 보여주세요."
    : "다음 경기에서 팬들이 납득할 모습을 보여주세요."];
}
