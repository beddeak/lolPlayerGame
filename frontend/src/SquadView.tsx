import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import ClubLogo from "./ClubLogo";
import PlayerCardArtwork from "./PlayerCardArtwork";
import { hasCardArtwork } from "./card-artwork";
import { playerForPositionDisplay } from "./position-fit";
import { REGIONS } from "./types";
import type {
  Career,
  CareerPlayer,
  CareerRoster,
  PlayerCard,
  Position,
  Region,
} from "./types";
import "./SquadView.css";

const POSITIONS: Position[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

const POSITION_LABELS: Record<Position, string> = {
  TOP: "TOP",
  JUNGLE: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUP",
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

const DETAIL_STATS = [
  ["메카닉", "currentMechanics"],
  ["게임 이해도", "currentGameSense"],
  ["라인전", "currentLaning"],
  ["한타", "currentTeamFight"],
  ["운영", "currentMacro"],
  ["팀플레이", "currentTeamPlay"],
  ["멘탈", "currentMental"],
  ["챔피언 폭", "currentChampionPool"],
] as const;

// Base abilities use 0..119; percentages such as Form keep their own scale.
const ABILITY_DISPLAY_MAX = 119;

interface SquadViewProps {
  career: Career;
  onBack: () => void;
  onSwapStarter: (
    teamId: number,
    position: Position,
    careerPlayerId: number,
  ) => Promise<void>;
}

export default function SquadView({
  career,
  onBack,
  onSwapStarter,
}: SquadViewProps) {
  const managedTeam =
    career.teams.find((team) => team.isUserControlled) ?? career.teams[0];
  const [selectedTeamId, setSelectedTeamId] = useState<number | undefined>(
    managedTeam?.id ?? career.teams[0]?.id,
  );
  const [selectedRegion, setSelectedRegion] = useState<Region>(
    managedTeam?.region ?? REGIONS[0],
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    managedTeam?.starters[0]?.careerPlayer.id ?? 0,
  );
  const [swapPosition, setSwapPosition] = useState<Position>("TOP");
  const [swapMessage, setSwapMessage] = useState("");
  const [swapError, setSwapError] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [draggedPlayerId, setDraggedPlayerId] = useState<number | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const selectionVersion = useRef(0);
  const dragSource = useRef<{ teamId: number; playerId: number } | null>(null);
  const regionTeams = career.teams.filter(
    (team) => team.region === selectedRegion,
  );
  const selectedTeam =
    regionTeams.find((team) => team.id === selectedTeamId) ?? regionTeams[0];
  const currentContext = useRef("");
  const contextKey = `${career.id}:${selectedTeam?.id ?? "none"}`;
  useLayoutEffect(() => {
    currentContext.current = contextKey;
  }, [contextKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dragSource.current = null;
    };
  }, []);

  const allRosters = selectedTeam
    ? [...selectedTeam.starters, ...(selectedTeam.benches ?? [])]
    : [];
  const selectedRoster =
    allRosters.find((roster) => roster.careerPlayer.id === selectedPlayerId) ??
    selectedTeam?.starters[0] ??
    selectedTeam?.benches?.[0];

  function clearSelectionFeedback() {
    selectionVersion.current++;
    dragSource.current = null;
    setDraggedPlayerId(null);
    setSwapMessage("");
    setSwapError("");
  }

  function changeRegion(region: Region) {
    clearSelectionFeedback();
    setSelectedRegion(region);
    const nextTeam = career.teams.find((team) => team.region === region);
    setSelectedTeamId(nextTeam?.id);
    setSelectedPlayerId(
      nextTeam?.starters[0]?.careerPlayer.id ??
        nextTeam?.benches?.[0]?.careerPlayer.id ??
        0,
    );
  }

  function changeTeam(teamId: number) {
    clearSelectionFeedback();
    setSelectedTeamId(teamId);
    const nextTeam = career.teams.find((team) => team.id === teamId);
    setSelectedPlayerId(
      nextTeam?.starters[0]?.careerPlayer.id ??
        nextTeam?.benches?.[0]?.careerPlayer.id ??
        0,
    );
  }

  function selectRoster(roster: CareerRoster) {
    clearSelectionFeedback();
    setSelectedPlayerId(roster.careerPlayer.id);
    setSwapPosition(
      roster.starterPosition ?? roster.careerPlayer.currentPosition,
    );
  }

  async function submitSwap(playerId: number, position: Position) {
    const source = allRosters.find(
      (roster) => roster.careerPlayer.id === playerId,
    );
    if (
      pending.current ||
      !selectedTeam?.isUserControlled ||
      !source ||
      source.starterPosition === position
    )
      return;
    pending.current = true;
    const context = currentContext.current;
    const selection = selectionVersion.current;
    setSwapping(true);
    setSwapMessage("");
    setSwapError("");

    try {
      await onSwapStarter(selectedTeam.id, position, playerId);
      if (
        !mounted.current ||
        currentContext.current !== context ||
        selectionVersion.current !== selection
      )
        return;
      setSwapMessage(
        `${source.careerPlayer.playerCard.player.nickname} 선수를 ${POSITION_LABELS[position]} 선발로 배치했습니다.`,
      );
    } catch (error) {
      if (
        !mounted.current ||
        currentContext.current !== context ||
        selectionVersion.current !== selection
      )
        return;
      setSwapError(
        error instanceof Error
          ? error.message
          : "선발 교체를 처리하지 못했습니다.",
      );
    } finally {
      pending.current = false;
      if (mounted.current) setSwapping(false);
    }
  }

  function startDrag(
    event: DragEvent<HTMLButtonElement>,
    roster: CareerRoster,
  ) {
    if (!selectedTeam?.isUserControlled || pending.current) {
      event.preventDefault();
      return;
    }
    dragSource.current = {
      teamId: selectedTeam.id,
      playerId: roster.careerPlayer.id,
    };
    setDraggedPlayerId(roster.careerPlayer.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(roster.careerPlayer.id));
  }

  function endDrag() {
    dragSource.current = null;
    setDraggedPlayerId(null);
  }

  function draggedRoster() {
    if (
      !selectedTeam?.isUserControlled ||
      pending.current ||
      dragSource.current?.teamId !== selectedTeam.id
    )
      return undefined;
    return allRosters.find(
      (roster) => roster.careerPlayer.id === dragSource.current?.playerId,
    );
  }

  function allowDrop(event: DragEvent<HTMLDivElement>, benchTarget = false) {
    const source = draggedRoster();
    if (!source || (benchTarget && !source.starterPosition)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function dropOnPosition(
    event: DragEvent<HTMLDivElement>,
    position: Position,
  ) {
    event.preventDefault();
    const source = draggedRoster();
    endDrag();
    if (source) void submitSwap(source.careerPlayer.id, position);
  }

  function dropOnBench(event: DragEvent<HTMLDivElement>, bench: CareerRoster) {
    event.preventDefault();
    const source = draggedRoster();
    endDrag();
    // Reverse drop: the bench player fills the dragged starter's assigned slot.
    if (source?.starterPosition)
      void submitSwap(bench.careerPlayer.id, source.starterPosition);
  }

  return (
    <section className="squad-page squad-page--league" aria-busy={swapping}>
      <header className="squad-page-header">
        <button className="back-button" type="button" onClick={onBack}>
          ← 구단 홈
        </button>
        <div className="squad-page-title">
          <p className="eyebrow">SQUAD HUB</p>
          <h1>선수단</h1>
          <p>
            {selectedRegion} · {career.currentYear} 시즌
          </p>
        </div>
      </header>

      <section className="squad-club-navigation" aria-label="리그와 구단 선택">
        <div className="squad-league-switcher" aria-label="리그 선택">
          {REGIONS.map((region) => (
            <button
              type="button"
              key={region}
              className={`squad-league-banner league-${region.toLowerCase()}`}
              aria-pressed={selectedRegion === region}
              onClick={() => changeRegion(region)}
            >
              <img
                className="squad-league-logo"
                src={`/league-logos/${region.toLowerCase()}.png`}
                alt=""
                draggable={false}
              />
              <span className="squad-league-banner-copy">
                <small>LEAGUE</small>
                <strong>{region}</strong>
                <span>
                  {career.teams.filter((team) => team.region === region).length}
                  개 구단
                </span>
              </span>
              <span className="squad-league-banner-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
        <div
          className="squad-team-switcher"
          aria-label={`${selectedRegion} 구단 선택`}
        >
          {regionTeams.map((team) => (
            <button
              className={team.id === selectedTeam?.id ? "active" : ""}
              type="button"
              key={team.id}
              aria-pressed={team.id === selectedTeam?.id}
              onClick={() => changeTeam(team.id)}
            >
              <ClubLogo club={team} className="club-logo--small" />
              <strong>{team.code}</strong>
              <small>{team.name}</small>
            </button>
          ))}
        </div>
      </section>

      {!selectedTeam ? (
        <div className="squad-empty-region" role="status">
          <h2>{selectedRegion} 구단이 아직 없습니다.</h2>
          <p>
            현재 세이브에 등록된 구단이 없습니다. 다른 리그를 선택해 주세요.
          </p>
        </div>
      ) : (
        <>
          <div className="squad-selected-club">
            <ClubLogo club={selectedTeam} className="club-logo--small" />
            <div>
              <h2>{selectedTeam.name}</h2>
              <p>
                {selectedTeam.isUserControlled
                  ? "내 구단 · 카드를 드래그해 선발과 후보를 교체하세요."
                  : "다른 구단 · 선수단 확인만 가능합니다."}
              </p>
            </div>
          </div>
          <div className="squad-workspace">
            <main className="squad-board">
              <div className="squad-section-heading">
                <div>
                  <span>STARTING LINEUP</span>
                  <h2>선발 선수</h2>
                </div>
                <p>
                  선수 카드를 선택하면 우측에서 전체 능력치를 확인할 수
                  있습니다.
                </p>
              </div>

              <div className="squad-starting-scroll">
                <div className="starting-card-row" aria-label="선발 5명">
                  {POSITIONS.map((position, index) => {
                    const roster = selectedTeam.starters.find(
                      (slot) => slot.starterPosition === position,
                    );
                    return (
                      <div
                        key={position}
                        className={`squad-drop-slot${draggedPlayerId !== null ? " is-drag-active" : ""}`}
                        aria-label={`${POSITION_LABELS[position]} 선발 자리`}
                        onDragOver={(event) => allowDrop(event)}
                        onDrop={(event) => dropOnPosition(event, position)}
                      >
                        {roster ? (
                          <SquadPlayerCard
                            roster={roster}
                            imageIndex={index}
                            selected={
                              selectedRoster?.careerPlayer.id ===
                              roster.careerPlayer.id
                            }
                            onSelect={() => selectRoster(roster)}
                            draggable={
                              selectedTeam.isUserControlled && !swapping
                            }
                            onDragStart={(event) => startDrag(event, roster)}
                            onDragEnd={endDrag}
                          />
                        ) : (
                          <div className="squad-vacant-slot">
                            <strong>{POSITION_LABELS[position]}</strong>
                            <span>선발 미등록</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <section className="bench-section">
                <div className="squad-section-heading bench-heading">
                  <div>
                    <span>SUBSTITUTES</span>
                    <h2>후보 선수</h2>
                  </div>
                  <strong>{selectedTeam.benches?.length ?? 0}명</strong>
                </div>

                {(selectedTeam.benches?.length ?? 0) > 0 ? (
                  <div className="bench-card-row">
                    {selectedTeam.benches.map((roster, index) => (
                      <div
                        key={roster.id}
                        className={`squad-drop-slot squad-bench-slot${draggedPlayerId !== null ? " is-drag-active" : ""}`}
                        aria-label={`${roster.careerPlayer.playerCard.player.nickname} 후보 자리`}
                        onDragOver={(event) => allowDrop(event, true)}
                        onDrop={(event) => dropOnBench(event, roster)}
                      >
                        <SquadPlayerCard
                          roster={roster}
                          imageIndex={index + selectedTeam.starters.length}
                          selected={
                            selectedRoster?.careerPlayer.id ===
                            roster.careerPlayer.id
                          }
                          onSelect={() => selectRoster(roster)}
                          draggable={selectedTeam.isUserControlled && !swapping}
                          onDragStart={(event) => startDrag(event, roster)}
                          onDragEnd={endDrag}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-bench">
                    <span>0</span>
                    <div>
                      <strong>등록된 후보 선수가 없습니다.</strong>
                      <p>구단에 후보가 합류하면 이곳에 표시됩니다.</p>
                    </div>
                  </div>
                )}
              </section>
            </main>

            <aside className="squad-detail-panel">
              {selectedRoster ? (
                <SquadPlayerDetail roster={selectedRoster} />
              ) : (
                <p>선수를 선택하세요.</p>
              )}
              {selectedRoster && (
                <div className="squad-roster-action">
                  {!selectedTeam.isUserControlled ? (
                    <p>상대 구단 선수단은 확인만 할 수 있습니다.</p>
                  ) : (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitSwap(
                          selectedRoster.careerPlayer.id,
                          swapPosition,
                        );
                      }}
                    >
                      <div>
                        <span>LINEUP CHANGE</span>
                        <strong>선발 포지션 배치</strong>
                        <p>
                          드래그 대신 선택한 선수의 자리를 여기서 바꿀 수
                          있습니다. 선발끼리는 자리를 맞바꾸고, 후보를 투입하면
                          기존 선발이 벤치로 이동합니다.
                        </p>
                      </div>
                      <label>
                        이동할 자리
                        <select
                          aria-label="선수단 선발 배치 포지션"
                          value={swapPosition}
                          disabled={swapping}
                          onChange={(event) =>
                            setSwapPosition(event.target.value as Position)
                          }
                        >
                          {POSITIONS.map((position) => {
                            const starter = selectedTeam.starters.find(
                              (slot) => slot.starterPosition === position,
                            );
                            return (
                              <option key={position} value={position}>
                                {POSITION_LABELS[position]} ·{" "}
                                {starter?.careerPlayer.playerCard.player
                                  .nickname ?? "미등록"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={
                          swapping ||
                          selectedRoster.starterPosition === swapPosition
                        }
                      >
                        {swapping
                          ? "배치 저장 중…"
                          : `${POSITION_LABELS[swapPosition]} 선발로 배치`}
                      </button>
                    </form>
                  )}
                  {swapMessage && (
                    <div className="swap-feedback success" role="status">
                      {swapMessage}
                    </div>
                  )}
                  {swapError && (
                    <div className="swap-feedback error" role="alert">
                      {swapError}
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

function SquadPlayerCard({
  roster,
  imageIndex,
  selected,
  onSelect,
  draggable,
  onDragStart,
  onDragEnd,
  compact = false,
}: {
  roster: CareerRoster;
  imageIndex: number;
  selected: boolean;
  onSelect: () => void;
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  compact?: boolean;
}) {
  const player = playerForPositionDisplay(
    roster.careerPlayer,
    roster.starterPosition,
  );
  const card = player.playerCard;

  return (
    <button
      className={`squad-player-card ${selected ? "selected" : ""} ${compact ? "compact" : ""}`}
      type="button"
      onClick={onSelect}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-pressed={selected}
      aria-label={`${card.player.nickname} 선수 상세 보기`}
    >
      <div className="squad-card-topline">
        <div>
          <strong>{calculateOverall(player)}</strong>
          <span>OVR</span>
        </div>
        <em>
          {POSITION_LABELS[roster.starterPosition ?? player.currentPosition]}
        </em>
      </div>
      {hasCardArtwork(card) ? (
        <PlayerCardArtwork card={card} player={player} />
      ) : (
        <img src={cardImage(card, imageIndex)} alt="" draggable={false} />
      )}
      <div className="squad-card-name">
        <strong>{card.player.nickname}</strong>
        <span>{card.player.nationality}</span>
      </div>
      <div className="squad-card-mini-stats">
        <span>
          LAN <strong>{player.currentLaning}</strong>
        </span>
        <span>
          FIGHT <strong>{player.currentTeamFight}</strong>
        </span>
      </div>
    </button>
  );
}

function SquadPlayerDetail({ roster }: { roster: CareerRoster }) {
  const player = playerForPositionDisplay(
    roster.careerPlayer,
    roster.starterPosition,
  );
  const card = player.playerCard;

  return (
    <div className="squad-player-detail">
      <div className="detail-profile-header">
        <span>{roster.role === "BENCH" ? "SUBSTITUTE" : "STARTING FIVE"}</span>
        <strong>
          {POSITION_LABELS[roster.starterPosition ?? player.currentPosition]}
        </strong>
      </div>
      <div className="detail-player-identity">
        <div className="detail-overall">
          <small>OVR</small>
          <strong>{calculateOverall(player)}</strong>
        </div>
        <div>
          <h2>{card.player.nickname}</h2>
          <p>
            {card.player.nationality} · AGE {player.currentAge}
          </p>
        </div>
      </div>
      <div className="detail-card-preview">
        {hasCardArtwork(card) ? (
          <PlayerCardArtwork card={card} player={player} />
        ) : (
          <img
            src={cardImage(card, player.id)}
            alt={`${card.player.nickname} 선수 카드`}
          />
        )}
      </div>

      {roster.starterPosition && (
        <p className="squad-position-context">
          {POSITION_LABELS[roster.starterPosition]} 배치 기준 OVR·능력치
        </p>
      )}
      <dl className="squad-detail-meta">
        <div>
          <dt>테마</dt>
          <dd>{card.theme.name}</dd>
        </div>
        <div>
          <dt>성향</dt>
          <dd>{player.personality}</dd>
        </div>
        <div>
          <dt>폼</dt>
          <dd>{player.form}</dd>
        </div>
        <div>
          <dt>컨디션</dt>
          <dd>{player.condition}</dd>
        </div>
      </dl>

      <div className="squad-attribute-list">
        {DETAIL_STATS.map(([label, key]) => {
          const value = player[key];
          return (
            <div key={key}>
              <span>{label}</span>
              <i>
                <b
                  className={value >= 85 ? "elite" : value >= 75 ? "good" : ""}
                  style={{
                    width: `${(Math.max(0, Math.min(ABILITY_DISPLAY_MAX, value)) / ABILITY_DISPLAY_MAX) * 100}%`,
                  }}
                />
              </i>
              <strong>{value}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function calculateOverall(player: CareerPlayer) {
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
