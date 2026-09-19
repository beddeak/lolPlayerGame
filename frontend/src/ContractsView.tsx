import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "./api";
import { DEFAULT_ANNUAL_SALARY, formatMoney as formatSalary } from "./money";
import PlayerSalesPanel from "./PlayerSalesPanel";
import {
  POSITIONS,
  type CalendarResponse,
  type Career,
  type CareerRoster,
  type ContractOffer,
  type ContractOfferAction,
  type ContractPromiseType,
  type ContractRole,
  type ContractTerms,
  type PlayerContract,
  type Position,
} from "./types";
import "./ContractsView.css";

const ROLES: Record<ContractRole, string> = {
  CORE: "핵심 선수",
  STARTER: "주전",
  ROTATION: "로테이션",
  PROSPECT: "육성 선수",
};
const PROMISES: Record<ContractPromiseType, string> = {
  STARTER_GUARANTEE: "주전 출전 보장",
  CARRY_ROLE: "캐리 역할 부여",
  STRENGTHEN_TEAM: "다음 시즌 전력 보강",
  SIGN_POSITION: "특정 포지션 보강",
};
const STATUS: Record<ContractOffer["status"], string> = {
  WAITING_PLAYER_RESPONSE: "선수 검토 중",
  PLAYER_ACCEPTED: "선수 수락 · 확정 대기",
  COUNTER_OFFERED: "선수 역제안",
  REJECTED: "선수 거절",
  WITHDRAWN: "협상 철회",
  SIGNED: "계약 체결",
};
const OPEN = new Set<ContractOffer["status"]>([
  "WAITING_PLAYER_RESPONSE",
  "PLAYER_ACCEPTED",
  "COUNTER_OFFERED",
  "REJECTED",
]);

interface Props {
  career: Career;
  token: string;
  initialOfferId: number | null;
  onBack: () => void;
  onOpenSeason: () => void;
  onCareerRefresh: () => Promise<void>;
}

function defaultTerms(roster?: CareerRoster): ContractTerms {
  return {
    annualSalary: DEFAULT_ANNUAL_SALARY,
    years: 2,
    starterGuarantee: false,
    expectedRole: roster?.role === "BENCH" ? "ROTATION" : "STARTER",
    promises: [],
  };
}

