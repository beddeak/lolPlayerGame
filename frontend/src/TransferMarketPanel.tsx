import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { apiRequest } from "./api";
import { DEFAULT_ANNUAL_SALARY, formatMoney } from "./money";
import {
  isOpenOffer,
  type TransferCandidate,
  type TransferWindow,
} from "./market-types";
import {
  POSITIONS,
  type Career,
  type ContractOffer,
  type ContractRole,
  type ContractTerms,
} from "./types";

interface Props {
  career: Career;
  token: string;
  onOpenContractOffer: (id: number) => void;
}
const defaultTerms = (): ContractTerms => ({
  annualSalary: DEFAULT_ANNUAL_SALARY,
  years: 2,
  expectedRole: "STARTER",
  starterGuarantee: false,
  promises: [],
});
export default function TransferMarketPanel({
  career,
  token,
  onOpenContractOffer,
}: Props) {
  const [players, setPlayers] = useState<TransferCandidate[]>([]);
  const [offers, setOffers] = useState<ContractOffer[]>([]);
  const [window, setWindow] = useState<TransferWindow | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");
  const [availability, setAvailability] = useState("");
  const [terms, setTerms] = useState(defaultTerms);
  const [fee, setFee] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const version = useRef(0);
  const base = `/careers/${career.id}`;
  const load = useCallback(async () => {
    const requestVersion = ++version.current;
    setLoading(true);
    setDataReady(false);
    setError("");
    try {
      const [nextPlayers, nextWindow, nextOffers] = await Promise.all([
        apiRequest<TransferCandidate[]>(`${base}/transfers/market`, { token }),
        apiRequest<TransferWindow>(`${base}/transfers/window`, { token }),
        apiRequest<ContractOffer[]>(`${base}/contracts/offers`, { token }),
      ]);
      if (!mounted.current || version.current !== requestVersion) return;
      setPlayers(nextPlayers);
      setWindow(nextWindow);
      setOffers(nextOffers);
      setDataReady(true);
    } catch (err) {
      if (mounted.current && version.current === requestVersion)
        setError(
          err instanceof Error
            ? err.message
            : "시장 정보를 불러오지 못했습니다.",
        );
    } finally {
      if (mounted.current && version.current === requestVersion)
        setLoading(false);
    }
  }, [base, token]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
      mounted.current = false;
      // Request generation, not a DOM ref; invalidate pending reads on cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      version.current++;
    };
  }, [load]);
  const visible = players.filter(
    (player) =>
      (!position || player.position === position) &&
      (!availability || player.availability === availability) &&
      `${player.nickname} ${player.currentTeam?.code ?? "FA"} ${player.currentTeam?.name ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selected = visible.find(
    (player) => player.careerPlayerId === selectedId,
  );
  const offer = offers.find(
    (item) => item.careerPlayerId === selectedId && isOpenOffer(item),
  );
  const valid =
    Number.isInteger(terms.annualSalary) &&
    terms.annualSalary >= 1 &&
    terms.annualSalary <= 10000000 &&
    Number.isInteger(fee) &&
    fee >= 0 &&
    fee <= 500000;
  const eligible =
    dataReady &&
    selected?.canNegotiate &&
    selected.hasBenchSpace &&
    window?.isOpen;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      inFlight.current ||
      loading ||
      !selected ||
      !eligible ||
      !valid ||
      offer
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      let agreementId = selected.activeAgreementId;
      if (selected.availability === "CONTRACTED" && agreementId === null) {
        const agreement = await apiRequest<{
          id: number;
          status: string;
          reason: string;
        }>(`${base}/transfers/agreements`, {
          token,
          method: "POST",
          body: { careerPlayerId: selected.careerPlayerId, offeredFee: fee },
        });
        if (!mounted.current) return;
        if (agreement.status !== "ACCEPTED") throw new Error(agreement.reason);
        agreementId = agreement.id;
        // Preserve a successful club agreement if the later player request fails.
        setPlayers((items) =>
          items.map((item) =>
            item.careerPlayerId === selected.careerPlayerId
              ? {
                  ...item,
                  activeAgreementId: agreement.id,
                  activeAgreementFee: fee,
                }
              : item,
          ),
        );
      }
      const created = await apiRequest<ContractOffer>(
        `${base}/contracts/offers`,
        {
          token,
          method: "POST",
          body: {
            careerPlayerId: selected.careerPlayerId,
            terms,
            ...(agreementId !== null
              ? { transferAgreementId: agreementId }
              : {}),
          },
        },
      );
      if (!mounted.current) return;
      setOffers((items) => [created, ...items]);
      onOpenContractOffer(created.id);
    } catch (err) {
      if (mounted.current) {
        // Reconcile an ambiguous response before enabling another submission.
        await load();
        if (mounted.current)
          setError(
            err instanceof Error
              ? err.message
              : "영입 요청을 처리하지 못했습니다.",
          );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="market-normal" aria-label="전체 선수 시장">
      <div className="market-section-title">
        <div>
          <h2>전체 선수 · FA</h2>
          <p>
            {window
              ? `${window.currentDate} · ${window.isOpen ? "이적시장 개장" : "이적시장 마감"} (${window.opensAt} ~ ${window.endsAt})`
              : "시장 일정 확인 중"}
          </p>
        </div>
        <button disabled={busy || loading} onClick={() => void load()}>
          시장 새로고침
        </button>
      </div>
      {error && (
        <p role="alert" className="market-error">
          {error}
        </p>
      )}
      <div className="market-filters">
        <label>
          선수·구단 검색
          <input
            value={search}
            disabled={busy}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="선수 이름 또는 구단"
          />
        </label>
        <label>
          포지션
          <select
            value={position}
            disabled={busy}
            onChange={(event) => setPosition(event.target.value)}
          >
            <option value="">모든 포지션</option>
            {POSITIONS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          계약 상태
          <select
            value={availability}
            disabled={busy}
            onChange={(event) => setAvailability(event.target.value)}
          >
            <option value="">전체</option>
            <option value="FREE_AGENT">FA 선수</option>
            <option value="CONTRACTED">구단 소속 선수</option>
          </select>
        </label>
      </div>
      {loading ? (
        <p>선수 시장을 불러오는 중…</p>
      ) : (
        <div className="market-layout">
          <div className="market-list">
            {!visible.length && <p>조건에 맞는 선수가 없습니다.</p>}
            {visible.map((player) => (
              <button
                key={player.careerPlayerId}
                disabled={busy}
                aria-pressed={player.careerPlayerId === selectedId}
                className="market-player"
                onClick={() => {
                  setSelectedId(player.careerPlayerId);
                  setTerms(defaultTerms());
                  setFee(player.activeAgreementFee ?? player.requiredFee);
                  setError("");
                }}
              >
                <strong className="market-ovr">{player.overall}</strong>
                <span>
                  <strong>{player.nickname}</strong>
                  <small>
                    {player.position} · {player.currentAge}세 ·{" "}
                    {player.currentTeam?.code ?? "FA"}
                  </small>
                </span>
                <span>
                  {player.availability === "FREE_AGENT"
                    ? "이적료 없음"
                    : formatMoney(player.requiredFee)}
                  <small>
                    {player.canNegotiate ? "협상 가능" : "협상 제한"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <aside className="market-box market-negotiation">
            {!selected ? (
              <p>선수를 선택하면 이적료와 계약 조건을 확인할 수 있습니다.</p>
            ) : (
              <>
                <p className="market-kicker">PLAYER NEGOTIATION</p>
                <h2>{selected.nickname}</h2>
                <p>
                  {selected.currentTeam?.name ?? "자유 계약 선수"} ·{" "}
                  {selected.nationality}
                </p>
                {selected.currentContract && (
                  <p>
                    현재 연봉{" "}
                    {formatMoney(selected.currentContract.annualSalary)} ·{" "}
                    {selected.currentContract.endDate} 만료
                  </p>
                )}
                {offer ? (
                  <button
                    className="market-primary"
                    disabled={busy}
                    onClick={() => onOpenContractOffer(offer.id)}
                  >
                    진행 중인 계약 협상 보기
                  </button>
                ) : (
                  <>
                    {selected.blockedReason && <p>{selected.blockedReason}</p>}
                    {!selected.hasBenchSpace && (
                      <p>
                        후보 자리가 없습니다. 먼저 선수를 판매하거나 선수단을
                        정리해 주세요.
                      </p>
                    )}
                    <form onSubmit={(event) => void submit(event)}>
                      <fieldset disabled={busy || !eligible}>
                        <legend>영입 조건</legend>
                        {selected.availability === "CONTRACTED" && (
                          <label>
                            이적료 · 만원
                            <input
                              aria-label="이적료"
                              type="number"
                              min={0}
                              max={500000}
                              step={1}
                              required
                              disabled={selected.activeAgreementId !== null}
                              value={Number.isNaN(fee) ? "" : fee}
                              onChange={(event) =>
                                setFee(event.target.valueAsNumber)
                              }
                            />
                            <strong className="money-preview">
                              {formatMoney(fee)}
                            </strong>
                            <small>
                              {selected.activeAgreementId
                                ? "구단 합의 완료 · 선수 계약만 진행합니다."
                                : `구단 요구액 ${formatMoney(selected.requiredFee)}`}
                            </small>
                          </label>
                        )}
                        <label>
                          연봉 · 만원 / 년
                          <input
                            aria-label="연봉"
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
                              setTerms({
                                ...terms,
                                annualSalary: event.target.valueAsNumber,
                              })
                            }
                          />
                          <strong className="money-preview">
                            {formatMoney(terms.annualSalary)}
                          </strong>
                        </label>
                        <label>
                          계약 기간
                          <select
                            value={terms.years}
                            onChange={(event) =>
                              setTerms({
                                ...terms,
                                years: Number(event.target.value),
                              })
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
                            onChange={(event) =>
                              setTerms({
                                ...terms,
                                expectedRole: event.target
                                  .value as ContractRole,
                              })
                            }
                          >
                            <option value="CORE">핵심 선수</option>
                            <option value="STARTER">주전</option>
                            <option value="ROTATION">로테이션</option>
                            <option value="PROSPECT">육성 선수</option>
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="market-primary"
                          disabled={!valid}
                        >
                          {busy
                            ? "협상 요청 중…"
                            : selected.availability === "FREE_AGENT" ||
                                selected.activeAgreementId
                              ? "선수 계약 제안"
                              : "구단 합의 후 계약 제안"}
                        </button>
                      </fieldset>
                    </form>
                    <p>
                      영입 선수는 후보에 합류합니다. 주전 보장·추가 약속은 계약
                      화면에서 재협상할 수 있습니다.
                    </p>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
