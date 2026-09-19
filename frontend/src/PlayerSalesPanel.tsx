import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { apiRequest } from "./api";
import { formatMoney } from "./money";
import {
  isOpenOffer,
  type PlayerSale,
  type TransferCandidate,
} from "./market-types";
import type { Career } from "./types";
import "./MarketView.css";

interface Props {
  career: Career;
  token: string;
  playerId?: number;
  onCareerUpdated: () => Promise<void>;
  onOpenSeason: () => void;
}

export default function PlayerSalesPanel({
  career,
  token,
  playerId,
  onCareerUpdated,
  onOpenSeason,
}: Props) {
  const buyers = career.teams.filter((team) => !team.isUserControlled);
  const [buyerId, setBuyerId] = useState(buyers[0]?.id ?? 0);
  const [fee, setFee] = useState(10000);
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [sales, setSales] = useState<PlayerSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const version = useRef(0);
  const base = `/careers/${career.id}`;
  const fetchData = useCallback(
    () =>
      Promise.all([
        apiRequest<PlayerSale[]>(`${base}/contracts/sales`, { token }),
        playerId === undefined
          ? Promise.resolve([] as TransferCandidate[])
          : apiRequest<TransferCandidate[]>(
              `${base}/transfers/sale-candidates`,
              { token },
            ),
      ]),
    [base, token, playerId],
  );

  const load = useCallback(async () => {
    const requestVersion = ++version.current;
    setLoading(true);
    setDataReady(false);
    setError("");
    try {
      const [nextSales, nextCandidates] = await fetchData();
      if (!mounted.current || requestVersion !== version.current) return;
      setSales(nextSales);
      setCandidates(nextCandidates);
      setDataReady(true);
      setFee(
        nextCandidates.find((item) => item.careerPlayerId === playerId)
          ?.requiredFee ?? 10000,
      );
    } catch (err) {
      if (mounted.current && requestVersion === version.current)
        setError(
          err instanceof Error
            ? err.message
            : "판매 정보를 불러오지 못했습니다.",
        );
    } finally {
      if (mounted.current && requestVersion === version.current)
        setLoading(false);
    }
  }, [fetchData, playerId]);
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

  const selected = candidates.find((item) => item.careerPlayerId === playerId);
  const visibleSales = sales.filter(
    (sale) => playerId === undefined || sale.careerPlayerId === playerId,
  );
  const pending = visibleSales.some(isOpenOffer);
  const validFee = Number.isInteger(fee) && fee >= 5000 && fee <= 500000;

  async function submit(event?: FormEvent, cancelId?: number) {
    event?.preventDefault();
    if (inFlight.current || loading || !dataReady) return;
    if (
      cancelId === undefined &&
      (!selected?.canNegotiate || pending || !buyerId || !validFee)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(
        `${base}/contracts/sales${cancelId === undefined ? "" : `/${cancelId}/cancel`}`,
        {
          token,
          method: "POST",
          ...(cancelId === undefined
            ? {
                body: {
                  careerPlayerId: playerId,
                  buyerCareerTeamId: buyerId,
                  askingFee: fee,
                },
              }
            : {}),
        },
      );
      if (!mounted.current) return;
      setNotice(
        cancelId === undefined
          ? "판매 제안을 보냈습니다. 날짜를 진행하면 선수 계약 결과가 결정됩니다."
          : "판매 협상을 철회했습니다.",
      );
      await load();
      if (mounted.current) await onCareerUpdated();
    } catch (err) {
      if (mounted.current) {
        await load();
        if (mounted.current)
          setError(
            err instanceof Error
              ? err.message
              : "판매 요청을 처리하지 못했습니다.",
          );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="player-sales market-box" aria-label="선수 판매">
      <div className="market-section-title">
        <h2>{playerId === undefined ? "내 구단 판매 내역" : "선수 팔기"}</h2>
        <button disabled={busy || loading} onClick={() => void load()}>
          판매 내역 새로고침
        </button>
      </div>
      {error && (
        <p role="alert" className="market-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p>판매 정보를 불러오는 중…</p>
      ) : (
        <>
          {playerId !== undefined && (
            <>
              <p>
                방출이 아닌 구단 간 이적입니다. 구매 구단의 예산·평가액과 선수의
                계약 수락을 확인한 후 이동합니다.
              </p>
              {!selected ? (
                <p>현재 내 구단 소속 선수가 아닙니다.</p>
              ) : (
                <>
                  <p>
                    구단 평가액:{" "}
                    <strong>{formatMoney(selected.requiredFee)}</strong>
                  </p>
                  {selected.blockedReason && <p>{selected.blockedReason}</p>}
                  <form onSubmit={(event) => void submit(event)}>
                    <fieldset
                      disabled={
                        busy || pending || !dataReady || !selected.canNegotiate
                      }
                    >
                      <legend>판매 제안 조건</legend>
                      <div className="market-fields">
                        <label>
                          구매 구단
                          <select
                            value={buyerId}
                            onChange={(event) =>
                              setBuyerId(Number(event.target.value))
                            }
                          >
                            {buyers.map((team) => (
                              <option key={team.id} value={team.id}>
                                {team.name} · {team.region}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          희망 이적료 · 만원
                          <input
                            aria-label="희망 이적료"
                            type="number"
                            min={5000}
                            max={500000}
                            step={1}
                            required
                            value={Number.isNaN(fee) ? "" : fee}
                            onChange={(event) =>
                              setFee(event.target.valueAsNumber)
                            }
                          />
                          <strong className="money-preview">
                            {formatMoney(fee)}
                          </strong>
                        </label>
                      </div>
                      <button
                        className="market-primary"
                        type="submit"
                        disabled={!validFee || !buyerId}
                      >
                        판매 제안 보내기
                      </button>
                    </fieldset>
                  </form>
                </>
              )}
            </>
          )}
          {visibleSales.map((sale) => (
            <article className="market-sale-row" key={sale.id}>
              <div>
                <strong>
                  {sale.nickname} → {sale.buyerTeam.code}
                </strong>
                <p>
                  {formatMoney(sale.transferFee)} ·{" "}
                  {sale.status === "SIGNED"
                    ? "판매 완료"
                    : isOpenOffer(sale)
                      ? `선수 검토 중 · ${sale.responseDate} 답변 예정`
                      : "협상 종료"}
                </p>
                {sale.reason && <small>{sale.reason}</small>}
              </div>
              {isOpenOffer(sale) && (
                <button
                  disabled={busy || !dataReady}
                  onClick={() => void submit(undefined, sale.id)}
                >
                  판매 철회
                </button>
              )}
            </article>
          ))}
          {!visibleSales.length && <p>아직 판매 제안이 없습니다.</p>}
          {pending && (
            <button disabled={busy} onClick={onOpenSeason}>
              날짜 진행하러 가기 →
            </button>
          )}
        </>
      )}
    </section>
  );
}
