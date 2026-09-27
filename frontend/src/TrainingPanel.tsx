import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import PlayerCardArtwork from "./PlayerCardArtwork";
import { hasCardArtwork } from "./card-artwork";
import {
  positionFit,
  playerForPositionDisplay,
  positionDisplayOverall,
} from "./position-fit";
import type { Career, CareerPlayer, CareerTeam, Position } from "./types";
import "./TrainingPanel.css";

const STATS = [
  ["MECHANICS", "메카닉", "currentMechanics"],
  ["GAME_SENSE", "게임 이해도", "currentGameSense"],
  ["LANING", "라인전", "currentLaning"],
  ["TEAM_FIGHT", "한타", "currentTeamFight"],
  ["MACRO", "운영", "currentMacro"],
  ["TEAM_PLAY", "팀플레이", "currentTeamPlay"],
  ["MENTAL", "멘탈", "currentMental"],
  ["CHAMPION_POOL", "챔피언 폭", "currentChampionPool"],
] as const;
const STRATEGIES: Record<string, string> = {
  BALANCED: "균형 운영",
  TOP_CARRY: "탑 캐리",
  TOP_JUNGLE: "탑·정글",
  MID_CARRY: "미드 캐리",
  MID_JUNGLE: "미드·정글",
  UPPER_SIDE: "상체 중심",
  BOT_CARRY: "바텀 캐리",
  BOT_PRESSURE: "바텀 압박",
};
const POSITIONS = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;
const POSITION_LABELS = {
  TOP: "TOP",
  JUNGLE: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUP",
};
function trainingTarget(player: CareerPlayer, choice: string) {
  if (choice.startsWith("POSITION:")) {
    const position = choice.split(":")[1] as Position;
    return {
      label: `${POSITION_LABELS[position]} 적응`,
      value: positionFit(player, position).proficiency,
      max: 100,
      body: { type: "POSITION", position },
    };
  }
  const stat = STATS.find((item) => item[0] === choice) ?? STATS[2];
  return {
    label: stat[1],
    value: player[stat[2]],
    max: 119,
    body: { type: stat[0] },
  };
}
export interface TrainingPeriod {
  weekStartsAt: string;
  weekEndsAt: string;
  phaseLabel: string;
  available: boolean;
  teamAvailable: boolean;
  teamRested: boolean;
  unavailableReason: string | null;
  usedPlayerIds: number[];
  teamTraining: { remaining: number; limit: number };
  sessions: Array<{
    id: number;
    type: string;
    careerPlayerId: number | null;
    resultDelta: number;
    conditionDelta: number | null;
    playerEffects: Array<{
      careerPlayerId: number;
      conditionBefore: number;
      conditionAfter: number;
      conditionDelta: number;
      formBefore: number;
      formAfter: number;
      formDelta: number;
    }>;
  }>;
}

