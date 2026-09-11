import { LeagueStandingResponseDto } from './dto/league-split-response.dto';

/** Tournament placement follows elimination, not the number of series played. */
export function rankTournamentStandings(
  standings: LeagueStandingResponseDto[],
  participants: { teamId: number; seed: number }[],
  results: { roundNumber: number; loserTeamId: number }[],
  lossesToEliminate: 1 | 2,
): LeagueStandingResponseDto[] {
  const losses = new Map<number, number>();
  const eliminationRound = new Map<number, number>();
  const seeds = new Map(participants.map(({ teamId, seed }) => [teamId, seed]));

  for (const result of [...results].sort(
    (left, right) => left.roundNumber - right.roundNumber,
  )) {
    const count = (losses.get(result.loserTeamId) ?? 0) + 1;
    losses.set(result.loserTeamId, count);
    if (count === lossesToEliminate) {
      eliminationRound.set(result.loserTeamId, result.roundNumber);
    }
  }

  // Survivors are above eliminated teams. Equal elimination rounds share
  // placement; initial seed only stabilizes their display order.
  const progress = (teamId: number) =>
    eliminationRound.get(teamId) ?? Number.MAX_SAFE_INTEGER;
  let rank = 1;
  let previousProgress: number | undefined;

  return [...standings]
    .sort(
      (left, right) =>
        progress(right.teamId) - progress(left.teamId) ||
        (seeds.get(left.teamId) ?? 0) - (seeds.get(right.teamId) ?? 0),
    )
    .map((standing, index) => {
      const currentProgress = progress(standing.teamId);
      if (currentProgress !== previousProgress) {
        rank = index + 1;
        previousProgress = currentProgress;
      }
      return { ...standing, rank };
    });
}
