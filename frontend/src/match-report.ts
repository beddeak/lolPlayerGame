import type { MatchSeries, Position } from "./types";

export function orderedGames(series: MatchSeries) {
  return [...series.games].sort(
    (a, b) =>
      (a.seriesGameNumber ?? a.matchId) - (b.seriesGameNumber ?? b.matchId),
  );
}

export interface PlayerStateChange {
  careerPlayerId: number;
  teamId: number;
  position: Position;
  gamesPlayed: number;
  formBefore: number | null;
  formAfter: number | null;
  conditionBefore: number | null;
  conditionAfter: number | null;
}
const snapshot = (value: number) => (Number.isFinite(value) ? value : null);

/** First appearance -> final appearance. Never substitute today's live roster state. */
export function seriesPlayerChanges(series: MatchSeries): PlayerStateChange[] {
  const changes = new Map<string, PlayerStateChange>();
  for (const game of orderedGames(series)) {
    for (const team of game.teams) {
      for (const player of team.playerStats) {
        const key = `${team.teamId}:${player.careerPlayerId}`;
        const change = changes.get(key) ?? {
          careerPlayerId: player.careerPlayerId,
          teamId: team.teamId,
          position: player.position,
          gamesPlayed: 0,
          formBefore: snapshot(player.form),
          conditionBefore: snapshot(player.condition),
          formAfter: null,
          conditionAfter: null,
        };
        change.gamesPlayed++;
        change.formAfter = snapshot(player.formAfter);
        change.conditionAfter = snapshot(player.conditionAfter);
        changes.set(key, change);
      }
    }
  }
  return [...changes.values()];
}
