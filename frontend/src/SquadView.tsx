import { useState } from "react";
import type {
  Career,
  CareerPlayer,
  CareerRoster,
  PlayerCard,
  Position,
} from "./types";

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

interface SquadViewProps {
  career: Career;
  onBack: () => void;
  onSwapStarter: (
    teamId: number,
    position: Position,
    benchCareerPlayerId: number,
  ) => Promise<void>;
}

export default function SquadView({
  career,
  onBack,
  onSwapStarter,
}: SquadViewProps) {
  const managedTeam =
    career.teams.find((team) => team.isUserControlled) ?? career.teams[0];
  const [selectedTeamId, setSelectedTeamId] = useState(
    managedTeam?.id ?? career.teams[0]?.id,
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    managedTeam?.starters[0]?.careerPlayer.id ?? 0,
  );
  const [swapPosition, setSwapPosition] = useState<Position>("TOP");
  const [swapMessage, setSwapMessage] = useState("");
  const [swapError, setSwapError] = useState("");
  const [swapping, setSwapping] = useState(false);
  const selectedTeam =
    career.teams.find((team) => team.id === selectedTeamId) ?? managedTeam;

  if (!selectedTeam) return null;

  const allRosters = [
    ...selectedTeam.starters,
    ...(selectedTeam.benches ?? []),
  ];
  const selectedRoster =
    allRosters.find((roster) => roster.careerPlayer.id === selectedPlayerId) ??
    selectedTeam.starters[0] ??
    selectedTeam.benches?.[0];

  function changeTeam(teamId: number) {
    setSelectedTeamId(teamId);
    const nextTeam = career.teams.find((team) => team.id === teamId);
    setSelectedPlayerId(
      nextTeam?.starters[0]?.careerPlayer.id ??
        nextTeam?.benches?.[0]?.careerPlayer.id ??
        0,
    );
    setSwapMessage("");
    setSwapError("");
  }

  function selectRoster(roster: CareerRoster) {
    setSelectedPlayerId(roster.careerPlayer.id);
    setSwapPosition(roster.careerPlayer.currentPosition);
    setSwapMessage("");
    setSwapError("");
  }

  async function submitSwap() {
    if (!selectedRoster || selectedRoster.role !== "BENCH") return;

    setSwapping(true);
    setSwapMessage("");
    setSwapError("");

    try {
      await onSwapStarter(
        selectedTeam.id,
        swapPosition,
        selectedRoster.careerPlayer.id,
      );
      setSwapMessage(
        `${selectedRoster.careerPlayer.playerCard.player.nickname} 선수를 ${POSITION_LABELS[swapPosition]} 선발로 등록했습니다.`,
      );
    } catch (error) {
      setSwapError(
        error instanceof Error
          ? error.message
          : "선발 교체를 처리하지 못했습니다.",
      );
    } finally {
      setSwapping(false);
    }
  }

  return (
    <section className="squad-page">
      <header className="squad-page-header">
        <button className="back-button" type="button" onClick={onBack}>
          ← 구단 홈
        </button>
        <div>
          <p className="eyebrow">SQUAD HUB</p>
          <h1>선수단</h1>
          <p>
            {selectedTeam.name} · {career.currentYear} 시즌
          </p>
        </div>
        <div className="squad-team-switcher" aria-label="팀 선택">
          {career.teams.map((team) => (
            <button
              className={team.id === selectedTeam.id ? "active" : ""}
              type="button"
              key={team.id}
              onClick={() => changeTeam(team.id)}
            >
              <strong>{team.code}</strong>
              <small>{team.name}</small>
            </button>
          ))}
        </div>
      </header>

      <div className="squad-workspace">
        <main className="squad-board">
          <div className="squad-section-heading">
            <div>
              <span>STARTING LINEUP</span>
              <h2>선발 선수</h2>
            </div>
            <p>
              선수 카드를 선택하면 우측에서 전체 능력치를 확인할 수 있습니다.
            </p>
          </div>

          <div className="starting-card-row">
            {selectedTeam.starters.map((roster, index) => (
              <SquadPlayerCard
                key={roster.id}
                roster={roster}
                imageIndex={index}
                selected={
                  selectedRoster?.careerPlayer.id === roster.careerPlayer.id
                }
                onSelect={() => selectRoster(roster)}
              />
            ))}
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
                  <SquadPlayerCard
                    key={roster.id}
                    roster={roster}
                    imageIndex={index + selectedTeam.starters.length}
                    selected={
                      selectedRoster?.careerPlayer.id === roster.careerPlayer.id
                    }
                    onSelect={() => selectRoster(roster)}
                    compact
                  />
                ))}
              </div>
            ) : (
              <div className="empty-bench">
                <span>0</span>
                <div>
                  <strong>등록된 후보 선수가 없습니다.</strong>
                  <p>
                    향후 BENCH 로스터가 등록되면 이곳에 자동으로 표시됩니다.
                  </p>
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
              ) : selectedRoster.role === "BENCH" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitSwap();
                  }}
                >
                  <div>
                    <span>LINEUP CHANGE</span>
                    <strong>선발로 교체</strong>
                    <p>
                      투입할 포지션의 현재 선발은 자동으로 후보 명단으로
                      이동합니다.
                    </p>
                  </div>
                  <label>
                    교체 포지션
                    <select
                      value={swapPosition}
                      onChange={(event) =>
                        setSwapPosition(event.target.value as Position)
                      }
                    >
                      {Object.keys(POSITION_LABELS).map((position) => {
                        const typedPosition = position as Position;
                        const currentStarter = selectedTeam.starters.find(
                          (roster) => roster.starterPosition === typedPosition,
                        );
                        return (
                          <option value={typedPosition} key={typedPosition}>
                            {POSITION_LABELS[typedPosition]} ·{" "}
                            {currentStarter?.careerPlayer.playerCard.player
                              .nickname ?? "미등록"}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <button type="submit" disabled={swapping}>
                    {swapping
                      ? "교체 처리 중..."
                      : `${POSITION_LABELS[swapPosition]} 선발로 등록`}
                  </button>
                </form>
              ) : (
                <p>
                  후보 선수 카드를 선택하면 이곳에서 선발과 교체할 수 있습니다.
                </p>
              )}
              {swapMessage && (
                <div className="swap-feedback success">{swapMessage}</div>
              )}
              {swapError && (
                <div className="swap-feedback error">{swapError}</div>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function SquadPlayerCard({
  roster,
  imageIndex,
  selected,
  onSelect,
  compact = false,
}: {
  roster: CareerRoster;
  imageIndex: number;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const player = roster.careerPlayer;
  const card = player.playerCard;

  return (
    <button
      className={`squad-player-card ${selected ? "selected" : ""} ${compact ? "compact" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${card.player.nickname} 선수 상세 보기`}
    >
      <div className="squad-card-topline">
        <div>
          <strong>{calculateOverall(player)}</strong>
          <span>OVR</span>
        </div>
        <em>{POSITION_LABELS[player.currentPosition]}</em>
      </div>
      <img src={cardImage(card, imageIndex)} alt="" />
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
  const player = roster.careerPlayer;
  const card = player.playerCard;

  return (
    <div className="squad-player-detail">
      <div className="detail-profile-header">
        <span>{roster.role === "BENCH" ? "SUBSTITUTE" : "STARTING XI"}</span>
        <strong>{POSITION_LABELS[player.currentPosition]}</strong>
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
        <img
          src={cardImage(card, player.id)}
          alt={`${card.player.nickname} 선수 카드`}
        />
      </div>

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
                  style={{ width: `${value}%` }}
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
