import { LeagueSplitResponseDto } from '../leagues/dto/league-split-response.dto';

/** Postseason placement wins over earlier round-robin wins; keep tied eliminations tied. */
export function getManagerFinalRank(
  split: LeagueSplitResponseDto,
  teamId: number,
): number | undefined {
  const seen = new Set<number>();
  for (const stage of [...split.stages].sort(
    (a, b) => b.sequence - a.sequence,
  )) {
    const remaining = [...stage.standings]
      .filter((row) => !seen.has(row.teamId))
      .sort((a, b) => a.rank - b.rank);
    const offset = seen.size;
    let rank = offset + 1;
    let previousRank: number | undefined;
    for (const [index, row] of remaining.entries()) {
      if (row.rank !== previousRank) rank = offset + index + 1;
      if (row.teamId === teamId) return rank;
      previousRank = row.rank;
      seen.add(row.teamId);
    }
  }
  return undefined;
}