export default function ContractsView({
  career,
  token,
  initialOfferId,
  onBack,
  onOpenSeason,
  onCareerRefresh,
}: Props) {
  const team = career.teams.find((item) => item.isUserControlled);
  const roster = team ? [...team.starters, ...team.benches] : [];
  const [initialRoster] = useState(() => roster);
  const [contracts, setContracts] = useState<PlayerContract[]>([]);
  const [offers, setOffers] = useState<ContractOffer[]>([]);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);
  const [terms, setTerms] = useState<ContractTerms>(defaultTerms());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [salePlayerId, setSalePlayerId] = useState<number | null>(null);
  const base = `/careers/${career.id}/contracts`;
  const fetchData = useCallback(
    () =>
      Promise.all([
        apiRequest<PlayerContract[]>(base, { token }),
        apiRequest<ContractOffer[]>(`${base}/offers`, { token }),
        apiRequest<CalendarResponse>(`/careers/${career.id}/calendar`, {
          token,
        }),
      ]),
    [base, career.id, token],
  );

  useEffect(() => {
    let active = true;
    fetchData()
      .then(([nextContracts, nextOffers, nextCalendar]) => {
        if (!active) return;
        setContracts(nextContracts);
        setOffers(nextOffers);
        setCalendar(nextCalendar);
        const requested = nextOffers.find((item) => item.id === initialOfferId);
        const members = initialRoster;
        const initialOffer =
          requested ?? (members.length === 0 ? nextOffers[0] : undefined);
        const id =
          initialOffer?.careerPlayerId ?? members[0]?.careerPlayer.id ?? null;
        setPlayerId(id);
        setSelectedOfferId(initialOffer?.id ?? null);
        const current = nextContracts.find(
          (item) =>
            item.careerPlayerId === id && item.careerTeamId === team?.id,
        );
        const openOffer = nextOffers.find(
          (item) => item.careerPlayerId === id && OPEN.has(item.status),
        );
        setTerms(
          structuredClone(
            initialOffer?.terms ??
              openOffer?.terms ??
              current?.terms ??
              defaultTerms(members.find((item) => item.careerPlayer.id === id)),
          ),
        );
        setError("");
      })
      .catch((reason: unknown) => {
        if (active) setError(toMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchData, initialOfferId, initialRoster, reloadKey, team?.id]);

  const selected = roster.find((item) => item.careerPlayer.id === playerId);
  const managedContracts = contracts.filter(
    (item) => item.careerTeamId === team?.id,
  );
  const contract = managedContracts.find(
    (item) => item.careerPlayerId === playerId,
  );
  const offer =
    selectedOfferId !== null
      ? offers.find((item) => item.id === selectedOfferId)
      : offers.find(
          (item) => item.careerPlayerId === playerId && OPEN.has(item.status),
        );
  const externalOffers = offers.filter(
    (item) =>
      item.offerType !== "RENEWAL" &&
      !roster.some((member) => member.careerPlayer.id === item.careerPlayerId),
  );
  const player = selected
    ? {
        nickname: selected.careerPlayer.playerCard.player.nickname,
        currentPosition: selected.careerPlayer.currentPosition,
        currentAge: selected.careerPlayer.currentAge,
      }
    : offer?.player;
  const open = Boolean(offer && OPEN.has(offer.status));
  const ready = Boolean(
    open &&
    offer &&
    calendar?.blockingEvents.some(
      (event) => event.id === offer.responseEventId,
    ),
  );
  const editable = !busy && ((!offer && Boolean(selected)) || ready);
  const maySign =
    ready &&
    (offer?.status === "PLAYER_ACCEPTED" ||
      offer?.status === "COUNTER_OFFERED");
  const validation = validateTerms(terms);

  function selectPlayer(item: CareerRoster) {
    const id = item.careerPlayer.id;
    setPlayerId(id);
    setSelectedOfferId(null);
    const existingOffer = offers.find(
      (candidate) =>
        candidate.careerPlayerId === id && OPEN.has(candidate.status),
    );
    const existingContract = managedContracts.find(
      (candidate) => candidate.careerPlayerId === id,
    );
    setTerms(
      structuredClone(
        existingOffer?.terms ?? existingContract?.terms ?? defaultTerms(item),
      ),
    );
    setError("");
    setNotice("");
  }

  function selectOffer(item: ContractOffer) {
    setPlayerId(item.careerPlayerId);
    setSelectedOfferId(item.id);
    setTerms(structuredClone(item.terms));
    setError("");
    setNotice("");
  }

  async function mutate(action?: ContractOfferAction) {
    if (busy || (action ? !offer || !open : !selected)) return;
    if ((!action || action === "COUNTER") && validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest<ContractOffer>(
        action && offer
          ? `${base}/offers/${offer.id}/respond`
          : `${base}/offers`,
        {
          method: "POST",
          token,
          body: action
            ? { action, ...(action === "COUNTER" ? { terms } : {}) }
            : { careerPlayerId: playerId, terms },
        },
      );
      setNotice(
        action === "ACCEPT"
          ? "계약을 확정했습니다."
          : action === "WITHDRAW"
            ? "협상을 철회했습니다."
            : action === "REQUEST_TIME"
              ? "선수에게 답변할 시간을 2일 더 요청했습니다."
              : "제안을 전달했습니다. 시즌 허브에서 날짜를 진행해 주세요.",
      );
      const [[nextContracts, nextOffers, nextCalendar]] = await Promise.all([
        fetchData(),
        onCareerRefresh(),
      ]);
      setContracts(nextContracts);
      setOffers(nextOffers);
      setCalendar(nextCalendar);
      const nextOffer = nextOffers.find(
        (item) => item.careerPlayerId === playerId && OPEN.has(item.status),
      );
      const nextContract = nextContracts.find(
        (item) =>
          item.careerPlayerId === playerId && item.careerTeamId === team?.id,
      );
      setTerms(
        structuredClone(nextOffer?.terms ?? nextContract?.terms ?? terms),
      );
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function changeRole(role: ContractRole) {
    setTerms((value) => ({
      ...value,
      expectedRole: role,
      starterGuarantee:
        role === "CORE" || role === "STARTER" ? value.starterGuarantee : false,
      promises: value.promises.filter(
        (promise) =>
          (promise.type !== "CARRY_ROLE" || role === "CORE") &&
          (promise.type !== "STARTER_GUARANTEE" ||
            role === "CORE" ||
            role === "STARTER"),
      ),
    }));
  }

  function togglePromise(type: ContractPromiseType, checked: boolean) {
    setTerms((value) => ({
      ...value,
      expectedRole:
        checked && type === "CARRY_ROLE"
          ? "CORE"
          : checked &&
              type === "STARTER_GUARANTEE" &&
              value.expectedRole !== "CORE"
            ? "STARTER"
            : value.expectedRole,
      starterGuarantee:
        checked && type === "STARTER_GUARANTEE" ? true : value.starterGuarantee,
      promises: checked
        ? [
            ...value.promises,
            {
              type,
              ...(type === "SIGN_POSITION"
                ? { position: "TOP" as Position }
                : {}),
            },
          ]
        : value.promises.filter((item) => item.type !== type),
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(offer ? "COUNTER" : undefined);
  }

  return (
    <section className="contracts-page">
      <div className="contracts-nav">
        <button onClick={onBack}>← 구단 사무실</button>
        <button onClick={onOpenSeason}>시즌 허브 →</button>
      </div>
      <header className="contracts-hero">
        <div>
          <p>CLUB OFFICE / CONTRACTS</p>
          <h1>선수와 그리는 다음 시즌</h1>
          <span>
            {team?.name} · {calendar?.currentDate ?? career.currentDate}
          </span>
        </div>
        <div className="contracts-count">
          <strong>{managedContracts.length}</strong>
          <span>체결 계약</span>
        </div>
      </header>
      {error && (
        <div className="contracts-alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="contracts-alert success" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <p className="contracts-empty">계약 정보를 불러오는 중입니다.</p>
      ) : !calendar ? (
        <div className="contracts-empty">
          <p>계약 정보를 불러오지 못했습니다.</p>
          <button
            onClick={() => {
              setLoading(true);
              setReloadKey((value) => value + 1);
            }}
          >
            다시 불러오기
          </button>
        </div>
      ) : !player ? (
        <p className="contracts-empty">
          계약할 소속 선수나 영입 협상이 없습니다.
        </p>
      ) : (
        <div className="contracts-layout">
          <aside className="contracts-roster">
            <h2>
              소속 선수 <small>{roster.length}</small>
            </h2>
            {roster.map((item) => {
              const id = item.careerPlayer.id;
              const pending = offers.find(
                (entry) =>
                  entry.careerPlayerId === id && OPEN.has(entry.status),
              );
              const signed = managedContracts.find(
                (entry) => entry.careerPlayerId === id,
              );
              return (
                <button
                  key={id}
                  disabled={busy}
                  className={id === playerId ? "selected" : ""}
                  onClick={() => selectPlayer(item)}
                >
                  <span className="contracts-position">
                    {item.careerPlayer.currentPosition}
                  </span>
                  <strong>
                    {item.careerPlayer.playerCard.player.nickname}
                  </strong>
                  <small>
                    {pending
                      ? STATUS[pending.status]
                      : signed
                        ? `${formatSalary(signed.terms.annualSalary)} / 년`
                        : "등록된 계약 없음"}
                  </small>
                </button>
              );
            })}
            <p>소속 선수의 계약과 재계약을 관리합니다.</p>
            {externalOffers.length > 0 && (
              <h2>
                외부 선수 영입 협상 <small>{externalOffers.length}</small>
              </h2>
            )}
            {externalOffers.map((item) => (
              <button
                key={`offer-${item.id}`}
                disabled={busy}
                className={item.id === offer?.id ? "selected" : ""}
                onClick={() => selectOffer(item)}
              >
                <span className="contracts-position">
                  {item.offerType === "FREE_AGENT" ? "FA" : "이적"} ·{" "}
                  {item.player.currentPosition}
                </span>
                <strong>{item.player.nickname}</strong>
                <small>
                  #{item.id} · {STATUS[item.status]}
                </small>
              </button>
            ))}
          </aside>
          <div className="contracts-main">
            <section className="contracts-player">
              <div>
                <span>
                  {!selected
                    ? offer?.offerType === "FREE_AGENT"
                      ? "FREE AGENT"
                      : "TRANSFER TARGET"
                    : selected.role === "STARTER"
                      ? "STARTING PLAYER"
                      : "BENCH PLAYER"}
                </span>
                <h2>{player.nickname}</h2>
                <p>
                  {player.currentPosition} · {player.currentAge}세
                  {selected &&
                    ` · 감독 신뢰 ${selected.careerPlayer.coachTrust}`}
                </p>
              </div>
              <div>
                <span>현재 계약</span>
                <strong>
                  {contract
                    ? `${formatSalary(contract.terms.annualSalary)} / 년`
                    : selected
                      ? "미등록"
                      : "우리 구단과 미계약"}
                </strong>
                <small>
                  {contract
                    ? `${contract.startDate} ~ ${contract.endDate}`
                    : selected
                      ? "새 계약을 제안해 주세요."
                      : "영입 협상 내용을 확인해 주세요."}
                </small>
              </div>
            </section>
            {selected && (
              <div className="contracts-sale-action">
                <button
                  disabled={busy}
                  onClick={() =>
                    setSalePlayerId(salePlayerId === playerId ? null : playerId)
                  }
                >
                  {salePlayerId === playerId ? "판매 화면 닫기" : "선수 팔기"}
                </button>
                {salePlayerId === playerId && playerId !== null && (
                  <PlayerSalesPanel
                    key={playerId}
                    career={career}
                    token={token}
                    playerId={playerId}
                    onCareerUpdated={onCareerRefresh}
                    onOpenSeason={onOpenSeason}
                  />
                )}
              </div>
            )}
            {contract && (
              <section className="contracts-signed">
                <h3>체결 조건과 약속</h3>
                <TermsSummary terms={contract.terms} />
                <p>
                  약속은 계약에 저장됩니다. 주전 보장만으로 현재 선발 명단이
                  바뀌지는 않습니다.
                </p>
              </section>
            )}
            {offer && (
              <section className={`contracts-response ${ready ? "ready" : ""}`}>
                <div className="contracts-section-title">
                  <h3>{STATUS[offer.status]}</h3>
                  <span>
                    제안 #{offer.id} · {offer.revision}차 검토
                  </span>
                </div>
                <p>
                  {!open
                    ? "종료된 협상입니다."
                    : ready
                      ? offer.response?.reason
                      : `답변 예정일 ${offer.responseDate}. 시즌 허브에서 날짜를 진행하면 선수의 답변을 확인할 수 있습니다.`}
                </p>
                {offer.counterTerms && (
                  <>
                    <h4>선수 측 요청 조건</h4>
                    <TermsSummary terms={offer.counterTerms} />
                  </>
                )}
                {offer.status === "PLAYER_ACCEPTED" && (
                  <TermsSummary terms={offer.terms} />
                )}
                {open && (
                  <div className="contracts-decision-actions">
                    {maySign && (
                      <button
                        className="contracts-primary"
                        disabled={busy}
                        onClick={() => void mutate("ACCEPT")}
                      >
                        {offer.status === "COUNTER_OFFERED"
                          ? "요청 조건 수락 · 계약 확정"
                          : "계약 확정"}
                      </button>
                    )}
                    {ready && offer.status !== "REJECTED" && (
                      <>
                        <button
                          disabled={busy || offer.revision >= 5}
                          onClick={() => void mutate("KEEP")}
                        >
                          기존 조건 유지
                        </button>
                        <button
                          disabled={busy || offer.extensionsUsed >= 1}
                          onClick={() => void mutate("REQUEST_TIME")}
                        >
                          답변 시간 2일 요청
                        </button>
                      </>
                    )}
                    <button
                      disabled={busy}
                      className="contracts-withdraw"
                      onClick={() => void mutate("WITHDRAW")}
                    >
                      협상 철회
                    </button>
                    {!ready && (
                      <button disabled={busy} onClick={onOpenSeason}>
                        날짜 진행하러 가기 →
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            {(!offer || open) && (
              <form className="contracts-form" onSubmit={submit}>
                <div className="contracts-section-title">
                  <h3>
                    {offer
                      ? "재협상 조건"
                      : contract
                        ? "재계약 제안"
                        : "계약 제안"}
                  </h3>
                  <span>
                    {offer
                      ? "수정 조건을 보내면 다시 검토합니다"
                      : "응답까지 게임 날짜 기준 1~3일"}
                  </span>
                </div>
                <fieldset disabled={!editable}>
                  <legend className="contracts-sr-only">계약 조건</legend>
                  <div className="contracts-fields">
                    <label>
                      연봉 <span>만원 / 년</span>
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
                          setTerms((value) => ({
                            ...value,
                            annualSalary: event.target.valueAsNumber,
                          }))
                        }
                      />
                      <small className="money-preview">
                        {Number.isFinite(terms.annualSalary)
                          ? formatSalary(terms.annualSalary)
                          : "연봉을 입력해 주세요"}
                      </small>
                    </label>
                    <label>
                      계약 기간
                      <select
                        value={terms.years}
                        onChange={(event) =>
                          setTerms((value) => ({
                            ...value,
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
                        onChange={(event) =>
                          changeRole(event.target.value as ContractRole)
                        }
                      >
                        {Object.entries(ROLES).map(([role, label]) => (
                          <option key={role} value={role}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="contracts-check">
                    <input
                      type="checkbox"
                      checked={terms.starterGuarantee}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setTerms((value) => ({
                          ...value,
                          starterGuarantee: checked,
                          expectedRole:
                            checked &&
                            !["CORE", "STARTER"].includes(value.expectedRole)
                              ? "STARTER"
                              : value.expectedRole,
                          promises: checked
                            ? value.promises
                            : value.promises.filter(
                                (item) => item.type !== "STARTER_GUARANTEE",
                              ),
                        }));
                      }}
                    />
                    <span>주전 보장</span>
                  </label>
                  <h4>감독의 약속</h4>
                  <div className="contracts-promises">
                    {Object.entries(PROMISES).map(([key, label]) => (
                      <label key={key} className="contracts-check">
                        <input
                          type="checkbox"
                          checked={terms.promises.some(
                            (item) => item.type === key,
                          )}
                          onChange={(event) =>
                            togglePromise(
                              key as ContractPromiseType,
                              event.target.checked,
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  {terms.promises.some(
                    (item) => item.type === "SIGN_POSITION",
                  ) && (
                    <label className="contracts-position-select">
                      보강할 포지션
                      <select
                        value={
                          terms.promises.find(
                            (item) => item.type === "SIGN_POSITION",
                          )?.position ?? "TOP"
                        }
                        onChange={(event) =>
                          setTerms((value) => ({
                            ...value,
                            promises: value.promises.map((item) =>
                              item.type === "SIGN_POSITION"
                                ? {
                                    ...item,
                                    position: event.target.value as Position,
                                  }
                                : item,
                            ),
                          }))
                        }
                      >
                        {POSITIONS.map((position) => (
                          <option key={position}>{position}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </fieldset>
                {editable && validation && (
                  <p className="contracts-validation">{validation}</p>
                )}
                <div className="contracts-form-footer">
                  <p>확정한 게임 날짜부터 새 계약 조건을 적용합니다.</p>
                  <button
                    className="contracts-primary"
                    type="submit"
                    disabled={
                      !editable ||
                      Boolean(validation) ||
                      Boolean(offer && offer.revision >= 5)
                    }
                  >
                    {busy
                      ? "처리 중…"
                      : offer
                        ? "수정 조건으로 재협상"
                        : "계약 제안 보내기"}
                  </button>
                </div>
              </form>
            )}
            <section className="contracts-history">
              <h3>이 선수의 협상 기록</h3>
              {offers
                .filter((item) => item.careerPlayerId === playerId)
                .map((item) => (
                  <div key={item.id}>
                    <span>
                      #{item.id} · {item.offeredDate}
                    </span>
                    <strong>{STATUS[item.status]}</strong>
                    <span>
                      {formatSalary(item.terms.annualSalary)} ·{" "}
                      {item.terms.years}년
                    </span>
                  </div>
                ))}
              {!offers.some((item) => item.careerPlayerId === playerId) && (
                <p>아직 제안한 계약이 없습니다.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

function TermsSummary({ terms }: { terms: ContractTerms }) {
  return (
    <div className="contracts-terms-summary">
      <strong>{formatSalary(terms.annualSalary)} / 년</strong>
      <span>
        {terms.years}년 · {ROLES[terms.expectedRole]} ·{" "}
        {terms.starterGuarantee ? "주전 보장" : "출전 경쟁"}
      </span>
      {terms.promises.length > 0 && (
        <ul>
          {terms.promises.map((promise) => (
            <li key={`${promise.type}-${promise.position ?? ""}`}>
              {PROMISES[promise.type]}
              {promise.position ? ` (${promise.position})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function validateTerms(terms: ContractTerms): string {
  if (
    !Number.isInteger(terms.annualSalary) ||
    terms.annualSalary < 1 ||
    terms.annualSalary > 10000000
  )
    return "연봉은 1~10,000,000만원 사이 정수로 입력해 주세요.";
  return "";
}
function toMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "계약 요청을 처리하지 못했습니다.";
}
