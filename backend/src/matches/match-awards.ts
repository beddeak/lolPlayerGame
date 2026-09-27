/** Awards are derived from immutable match snapshots, never the current roster. */
interface AwardStat {
  careerPlayerId: number;
  rating: number;
  kills: number;
  deaths: number;
  assists: number;
}
interface AwardTeam {
  teamId: number;
  playerStats: AwardStat[];
}
interface AwardGame {
  winnerTeamId: number;
  teams: AwardTeam[];
}

export interface PlayerOfGame extends AwardStat {
  teamId: number;
}
export interface PlayerOfMatch {
  careerPlayerId: number;
  teamId: number;
  gamesPlayed: number;
  totalRating: number;
  averageRating: number;
  pogCount: number;
  kills: number;
  deaths: number;
  assists: number;
}

const valid = (player: AwardStat) =>
  [
    player.careerPlayerId,
    player.rating,
    player.kills,
    player.deaths,
    player.assists,
  ].every(Number.isFinite);
const round = (value: number) => Number(value.toFixed(3));
const tieBreak = (a: AwardStat, b: AwardStat) =>
  b.kills + b.assists - (a.kills + a.assists) ||
  a.deaths - b.deaths ||
  a.careerPlayerId - b.careerPlayerId;

export function selectPlayerOfGame(game: AwardGame): PlayerOfGame | null {
  const best = game.teams
    .find((team) => team.teamId === game.winnerTeamId)
    ?.playerStats.filter(valid)
    .sort((a, b) => b.rating - a.rating || tieBreak(a, b))[0];
  return best
    ? {
        careerPlayerId: best.careerPlayerId,
        teamId: game.winnerTeamId,
        rating: best.rating,
        kills: best.kills,
        deaths: best.deaths,
        assists: best.assists,
      }
    : null;
}

export function selectPlayerOfMatch(
  games: AwardGame[],
  winnerTeamId: number | null,
): PlayerOfMatch | null {
  if (winnerTeamId === null || !games.length) return null;
  const totals = new Map<number, PlayerOfMatch>();
  for (const game of games) {
    const pog = selectPlayerOfGame(game);
    // Include the eventual winning team's performances in BOTH won and lost sets.
    for (const player of game.teams.find((team) => team.teamId === winnerTeamId)
      ?.playerStats ?? []) {
      if (!valid(player)) continue;
      const total = totals.get(player.careerPlayerId) ?? {
        careerPlayerId: player.careerPlayerId,
        teamId: winnerTeamId,
        gamesPlayed: 0,
        totalRating: 0,
        averageRating: 0,
        pogCount: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
      };
      total.gamesPlayed++;
      total.totalRating = round(total.totalRating + player.rating);
      total.averageRating = round(total.totalRating / total.gamesPlayed);
      total.pogCount += pog?.careerPlayerId === player.careerPlayerId ? 1 : 0;
      total.kills += player.kills;
      total.deaths += player.deaths;
      total.assists += player.assists;
      totals.set(player.careerPlayerId, total);
    }
  }
  return (
    [...totals.values()].sort(
      (a, b) =>
        b.totalRating - a.totalRating ||
        b.pogCount - a.pogCount ||
        tieBreak(
          { ...a, rating: a.averageRating },
          { ...b, rating: b.averageRating },
        ),
    )[0] ?? null
  );
}
