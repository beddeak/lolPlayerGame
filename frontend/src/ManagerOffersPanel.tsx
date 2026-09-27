import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import ClubLogo from "./ClubLogo";
import "./ManagerOffersPanel.css";

interface OfferTeam {
  id: number;
  code: string;
  name: string;
  region: string;
}

export interface ManagerJobOffer {
  id: number;
  seasonYear: number;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  offeredDate: string;
  expiresDate: string;
  fromTeam: OfferTeam;
  toTeam: OfferTeam;
  reason: string;
  canRespond: boolean;
}

export interface ManagerJobOffersResponse {
  careerId: number;
  currentDate: string;
  window: { isOpen: boolean; opensAt: string; endsAt: string };
  canCheckOffers: boolean;
  offers: ManagerJobOffer[];
}

interface Props {
  careerId: number;
  token: string;
  currentDate: string;
  busy: boolean;
  onAction: (suffix: string) => Promise<ManagerJobOffersResponse>;
}

const STATUS_LABELS = {
  PENDING: "응답 대기",
  ACCEPTED: "부임 완료",
  DECLINED: "거절",
  EXPIRED: "제안 종료",
};

export default function ManagerOffersPanel({
  careerId,
  token,
  currentDate,
  busy,
  onAction,
}: Props) {
  const [data, setData] = useState<ManagerJobOffersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const base = `/careers/${careerId}/manager/job-offers`;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<ManagerJobOffersResponse>(base, {
        token,
      });
      if (mounted.current && generation.current === request) setData(result);
    } catch (reason) {
      if (mounted.current && generation.current === request) {
        setData(null);
        setError(
          reason instanceof Error
            ? reason.message
            : "감독 제안을 불러오지 못했습니다.",
        );
      }
    } finally {
      if (mounted.current && generation.current === request) setLoading(false);
    }
  }, [base, token]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setData(null);
      setConfirmation(null);
      setNotice("");
      setPending(false);
      inFlight.current = false;
      return load();
    });
    return () => {
      active = false;
      mounted.current = false;
      // Request generation, not a DOM ref: invalidate pending reads and writes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [load, currentDate]);

  async function respond(
    action: "check" | "accept" | "decline",
    offer?: ManagerJobOffer,
  ) {
    if (
      busy ||
      inFlight.current ||
      loading ||
      !data ||
      !mounted.current ||
      !data.window.isOpen ||
      data.careerId !== careerId ||
      data.currentDate !== currentDate
    )
      return;
    if (
      action === "check"
        ? !data.canCheckOffers
        : !offer?.canRespond || !data.window.isOpen
    )
      return;
    if (action === "accept" && confirmation !== offer?.id) return;
    const request = ++generation.current;
    const isCurrent = () => mounted.current && request === generation.current;
    inFlight.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await onAction(
        action === "check" ? "check" : `${offer!.id}/${action}`,
      );
      if (!isCurrent()) return;
      setData(result);
      setConfirmation(null);
      setNotice(
        action === "accept"
          ? `${offer!.toTeam.name} 감독으로 부임했습니다.`
          : action === "decline"
            ? "감독 영입 제안을 거절했습니다."
            : "현재 도착한 감독 제안을 확인했습니다.",
      );
    } catch (reason) {
      if (!isCurrent()) return;
      const message =
        reason instanceof Error
          ? reason.message
          : "감독 제안을 처리하지 못했습니다.";
      // Reconcile a lost response without sending the mutation a second time.
      await load();
      if (mounted.current && generation.current === request + 1) {
        setError(message);
        setConfirmation(null);
      }
    } finally {
      if (
        mounted.current &&
        (generation.current === request || generation.current === request + 1)
      ) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }

  const disabled = busy || pending || loading;
  return (
    <section
      className="manager-offers-panel"
      aria-label="감독 영입 제안"
      aria-busy={pending || loading}
    >
      <header>
        <span>MANAGER RECRUITMENT</span>
        <h3>다음 구단의 초대</h3>
      </header>
      <p>
        다른 구단이 감독인 당신에게 보내는 제안입니다. 스토브리그에만 제안을
        받고 구단을 옮길 수 있습니다.
      </p>
      {data && (
        <p className="manager-offer-window">
          {data.window.opensAt} — {data.window.endsAt} ·{" "}
          {data.window.isOpen
            ? "스토브리그 진행 중"
            : "지금은 제안·이동 기간이 아닙니다"}
        </p>
      )}
      <div className="manager-offer-actions">
        <button disabled={disabled} onClick={() => void load()}>
          제안 새로고침
        </button>
        {data?.canCheckOffers && (
          <button disabled={disabled} onClick={() => void respond("check")}>
            도착한 제안 확인
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="manager-offer-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="manager-offer-notice">
          {notice}
        </p>
      )}
      {loading && <p role="status">감독 제안을 불러오는 중…</p>}
      {!loading && data?.offers.length === 0 && (
        <p className="manager-offer-empty">
          도착한 감독 영입 제안이 없습니다. 스토브리그에 구단들의 제안을
          확인하세요.
        </p>
      )}
      {!loading &&
        data?.offers.map((offer) => (
          <article
            key={offer.id}
            className={`manager-offer status-${offer.status}`}
          >
            <header>
              <ClubLogo club={offer.toTeam} className="club-logo--small" />
              <div>
                <small>{offer.toTeam.region}</small>
                <h4>{offer.toTeam.name}</h4>
              </div>
              <span>{STATUS_LABELS[offer.status]}</span>
            </header>
            <p>{offer.reason}</p>
            <small>
              {offer.offeredDate} 도착 · {offer.expiresDate}까지 응답
            </small>
            {offer.canRespond && data.window.isOpen && (
              <>
                {confirmation === offer.id ? (
                  <div
                    className="manager-offer-confirm"
                    role="group"
                    aria-label="감독 부임 확인"
                  >
                    <strong>
                      {offer.fromTeam.name}에서 {offer.toTeam.name}(으)로
                      옮길까요?
                    </strong>
                    <p>
                      기존 경기 기록과 각 구단의 선수단은 유지됩니다. 두 구단의
                      진행 중인 선수 영입·판매 협상은 정리되고, 새 구단의 감독
                      평가는 새로 시작합니다.
                    </p>
                    <div className="manager-offer-actions">
                      <button
                        className="offer-accept"
                        disabled={disabled}
                        onClick={() => void respond("accept", offer)}
                      >
                        확인하고 부임
                      </button>
                      <button
                        disabled={disabled}
                        onClick={() => setConfirmation(null)}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="manager-offer-actions">
                    <button
                      className="offer-accept"
                      disabled={disabled}
                      onClick={() => setConfirmation(offer.id)}
                    >
                      부임 제안 수락
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() => void respond("decline", offer)}
                    >
                      제안 거절
                    </button>
                  </div>
                )}
              </>
            )}
          </article>
        ))}
    </section>
  );
}