export default function TrainingPanel({
  career,
  team,
  token,
  onCareerRefresh,
  onOpenPlayer,
}: {
  career: Career;
  team: CareerTeam;
  token: string;
  onCareerRefresh: () => Promise<void>;
  onOpenPlayer: (player: CareerPlayer) => void;
}) {
  const [period, setPeriod] = useState<TrainingPeriod | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [strategy, setStrategy] = useState(team.teamStrategy);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const dragSource = useRef<number | null>(null);
  const [movePosition, setMovePosition] = useState<Position>("MID");
  const [rosterUncertain, setRosterUncertain] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef(false);
  const version = useRef(0);
  const path = `/careers/${career.id}/training-periods/current`;
  useEffect(() => {
    if (selectedId === null) return;
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selectedId]);
  function closePlayer() {
    dialog.current?.close();
    setSelectedId(null);
    trigger.current?.focus();
  }
  useEffect(() => {
    const request = ++version.current;
    void apiRequest<TrainingPeriod>(path, { token })
      .then((result) => {
        if (version.current === request) setPeriod(result);
      })
      .catch((reason) => {
        if (version.current === request)
          setError(
            reason instanceof Error
              ? reason.message
              : "훈련 정보를 불러오지 못했습니다.",
          );
      });
    return () => {
      version.current = request + 1;
    };
  }, [path, token, career.currentDate]);

  async function act(category: "team" | "individual", body: object) {
    if (
      pending.current ||
      rosterUncertain ||
      !period ||
      (category === "team"
        ? !period.teamAvailable || period.teamTraining.remaining === 0
        : !period.available || period.teamRested)
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const request = version.current;
    try {
      const result = await apiRequest<TrainingPeriod>(`${path}/${category}`, {
        method: "POST",
        token,
        body,
      });
      if (request === version.current) {
        setPeriod(result);
        setMessage(
          result.teamRested
            ? "팀 전체 휴식 완료. 선수별 컨디션·폼 회복 결과를 확인하세요."
            : "이번 주 활동이 저장되었습니다.",
        );
      }
      // Parent refresh is session/save guarded. Navigation must not discard a
      // committed mutation; the version guard applies only to this panel's UI.
      await onCareerRefresh();
    } catch (reason) {
      if (request === version.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : "활동을 저장하지 못했습니다.",
        );
        // A conflict/uncertain response must not leave stale usage enabled.
        try {
          const latest = await apiRequest<TrainingPeriod>(path, { token });
          if (request === version.current) setPeriod(latest);
        } catch {
          if (request === version.current) setPeriod(null);
        }
      }
      try {
        await onCareerRefresh();
      } catch {
        if (request === version.current) setRosterUncertain(true);
      }
    } finally {
      pending.current = false;
      if (request === version.current) setBusy(false);
    }
  }
  async function movePlayer(playerId: number, position: Position) {
    const roster = [...team.starters, ...team.benches].find(
      (slot) => slot.careerPlayer.id === playerId,
    );
    if (
      pending.current ||
      rosterUncertain ||
      !roster ||
      roster.starterPosition === position
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const request = version.current;
    try {
      await apiRequest(
        `/careers/${career.id}/teams/${team.id}/starters/${position}/swap`,
        {
          method: "PATCH",
          token,
          body: { careerPlayerId: playerId },
        },
      );
      await onCareerRefresh();
      if (request === version.current)
        setMessage(
          "선발 배치를 저장했습니다. 포지션 적응도와 적용 능력치를 확인하세요.",
        );
    } catch (reason) {
      if (request === version.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "선발 배치를 저장하지 못했습니다.",
        );
      // A lost PATCH response may already have committed. Never swap twice to retry it.
      try {
        await onCareerRefresh();
      } catch {
        if (request === version.current) setRosterUncertain(true);
      }
    } finally {
      pending.current = false;
      if (request === version.current) setBusy(false);
    }
  }
  const players = [...team.starters, ...team.benches].map(
    (roster) => roster.careerPlayer,
  );
  const disabled =
    busy || rosterUncertain || !period?.available || !!period?.teamRested;
  const teamDisabled =
    busy ||
    rosterUncertain ||
    !period?.teamAvailable ||
    period.teamTraining.remaining === 0;
  const latestTeamActivity = period?.sessions
    .filter((session) => session.careerPlayerId === null)
    .at(-1);
  const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
  const selectedPlayer = players.find((player) => player.id === selectedId);
  const selectedPosition = team.starters.find(
    (slot) => slot.careerPlayer.id === selectedId,
  )?.starterPosition;
  function adaptationPosition(player: CareerPlayer) {
    const assigned = team.starters.find(
      (slot) => slot.careerPlayer.id === player.id,
    )?.starterPosition;
    return assigned && assigned !== player.currentPosition
      ? assigned
      : undefined;
  }
  function trainingChoice(player: CareerPlayer) {
    const choice = choices[player.id] ?? "LANING";
    // A previously selected adaptation target becomes invalid after a swap.
    return choice.startsWith("POSITION:") &&
      choice !== `POSITION:${adaptationPosition(player)}`
      ? "LANING"
      : choice;
  }
  function trainingReason(player: CareerPlayer) {
    const target = trainingTarget(player, trainingChoice(player));
    if (rosterUncertain)
      return "선수단을 다시 확인하려면 화면을 다시 열어 주세요.";
    if (busy) return "활동을 저장하고 있습니다.";
    if (!period)
      return "활동 정보를 확인할 수 없습니다. 화면을 다시 열어 주세요.";
    if (!period.available)
      return (
        period.unavailableReason ||
        "개인 훈련은 프리시즌·준비 기간에만 가능합니다."
      );
    if (period.teamRested)
      return "이번 주는 팀 휴식을 선택해 개인 훈련을 할 수 없습니다.";
    if (period.usedPlayerIds.includes(player.id))
      return "이번 주 개인 훈련을 완료했습니다.";
    if (player.condition <= 0)
      return "컨디션이 소진되었습니다. 팀 휴식이 필요합니다.";
    if (target.value >= target.max)
      return `선택한 능력치가 최대치 ${target.max}입니다. 다른 능력치를 선택하세요.`;
    return "";
  }
  function playerCard(
    player: CareerPlayer,
    label: string,
    assigned?: Position,
  ) {
    const displayPlayer = playerForPositionDisplay(player, assigned);
    const overall = positionDisplayOverall(displayPlayer);
    const reduced = displayPlayer !== player;
    return (
      <button
        type="button"
        className={`management-player-card${reduced ? " is-off-position" : ""}`}
        key={player.id}
        aria-label={`${player.playerCard.player.nickname} 훈련 관리`}
        aria-haspopup="dialog"
        draggable={!busy && !rosterUncertain}
        onDragStart={(event) => {
          if (pending.current || rosterUncertain) {
            event.preventDefault();
            return;
          }
          dragSource.current = player.id;
          setDragId(player.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(player.id));
        }}
        onDragEnd={() => {
          dragSource.current = null;
          setDragId(null);
        }}
        onDragOver={
          assigned
            ? undefined
            : (event) => {
                if (
                  !pending.current &&
                  !rosterUncertain &&
                  team.starters.some(
                    (slot) => slot.careerPlayer.id === dragSource.current,
                  )
                ) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }
        }
        onDrop={
          assigned
            ? undefined
            : (event) => {
                event.preventDefault();
                const source = team.starters.find(
                  (slot) => slot.careerPlayer.id === dragSource.current,
                );
                dragSource.current = null;
                setDragId(null);
                if (source?.starterPosition)
                  void movePlayer(player.id, source.starterPosition);
              }
        }
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setSelectedId(player.id);
        }}
      >
        <span className="management-card-top">
          <span>{label}</span>
          <strong>
            <span className="live-position-number" key={overall}>
              {overall}
            </span>
            <small> OVR</small>
          </strong>
        </span>
        <span className="management-card-image">
          {hasCardArtwork(player.playerCard) ? (
            <PlayerCardArtwork
              card={player.playerCard}
              player={displayPlayer}
            />
          ) : (
            <img
              draggable={false}
              alt=""
              src={
                player.playerCard.imageUrl ||
                `/player-cards/dev-blue-${player.currentPosition.toLowerCase()}.svg`
              }
            />
          )}
        </span>
        <strong className="management-card-name">
          {player.playerCard.player.nickname}
        </strong>
        {assigned && (
          <span className="management-position-fit">
            {POSITION_LABELS[assigned]} 적응{" "}
            {positionFit(player, assigned).proficiency}
            <b>{reduced ? "현재 배치 기준 능력치" : "정상 능력치"}</b>
          </span>
        )}
        <span className="management-card-abilities">
          {[
            ["MECH", displayPlayer.currentMechanics],
            ["LANE", displayPlayer.currentLaning],
            ["FIGHT", displayPlayer.currentTeamFight],
          ].map(([label, value]) => (
            <span key={label}>
              <small>{label}</small>
              <b className="live-position-number" key={value}>
                {value}
              </b>
            </span>
          ))}
        </span>
        <span className="management-card-state">
          <span>
            컨디션 <b>{player.condition}</b>
          </span>
          <progress
            max={100}
            value={player.condition}
            aria-label={`${player.playerCard.player.nickname} 컨디션`}
          />
          <span>
            폼 <b>{player.form}</b>
          </span>
          <progress
            max={100}
            value={player.form}
            aria-label={`${player.playerCard.player.nickname} 폼`}
          />
        </span>
        <span className="management-card-hint">
          {period?.usedPlayerIds.includes(player.id)
            ? "이번 주 훈련 완료"
            : "선택하여 훈련 관리"}
        </span>
      </button>
    );
  }
  return (
    <section className="training-panel" aria-busy={busy}>
      <header>
        <p className="eyebrow">TEAM MANAGEMENT</p>
        <h2>팀 관리</h2>
        <p>
          {period
            ? `${period.weekStartsAt} — ${period.weekEndsAt} · ${period.phaseLabel}`
            : "활동 정보를 불러오는 중…"}
        </p>
      </header>
      {error && (
        <p className="training-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="training-message" role="status">
          {message}
        </p>
      )}
      {period && !period.available && (
        <p className="training-notice">{period.unavailableReason}</p>
      )}
      <div className="management-layout">
        <div className="management-roster">
          <section className="management-starters" aria-label="선발 5명">
            <div className="training-section-heading">
              <h3>STARTING FIVE</h3>
              <p>카드를 원하는 자리로 드래그 · 클릭하면 훈련·배치</p>
            </div>
            <div className="management-card-scroll">
              <div className="management-starting-row">
                {POSITIONS.map((position) => {
                  const player = team.starters.find(
                    (roster) => roster.starterPosition === position,
                  )?.careerPlayer;
                  return (
                    <div
                      className={`management-drop-slot${dragId !== null ? " is-dragging" : ""}`}
                      key={position}
                      aria-label={`${POSITION_LABELS[position]} 선발 자리`}
                      onDragOver={(event) => {
                        if (
                          dragSource.current !== null &&
                          !pending.current &&
                          !rosterUncertain
                        ) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const source = dragSource.current;
                        dragSource.current = null;
                        setDragId(null);
                        if (source !== null) void movePlayer(source, position);
                      }}
                    >
                      {player ? (
                        playerCard(player, POSITION_LABELS[position], position)
                      ) : (
                        <div className="management-empty-slot">
                          <strong>{POSITION_LABELS[position]}</strong>
                          <span>선발 미등록</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
          <section className="management-bench" aria-label="후보 선수">
            <div className="training-section-heading">
              <h3>
                BENCH <small>{team.benches.length}</small>
              </h3>
              <p>
                주전 카드를 후보 카드 위로 끌어 교체 · 후보도 개인 훈련 가능
              </p>
            </div>
            {team.benches.length ? (
              <div className="management-bench-row">
                {team.benches.map((roster) =>
                  playerCard(
                    roster.careerPlayer,
                    POSITION_LABELS[roster.careerPlayer.currentPosition],
                  ),
                )}
              </div>
            ) : (
              <p className="management-bench-empty">
                등록된 후보 선수가 없습니다.
              </p>
            )}
          </section>
          <p className="training-help">
            주전끼리는 자리를 맞바꾸고, 후보를 넣으면 기존 선발은 벤치로
            이동합니다. 다른 포지션은 숙련도에 따라 경기 능력치가 최대 40
            낮아집니다. 원본 스탯은 유지됩니다. 개인 훈련은 준비 기간에 선수마다
            주 1회 가능합니다. 카드 선택 후 능력치를 골라 주세요.
          </p>
        </div>
        <aside className="management-team-panel" aria-label="팀 주간 활동">
          <section className="scrim-card">
            <div>
              <span className="training-tag">TEAM · 매주 하나 선택</span>
              <h3>스크림 또는 팀 휴식</h3>
              <p>스크림: 전술 숙련도 +4 · 케미 +3 · 컨디션 −5</p>
              <p>휴식: 주전·후보 컨디션 +20 · 멘탈에 따른 폼 회복</p>
            </div>
            <label>
              훈련 전술
              <select
                aria-label="스크림 전술"
                value={strategy}
                disabled={teamDisabled}
                onChange={(event) =>
                  setStrategy(event.target.value as typeof strategy)
                }
              >
                {team.strategyProficiencies.map((item) => (
                  <option key={item.strategy} value={item.strategy}>
                    {STRATEGIES[item.strategy]} · {item.proficiency}
                  </option>
                ))}
              </select>
            </label>
            <div className="training-team-actions">
              <button
                type="button"
                disabled={
                  teamDisabled ||
                  players.every((player) => player.condition === 0)
                }
                onClick={() => void act("team", { type: "STRATEGY", strategy })}
              >
                {period?.teamTraining.remaining === 0
                  ? "이번 주 팀 활동 완료"
                  : "스크림 진행"}
              </button>
              <button
                type="button"
                className="rest-button"
                disabled={
                  teamDisabled ||
                  !!period?.usedPlayerIds.length ||
                  players.every(
                    (player) => player.condition >= 100 && player.form >= 100,
                  )
                }
                onClick={() => void act("team", { type: "REST" })}
              >
                팀 전체 휴식
              </button>
            </div>
            {!!period?.usedPlayerIds.length && !period.teamRested && (
              <p>개인 훈련을 진행한 주에는 팀 휴식을 선택할 수 없습니다.</p>
            )}
          </section>
          <section className="management-mastery">
            <h3>전술 숙련도</h3>
            <p>
              팀 케미스트리 <strong>{team.chemistry}</strong>
            </p>
            {team.strategyProficiencies.map((item) => (
              <label key={item.strategy}>
                <span>
                  {STRATEGIES[item.strategy] ?? item.strategy}
                  <b>{item.proficiency}</b>
                </span>
                <progress max={100} value={item.proficiency} />
              </label>
            ))}
          </section>
        </aside>
      </div>
      {rosterUncertain && (
        <p className="training-error" role="alert">
          선수단 상태를 확인하지 못했습니다. 화면을 다시 열어 최신 배치를 불러와
          주세요.
        </p>
      )}
      {!!latestTeamActivity?.playerEffects?.length && (
        <section
          className="training-recovery-results"
          aria-label="팀 활동 결과"
        >
          <h4>
            {latestTeamActivity.type === "REST"
              ? "이번 주 휴식 회복 결과"
              : "이번 주 스크림 결과"}
          </h4>
          {latestTeamActivity.playerEffects.map((effect) => (
            <p key={effect.careerPlayerId}>
              <strong>
                {players.find((player) => player.id === effect.careerPlayerId)
                  ?.playerCard.player.nickname ?? "선수"}
              </strong>
              <span>
                컨디션 {effect.conditionBefore} → {effect.conditionAfter} (
                {signed(effect.conditionDelta)})
              </span>
              <span>
                폼 {effect.formBefore} → {effect.formAfter} (
                {signed(effect.formDelta)})
              </span>
            </p>
          ))}
        </section>
      )}
      <dialog
        className="player-training-dialog"
        ref={dialog}
        aria-labelledby="player-training-title"
        onCancel={(event) => {
          event.preventDefault();
          closePlayer();
        }}
        onClose={() => setSelectedId(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePlayer();
        }}
      >
        {selectedPlayer && (
          <div className="player-training-content">
            <div className="training-section-heading">
              <div>
                <span className="training-tag">INDIVIDUAL DEVELOPMENT</span>
                <h2 id="player-training-title">
                  {selectedPlayer.playerCard.player.nickname} · 개인 훈련
                </h2>
              </div>
              <button
                type="button"
                onClick={closePlayer}
                aria-label="훈련 창 닫기"
              >
                닫기
              </button>
            </div>
            <p>준비 기간 한정 · 선수마다 주 1회</p>
            <p className="management-live-overall">
              {selectedPosition
                ? `${POSITION_LABELS[selectedPosition]} 배치 기준`
                : "기본 능력치"}{" "}
              · OVR{" "}
              <strong
                className="live-position-number"
                key={positionDisplayOverall(
                  playerForPositionDisplay(selectedPlayer, selectedPosition),
                )}
              >
                {positionDisplayOverall(
                  playerForPositionDisplay(selectedPlayer, selectedPosition),
                )}
              </strong>
            </p>
            <p className="training-help">
              능력치 0~2 성장 · 컨디션 소모. 팀 휴식과 개인 훈련은 같은 주에
              병행할 수 없습니다.
            </p>
            <p className="training-help">
              폼은 실제 경기 출전으로 가장 크게 오르며 경기력·멘탈의 영향을
              받습니다. 시간 경과는 낮은 폼을 50까지만 천천히 회복시킵니다.
              컨디션은 휴식으로만 회복됩니다.
            </p>
            <div className="training-players">
              {[selectedPlayer].map((player) => {
                const displayPlayer = playerForPositionDisplay(
                  player,
                  selectedPosition,
                );
                const choice = trainingChoice(player);
                const adaptation = adaptationPosition(player);
                const target = trainingTarget(player, choice);
                const used = period?.usedPlayerIds.includes(player.id);
                return (
                  <article className="training-player" key={player.id}>
                    <button
                      className="training-player-name"
                      type="button"
                      onClick={() => {
                        closePlayer();
                        onOpenPlayer(player);
                      }}
                    >
                      <small>{player.currentPosition}</small>
                      <strong>{player.playerCard.player.nickname}</strong>
                      <span>선수 상세 보기 →</span>
                    </button>
                    <div className="training-condition">
                      <span>컨디션 {player.condition}</span>
                      <progress
                        aria-label={`${player.playerCard.player.nickname} 컨디션`}
                        max={100}
                        value={player.condition}
                      />
                      <span>폼 {player.form}</span>
                      <progress
                        aria-label={`${player.playerCard.player.nickname} 폼`}
                        max={100}
                        value={player.form}
                      />
                      <small>회복 멘탈 {player.currentMental}</small>
                    </div>
                    <div className="management-training-options">
                      <select
                        aria-label={`${player.playerCard.player.nickname} 훈련 능력치`}
                        value={choice}
                        disabled={disabled || used}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [player.id]: event.target.value,
                          }))
                        }
                      >
                        {STATS.map(([value, label, field]) => (
                          <option key={value} value={value}>
                            {label} · {displayPlayer[field]}
                          </option>
                        ))}
                        {adaptation && (
                          <option value={`POSITION:${adaptation}`}>
                            {POSITION_LABELS[adaptation]} 포지션 적응 ·{" "}
                            {positionFit(player, adaptation).proficiency}
                          </option>
                        )}
                      </select>
                      <div className="management-stat-grid">
                        {STATS.map(([value, label, field]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={choice === value}
                            disabled={disabled || used}
                            onClick={() =>
                              setChoices((current) => ({
                                ...current,
                                [player.id]: value,
                              }))
                            }
                          >
                            <span>{label}</span>
                            <strong
                              className={`live-position-number${displayPlayer[field] < player[field] ? " is-reduced" : ""}`}
                              key={displayPlayer[field]}
                            >
                              {displayPlayer[field]}
                            </strong>
                          </button>
                        ))}
                      </div>
                      {adaptation && (
                        <>
                          <p>
                            현재 배치된 {POSITION_LABELS[adaptation]} 적응 훈련
                            · 기본 능력치 훈련과 주간 횟수를 공유합니다.
                          </p>
                          <div className="management-stat-grid">
                            <button
                              type="button"
                              disabled={disabled || used}
                              aria-pressed={choice === `POSITION:${adaptation}`}
                              onClick={() =>
                                setChoices((current) => ({
                                  ...current,
                                  [player.id]: `POSITION:${adaptation}`,
                                }))
                              }
                            >
                              <span>{POSITION_LABELS[adaptation]} 적응</span>
                              <strong>
                                {positionFit(player, adaptation).proficiency}
                              </strong>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="training-player-actions">
                      <button
                        type="button"
                        disabled={
                          disabled ||
                          used ||
                          player.condition === 0 ||
                          target.value >= target.max
                        }
                        onClick={() => {
                          if (!trainingReason(player))
                            void act("individual", {
                              ...target.body,
                              careerPlayerId: player.id,
                            });
                        }}
                      >
                        {used ? "이번 주 완료" : "훈련"}
                      </button>
                    </div>
                    <p className="management-training-explanation">
                      {trainingReason(player) ||
                        `훈련 대상 원본 ${target.label} ${target.value} → 최대 ${Math.min(target.max, target.value + 2)} · 컨디션 소모 (성장량 0~2)`}
                    </p>
                  </article>
                );
              })}
            </div>
            <section className="management-position-controls">
              <h3>선발 포지션 배치</h3>
              <p>
                주 포지션 {POSITION_LABELS[selectedPlayer.currentPosition]} ·
                드래그 대신 여기서도 변경할 수 있습니다.
              </p>
              <label>
                이동할 자리
                <select
                  aria-label="이동할 선발 포지션"
                  value={movePosition}
                  disabled={busy || rosterUncertain}
                  onChange={(event) =>
                    setMovePosition(event.target.value as Position)
                  }
                >
                  {POSITIONS.map((position) => (
                    <option key={position} value={position}>
                      {POSITION_LABELS[position]} · 적응{" "}
                      {positionFit(selectedPlayer, position).proficiency}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {POSITION_LABELS[movePosition]} 배치 시 OVR{" "}
                {positionDisplayOverall(
                  playerForPositionDisplay(selectedPlayer, movePosition),
                )}
                . 적응도 100이면 원래 능력치를 표시합니다. 폼·컨디션·전술 보정은
                별도입니다.
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  rosterUncertain ||
                  team.starters.some(
                    (slot) =>
                      slot.careerPlayer.id === selectedId &&
                      slot.starterPosition === movePosition,
                  )
                }
                onClick={() => void movePlayer(selectedPlayer.id, movePosition)}
              >
                {POSITION_LABELS[movePosition]} 선발로 배치
              </button>
            </section>
            {error && (
              <p className="training-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="training-message" role="status">
                {message}
              </p>
            )}
          </div>
        )}
      </dialog>
      {!!period?.sessions.length && (
        <details className="training-log">
          <summary>이번 주 활동 기록 ({period.sessions.length})</summary>
          {period.sessions.map((session) => (
            <p key={session.id}>
              {session.careerPlayerId === null
                ? "팀 활동"
                : (players.find(
                    (player) => player.id === session.careerPlayerId,
                  )?.playerCard.player.nickname ?? "선수")}{" "}
              ·{" "}
              {session.type === "REST"
                ? "휴식"
                : `${session.type === "POSITION" ? "포지션 적응" : (STATS.find((stat) => stat[0] === session.type)?.[1] ?? "전술 숙련도")} +${session.resultDelta}`}
              {session.conditionDelta !== null && session.type !== "REST"
                ? ` / 컨디션 ${session.conditionDelta}`
                : ""}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
