import { LeagueSplitResponseDto } from '../leagues/dto/league-split-response.dto';
import { LeagueSplitStatus } from '../leagues/enums/league-split-status.enum';
import { Region } from '../careers/enums/region.enum';

/** Derived from persisted results: no second mutable points balance to drift. */
export function lcpQualification(
  splits: LeagueSplitResponseDto[],
  throughSplit: number,
) {
  const completed = splits
    .filter(
      (split) =>
        split.region === Region.LCP &&
        split.splitNumber <= throughSplit &&
        split.status === LeagueSplitStatus.COMPLETED,
    )
    .sort((a, b) => a.splitNumber - b.splitNumber);
  const latest = completed.find((split) => split.splitNumber === throughSplit);
  if (!latest || completed.length !== throughSplit) return null;
  const points = new Map<number, number>();
  const add = (id: number, value: number) =>
    points.set(id, (points.get(id) ?? 0) + value);
  for (const split of completed) {
    const regular = split.stages[0];
    const playoff = split.stages.find((stage) => stage.code === 'PLAYOFFS')!;
    for (const [index, row] of regular.standings.entries()) {
      if (split.splitNumber < 3)
        add(
          row.teamId,
          Math.max(0, row.gameDifference * split.splitNumber) +
            Math.max(0, 7 - index),
        );
      else
        add(
          row.teamId,
          row.seriesWins === 3
            ? [50, 40, 30][row.seriesLosses]
            : ({ 2: 15, 1: 3, 0: 0 }[row.seriesWins] ?? 0),
        );
    }
    if (split.splitNumber < 3)
      playoff.standings
        .slice(0, 4)
        .forEach((row, index) => add(row.teamId, [20, 15, 10, 5][index]));
    else {
      if (playoff.standings[2]) add(playoff.standings[2].teamId, 15);
      for (const game of regular.fixtures.filter(
        (game) => game.roundNumber === 6 && game.winnerTeamId,
      )) {
        if (
          regular.standings.find((row) => row.teamId === game.winnerTeamId)!
            .seriesLosses === 3
        )
          add(game.winnerTeamId!, 5);
      }
    }
  }
  const playoff = latest.stages.find((stage) => stage.code === 'PLAYOFFS')!;
  const finalRanking = [
    ...new Set(
      [...playoff.standings, ...latest.stages[0].standings].map(
        (row) => row.teamId,
      ),
    ),
  ];
  const byPoints = [...finalRanking].sort(
    (a, b) =>
      (points.get(b) ?? 0) - (points.get(a) ?? 0) ||
      finalRanking.indexOf(a) - finalRanking.indexOf(b),
  );
  const automatic = finalRanking.slice(0, throughSplit === 3 ? 2 : 1);
  return {
    region: 'LCP' as const,
    ranking: [...new Set([...automatic, ...byPoints])],
    playoffTeamIds: playoff.participants.map((row) => row.teamId),
    championshipPoints: Object.fromEntries(points),
  };
}
