import { useEffect, useRef, useState } from "react";
import SetAnalysis from "./SetAnalysis";
import MatchSpectator from "./MatchSpectator";
import { buildSpectatorReplay, type SpectatorReplay } from "./match-spectator";
import ClubLogo from "./ClubLogo";
import PlayerCardArtwork from "./PlayerCardArtwork";
import { hasCardArtwork } from "./card-artwork";
import { orderedGames, seriesPlayerChanges } from "./match-report";
import type { Career, CareerPlayer, QuickSimResponse } from "./types";
import "./QuickSimReport.css";

const POSITION_LABELS = {
  TOP: "TOP",
  JUNGLE: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUP",
};

export default function QuickSimReport({
  result,
  career,
  onClose,
  onNext,
  nextDisabled = false,
  closeDisabled = false,
}: {
  result: Pick<QuickSimResponse, "series">;
  career: Career;
  onClose: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  closeDisabled?: boolean;
}) {
  const { series } = result;
  const complete = series.status === "COMPLETED";
  const lastGame = series.games.at(-1);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [spectator, setSpectator] = useState<SpectatorReplay | null>(null);
  const managed = career.teams.find((team) => team.isUserControlled);
  const [teamId, setTeamId] = useState(
    series.teams.some((team) => team.teamId === managed?.id)
      ? managed!.id
      : (series.winnerTeamId ?? series.teams[0]?.teamId),
  );
  useEffect(() => {
    if (spectator) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [spectator]);

  const winner = series.teams.find(
    (team) => team.teamId === series.winnerTeamId,
  );
  const players = new Map(
    career.teams.flatMap((team) =>
      [...team.starters, ...team.benches].map(
        (slot) => [slot.careerPlayer.id, slot.careerPlayer] as const,
      ),
    ),
  );
  const playerName = (id: number) =>
    players.get(id)?.playerCard.player.nickname ?? `PLAYER ${id}`;
  const pom =
    series.status === "COMPLETED" && series.pom?.teamId === series.winnerTeamId
      ? series.pom
      : null;
  const pomPlayer = pom ? players.get(pom.careerPlayerId) : undefined;
  const changes = seriesPlayerChanges(series).filter(
    (player) => player.teamId === teamId,
  );
  const managedPlayed = series.teams.some(
    (team) => team.teamId === managed?.id,
  );
  const outcome = !complete
    ? "SET RESULT"
    : !managedPlayed
      ? "FULL TIME"
      : managed?.id === series.winnerTeamId
        ? "VICTORY"
        : "DEFEAT";

  if (spectator) return <MatchSpectator key={spectator.key} replay={spectator} onClose={() => setSpectator(null)} />;
  return (
    <dialog
      ref={dialogRef}
      className="match-result-dialog"
      aria-label="경기 결과"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          if (!closeDisabled) onClose();
      }}
    >
      <header className="result-heading">
        <div>
          <span className={`result-outcome ${outcome.toLowerCase()}`}>
            {outcome}
          </span>
          <h2>
            {complete ? "시리즈 결과" : `${series.games.length}세트 결과`}
          </h2>
          <p>
            BO{series.bestOf} · {series.games.length}세트 ·{" "}
            {(complete ? winner?.teamCode : lastGame?.winnerTeamCode) ?? "-"}{" "}
            승리
          </p>
        </div>
        <button
          type="button"
          className="result-close"
          aria-label="결과 닫기"
          autoFocus
          disabled={closeDisabled}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="result-scoreboard">
        {series.teams.map((team, index) => {
          const club = career.teams.find((value) => value.id === team.teamId);
          return (
            <div
              key={team.teamId}
              className={`result-score-team ${team.teamId === series.winnerTeamId ? "is-winner" : ""}`}
            >
              <ClubLogo club={club ?? { code: team.teamCode }} />
              <div>
                <small>
                  {!complete
                    ? "SERIES SCORE"
                    : team.teamId === series.winnerTeamId
                      ? "WINNER"
                      : "DEFEATED"}
                </small>
                <strong>{team.teamCode}</strong>
              </div>
              <b>{team.wins}</b>
              {index === 0 && (
                <span className="result-score-divider" aria-hidden="true">
                  :
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="result-content-grid">
        <div className="result-main">
          <section className="pom-spotlight" aria-label="시리즈 POM">
            <div className="pom-title">
              <span>PLAYER OF THE MATCH</span>
              <strong>POM</strong>
            </div>
            {pom ? (
              <div className="pom-showcase">
                <AwardPlayerCard
                  player={pomPlayer}
                  nickname={playerName(pom.careerPlayerId)}
                  teamCode={winner?.teamCode ?? ""}
                />
                <div className="pom-details">
                  <span className="pom-award-label">SERIES STANDOUT</span>
                  <h3>{playerName(pom.careerPlayerId)}</h3>
                  <p>
                    {winner?.teamCode} · {pom.gamesPlayed}세트 출전
                  </p>
                  <div className="pom-rating">
                    <strong>{pom.averageRating.toFixed(1)}</strong>
                    <span>시리즈 평균 평점</span>
                  </div>
                  <dl>
                    <div>
                      <dt>누적 평점</dt>
                      <dd>{pom.totalRating.toFixed(1)}</dd>
                    </div>
                    <div>
                      <dt>통합 K / D / A</dt>
                      <dd>
                        {pom.kills} / {pom.deaths} / {pom.assists}
                      </dd>
                    </div>
                    <div>
                      <dt>POG 수상</dt>
                      <dd>{pom.pogCount}회</dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : (
              <p className="result-empty">
                {complete
                  ? "POM 기록이 없습니다. 최신 서버에서 결과를 다시 확인해 주세요."
                  : "POM은 시리즈가 끝난 뒤 종합 성적으로 선정됩니다."}
              </p>
            )}
            <p className="pom-rule">
              승리 팀 · 전체 세트 누적 평점 기준. 동점 시 POG 횟수, 킬 관여 수,
              적은 데스 순.
            </p>
          </section>
          <section className="result-games" aria-label="세트별 POG">
            <h3>
              세트별 결과 <span>PLAYER OF THE GAME</span>
            </h3>
            {orderedGames(series).map((game, index) => {
              const pog =
                game.pog?.teamId === game.winnerTeamId ? game.pog : null;
              const shortReplay = game.durationMinutes < 18;
              return (
                <article key={game.matchId} className="result-game-row">
                  <div className="result-game-index">
                    <small>SET</small>
                    <strong>{game.seriesGameNumber ?? index + 1}</strong>
                  </div>
                  <div>
                    <small>WIN · {Math.round(game.durationMinutes)}분</small>
                    <strong>{game.winnerTeamCode}</strong>
                  </div>
                  <div className="result-pog">
                    <span>POG</span>
                    <strong>
                      {pog ? playerName(pog.careerPlayerId) : "기록 없음"}
                    </strong>
                    <small>
                      {pog
                        ? `${pog.kills} / ${pog.deaths} / ${pog.assists}`
                        : ""}
                    </small>
                  </div>
                  <b className="result-game-rating">
                    {pog?.rating.toFixed(1) ?? "—"}
                  </b>
                  <button className="rift-replay-button" type="button" disabled={closeDisabled || shortReplay}
                    title={shortReplay ? "18분 미만의 과거 기록은 관전 단계 모델을 지원하지 않습니다." : undefined}
                    onClick={() => setSpectator(buildSpectatorReplay(game, career))}>
                    {shortReplay ? "짧은 경기 · 결과 기록만 제공" : `${game.seriesGameNumber ?? index + 1}세트 협곡 다시보기`}
                  </button>
                </article>
              );
            })}
          </section>
        </div>
        <aside
          className="result-player-states"
          aria-label="선수 폼과 컨디션 변화"
        >
          <header>
            <span>POST-MATCH REPORT</span>
            <h3>선수 상태 변화</h3>
            <p>첫 출전 전 → 마지막 출전 후</p>
          </header>
          <div
            className="result-team-filters"
            role="group"
            aria-label="상태를 볼 구단"
          >
            {series.teams.map((team) => (
              <button
                type="button"
                key={team.teamId}
                aria-pressed={teamId === team.teamId}
                onClick={() => setTeamId(team.teamId)}
              >
                {team.teamCode}
                {team.teamId === managed?.id ? " · 내 구단" : ""}
              </button>
            ))}
          </div>
          <div className="result-state-list">
            {changes.map((player) => (
              <article key={player.careerPlayerId}>
                <div className="result-state-name">
                  <span>{POSITION_LABELS[player.position]}</span>
                  <strong>{playerName(player.careerPlayerId)}</strong>
                  <small>{player.gamesPlayed}세트</small>
                </div>
                <StateChange
                  label="폼"
                  before={player.formBefore}
                  after={player.formAfter}
                />
                <StateChange
                  label="컨디션"
                  before={player.conditionBefore}
                  after={player.conditionAfter}
                />
              </article>
            ))}
            {!changes.length && (
              <p className="result-empty">출전 기록이 없습니다.</p>
            )}
          </div>
          <p className="result-state-note">
            저장된 기본 상태 변화입니다. 다음 세트 한정 피드백 보정은 별도로
            적용되며, 미출전 후보는 제외됩니다.
          </p>
        </aside>
      </div>
      <SetAnalysis series={series} career={career} />
      <footer className="result-footer">
        {onNext && (
          <button type="button" onClick={onNext} disabled={nextDisabled}>
            {series.nextGameNumber}세트 넘어가기 →
          </button>
        )}
        <span>
          {onNext
            ? "다음 화면에서 피드백·전술·선수 교체를 준비합니다."
            : "경기 결과와 선수 상태가 저장되었습니다."}
        </span>
        <button type="button" onClick={onClose} disabled={closeDisabled}>
          시즌 허브로 돌아가기 →
        </button>
      </footer>
    </dialog>
  );
}

function StateChange({
  label,
  before,
  after,
}: {
  label: string;
  before: number | null;
  after: number | null;
}) {
  const delta =
    before === null || after === null
      ? null
      : Math.round((after - before) * 10) / 10;
  return (
    <div className="result-state-change">
      <span>{label}</span>
      <span>
        {before ?? "—"}
        <i aria-hidden="true"> → </i>
        <strong>{after ?? "—"}</strong>
      </span>
      <b
        className={
          delta === null || delta === 0
            ? "neutral"
            : delta > 0
              ? "positive"
              : "negative"
        }
      >
        {delta === null ? "기록 없음" : delta > 0 ? `+${delta}` : delta}
      </b>
    </div>
  );
}

function AwardPlayerCard({
  player,
  nickname,
  teamCode,
}: {
  player?: CareerPlayer;
  nickname: string;
  teamCode: string;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const card = player?.playerCard;
  const imageUrl = card?.imageUrl;
  const usableImage = imageUrl && imageUrl !== failedImage;
  const overall = player
    ? Math.round(
        (player.currentMechanics +
          player.currentGameSense +
          player.currentLaning +
          player.currentTeamFight +
          player.currentMacro +
          player.currentTeamPlay +
          player.currentMental +
          player.currentChampionPool) /
          8,
      )
    : null;
  if (card && usableImage && hasCardArtwork(card))
    return (
      <div
        className="pom-player-card pom-full-art"
        onErrorCapture={() => setFailedImage(imageUrl)}
      >
        <PlayerCardArtwork card={card} player={player} />
      </div>
    );
  return (
    <div className="pom-player-card" aria-label={`${nickname} POM 선수 카드`}>
      <div className="pom-card-top">
        <strong>{overall ?? "—"}</strong>
        <span>{player ? POSITION_LABELS[player.currentPosition] : "POM"}</span>
        <b>★</b>
      </div>
      <div className="pom-card-portrait">
        {usableImage ? (
          <img
            src={imageUrl}
            alt={nickname}
            onError={() => setFailedImage(imageUrl)}
          />
        ) : (
          <span>{nickname.slice(0, 2).toUpperCase()}</span>
        )}
      </div>
      <div className="pom-card-caption">
        <small>
          {card?.cardYear ?? ""} · {teamCode}
        </small>
        <strong>{nickname}</strong>
        <span>PLAYER OF THE MATCH</span>
      </div>
    </div>
  );
}
