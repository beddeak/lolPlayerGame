import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { apiRequest } from "./api";
import type {
  Career,
  ContractOffer,
  ContractRole,
  ContractTerms,
  LegendEventsResponse,
  LegendMarketPlayer,
} from "./types";
import "./LegendEventsView.css";

interface Props {
  career: Career;
  token: string;
  onBack: () => void;
  onOpenSeason: () => void;
  onCareerUpdated: () => Promise<void>;
  onOpenContractOffer: (offerId: number) => void;
}

const OPEN_OFFERS = new Set<ContractOffer["status"]>([
  "WAITING_PLAYER_RESPONSE",
  "PLAYER_ACCEPTED",
  "COUNTER_OFFERED",
  "REJECTED",
]);
const ROLES: Record<ContractRole, string> = {
  CORE: "핵심 선수",
  STARTER: "주전",
  ROTATION: "로테이션",
  PROSPECT: "육성 선수",
};
const INITIAL_TERMS: ContractTerms = {
  annualSalary: 10000,
  years: 2,
  expectedRole: "STARTER",
  starterGuarantee: false,
  promises: [],
};

export default function LegendEventsView({
  career,
  token,
  onBack,
  onOpenSeason,
  onCareerUpdated,
  onOpenContractOffer,
}: Props) {
  const [data, setData] = useState<LegendEventsResponse | null>(null);
  const [offers, setOffers] = useState<ContractOffer[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [terms, setTerms] = useState<ContractTerms>({ ...INITIAL_TERMS });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  const fetchData = useCallback(
    () =>
      Promise.all([
        apiRequest<LegendEventsResponse>(
          `/careers/${career.id}/legend-events`,
          { token },
        ),
        apiRequest<ContractOffer[]>(`/careers/${career.id}/contracts/offers`, {
          token,
        }),
      ]),
    [career.id, token],
  );

  useEffect(() => {
    mounted.current = true;
    const version = ++loadVersion.current;
    fetchData()
      .then(([market, contracts]) => {
        if (!mounted.current || version !== loadVersion.current) return;
        setData(market);
        setOffers(contracts);
      })
      .catch((reason: unknown) => {
        if (mounted.current && version === loadVersion.current)
          setError(toMessage(reason));
      })
      .finally(() => {
        if (mounted.current && version === loadVersion.current)
          setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [fetchData]);

  const events = [...(data?.events ?? [])].sort(
    (a, b) => b.revealedDate.localeCompare(a.revealedDate) || b.id - a.id,
  );
  const players = events.flatMap((event) => event.players);
  const selected =
    players.find((player) => player.careerPlayerId === selectedId) ??
    players[0];
  const selectedEvent = events.find((event) =>
    event.players.some(
      (player) => player.careerPlayerId === selected?.careerPlayerId,
    ),
  );
  const offer = offers.find(
    (item) =>
      item.careerPlayerId === selected?.careerPlayerId &&
      OPEN_OFFERS.has(item.status),
  );
  const validSalary =
    Number.isInteger(terms.annualSalary) &&
    terms.annualSalary >= 1 &&
    terms.annualSalary <= 10000000;

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const version = ++loadVersion.current;
    try {
      const [[market, contracts]] = await Promise.all([
        fetchData(),
        onCareerUpdated(),
      ]);
      if (!mounted.current || version !== loadVersion.current) return;
      setData(market);
      setOffers(contracts);
    } catch (reason) {
      if (mounted.current && version === loadVersion.current)
        setError(toMessage(reason));
    } finally {
      inFlight.current = false;
      if (mounted.current && version === loadVersion.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !selected || !selected.canNegotiate || offer)
      return;
    if (!validSalary) {
      setError("연봉은 1~10,000,000만원 사이 정수로 입력해 주세요.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const created = await apiRequest<ContractOffer>(
        `/careers/${career.id}/contracts/offers`,
        {
          method: "POST",
          token,
          body: { careerPlayerId: selected.careerPlayerId, terms },
        },
      );
      if (!mounted.current) return;
      setOffers((current) => [created, ...current]);
      onOpenContractOffer(created.id);
    } catch (reason) {
      if (!mounted.current) return;
      setError(toMessage(reason));
      try {
        const [market, contracts] = await fetchData();
        if (mounted.current) {
          setData(market);
          setOffers(contracts);
        }
      } catch {
        /* Keep the original offer error visible if refreshing also fails. */
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function select(player: LegendMarketPlayer) {
    setSelectedId(player.careerPlayerId);
    setTerms({ ...INITIAL_TERMS });
    setError("");
  }

  return (
    <section className="legend-market">
      <div className="legend-nav">
        <button onClick={onBack}>← 구단 사무실</button>
        <button onClick={onOpenSeason}>시즌 허브 →</button>
      </div>
      <header className="legend-hero">
        <div>
          <p>THE CLASSICS / TRANSFER MARKET</p>
          <h1>다시 만나는 전성기</h1>
          <span>
            공개된 레전드 선수에게 계약을 제안하세요. 다른 구단도 영입 경쟁에
            참여합니다.
          </span>
        </div>
        <div className="legend-date">
          <small>MARKET UPDATE</small>
          <strong>{data?.currentDate ?? career.currentDate}</strong>
          <button disabled={busy || loading} onClick={() => void refresh()}>
            시장 새로고침 ↻
          </button>
        </div>
      </header>
      {error && (
        <div className="legend-notice error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="legend-empty">레전드 시장을 불러오는 중입니다.</div>
      ) : !data ? (
        <div className="legend-empty">
          <h2>시장 정보를 불러오지 못했습니다.</h2>
          <button disabled={busy} onClick={() => void refresh()}>
            다시 불러오기
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="legend-empty">
          <span>LEGENDS ARCHIVE</span>
          <h2>아직 공개된 이벤트가 없습니다.</h2>
          <p>이적시장 중 새로운 선수 소식을 확인해 주세요.</p>
          <button onClick={onOpenSeason}>시즌 허브로 돌아가기</button>
        </div>
      ) : (
        <div className="legend-layout">
          <div className="legend-events">
            {events.map((legend) => (
              <section className="legend-event" key={legend.id}>
                <div className="legend-event-heading">
                  <div>
                    <p>{legend.seasonYear} OFFSEASON</p>
                    <h2>{legend.theme.name}</h2>
                  </div>
                  <span>{legend.revealedDate} 공개</span>
                </div>
                <div className="legend-cards">
                  {legend.players.map((player) => (
                    <button
                      key={player.careerPlayerId}
                      disabled={busy}
                      className={`legend-player-card ${selected?.careerPlayerId === player.careerPlayerId ? "selected" : ""}`}
                      onClick={() => select(player)}
                      aria-pressed={
                        selected?.careerPlayerId === player.careerPlayerId
                      }
                    >
                      <div className="legend-card-rating">
                        <strong>{player.overall}</strong>
                        <span>{player.position}</span>
                      </div>
                      <div className="legend-card-portrait">
                        <span aria-hidden="true">
                          {player.nickname.slice(0, 1)}
                        </span>
                        {player.imageUrl && (
                          <img
                            src={player.imageUrl}
                            alt=""
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                      </div>
                      <span className="legend-card-year">
                        {player.cardYear} SEASON
                      </span>
                      <strong className="legend-card-name">
                        {player.nickname}
                      </strong>
                      <span
                        className={`legend-card-status ${player.currentTeam ? "signed" : ""}`}
                      >
                        {player.currentTeam
                          ? `${player.currentTeam.code} 소속`
                          : "FREE AGENT"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {selected && (
            <aside className="legend-negotiation">
              <div className="legend-target">
                <p>{selectedEvent?.theme.name}</p>
                <span>
                  {selected.cardYear} / {selected.position} /{" "}
                  {selected.currentAge}세
                </span>
                <h2>{selected.nickname}</h2>
                <strong>
                  {selected.overall}
                  <small>OVR</small>
                </strong>
              </div>
              <section className="legend-interest">
                <h3>관심 구단</h3>
                {selected.interestedClubs.length > 0 ? (
                  <div>
                    {selected.interestedClubs.map((club) => (
                      <span key={club.id} title={club.name}>
                        {club.code}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p>현재 표시할 관심 구단이 없습니다.</p>
                )}
                <p>
                  선수의 결정과 경쟁 상황에 따라 다른 구단이 먼저 계약할 수
                  있습니다.
                </p>
              </section>
              {offer ? (
                <div className="legend-current-offer">
                  <h3>진행 중인 협상이 있습니다.</h3>
                  <p>계약 화면에서 제안 내용과 선수의 응답을 확인하세요.</p>
                  <button
                    disabled={busy}
                    onClick={() => onOpenContractOffer(offer.id)}
                  >
                    협상 이어가기 →
                  </button>
                </div>
              ) : selected.currentTeam ? (
                <div className="legend-current-offer">
                  <h3>{selected.currentTeam.name} 소속</h3>
                  <p>
                    이미 계약한 선수입니다. 영입하려면 소속 구단과 이적 협상이
                    필요합니다.
                  </p>
                </div>
              ) : !selected.canNegotiate ? (
                <div className="legend-current-offer">
                  <h3>현재 계약 제안 불가</h3>
                  <p>이적시장 기간과 구단의 영입 조건을 확인해 주세요.</p>
                </div>
              ) : (
                <form
                  className="legend-offer-form"
                  onSubmit={(event) => void submit(event)}
                >
                  <h3>계약 제안</h3>
                  <fieldset disabled={busy}>
                    <label>
                      연봉 <small>만원 / 년</small>
                      <input
                        type="number"
                        min={1}
                        max={10000000}
                        step={1}
                        required
                        value={
                          Number.isNaN(terms.annualSalary)
                            ? ""
                            : terms.annualSalary
                        }
                        onChange={(event) =>
                          setTerms((current) => ({
                            ...current,
                            annualSalary: event.target.valueAsNumber,
                          }))
                        }
                      />
                    </label>
                    <label>
                      계약 기간
                      <select
                        value={terms.years}
                        onChange={(event) =>
                          setTerms((current) => ({
                            ...current,
                            years: Number(event.target.value),
                          }))
                        }
                      >
                        {[1, 2, 3, 4, 5].map((year) => (
                          <option key={year} value={year}>
                            {year}년
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      예상 역할
                      <select
                        value={terms.expectedRole}
                        onChange={(event) => {
                          const role = event.target.value as ContractRole;
                          setTerms((current) => ({
                            ...current,
                            expectedRole: role,
                            starterGuarantee:
                              ["CORE", "STARTER"].includes(role) &&
                              current.starterGuarantee,
                          }));
                        }}
                      >
                        {Object.entries(ROLES).map(([role, label]) => (
                          <option key={role} value={role}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="legend-check">
                      <input
                        type="checkbox"
                        checked={terms.starterGuarantee}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setTerms((current) => ({
                            ...current,
                            starterGuarantee: checked,
                            expectedRole:
                              checked &&
                              !["CORE", "STARTER"].includes(
                                current.expectedRole,
                              )
                                ? "STARTER"
                                : current.expectedRole,
                          }));
                        }}
                      />
                      주전 출전 보장
                    </label>
                  </fieldset>
                  {!validSalary && (
                    <p className="legend-validation">
                      연봉은 1~10,000,000만원 사이 정수로 입력해 주세요.
                    </p>
                  )}
                  <p>
                    선수의 검토와 계약 확정까지 완료해야 우리 구단에 합류합니다.
                  </p>
                  <button disabled={busy || !validSalary} type="submit">
                    {busy ? "제안 전달 중…" : "계약 제안 보내기 →"}
                  </button>
                </form>
              )}
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

function toMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : "시장 정보를 처리하지 못했습니다.";
}
