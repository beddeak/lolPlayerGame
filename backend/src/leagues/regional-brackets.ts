import {
  availableGames,
  resolveSlot,
} from '../internationals/tournament-engine';
import { Slot, TournamentGame } from '../internationals/tournament.types';
import { LeagueStageSettings } from './league-format.types';
import { LeagueScheduleSlot } from './league-schedule';

export type BracketResult = {
  stageFixtureNumber: number;
  winnerTeamId: number | null;
};
export function regionalBracket(
  template: NonNullable<LeagueStageSettings['bracket']>,
  ids: number[],
  results: BracketResult[],
  mixedUpper = false,
) {
  const games: TournamentGame[] = [];
  const seed = (index: number): Slot => ({ teamId: ids[index] });
  const w = (key: number): Slot => ({ match: String(key), result: 'WINNER' });
  const l = (key: number): Slot => ({ match: String(key), result: 'LOSER' });
  const add = (round: number, a: Slot, b: Slot, bestOf: 3 | 5 = 5) => {
    const number = games.length + 1;
    games.push({
      key: String(number),
      stage: template,
      round,
      day: '',
      bestOf,
      a,
      b,
      winner:
        results.find((result) => result.stageFixtureNumber === number)
          ?.winnerTeamId ?? null,
    });
  };
  if (template === 'CBLOL_PLAY_IN') {
    add(1, seed(0), seed(1), 3);
    add(1, seed(2), seed(3), 3);
    add(2, l(1), w(2));
  } else if (template === 'DOUBLE_SIX') {
    const upper = mixedUpper ? 3 : 5;
    add(1, seed(2), seed(5), upper);
    add(1, seed(3), seed(4), upper);
    add(2, seed(0), w(2), upper);
    add(2, seed(1), w(1), upper);
    add(3, l(1), l(3));
    add(3, l(2), l(4));
    add(3, w(3), w(4), upper);
    add(4, w(5), w(6));
    add(5, w(8), l(7));
    add(6, w(7), w(9));
  } else {
    let a: Slot, b: Slot, c: Slot, d: Slot;
    const offset = template === 'HYBRID_SIX' ? 2 : 0;
    if (offset) {
      // The opening 3rd–6th seeds have single elimination; top two enter double elimination.
      add(1, seed(2), seed(5));
      add(1, seed(3), seed(4));
      [a, b, c, d] = [seed(0), w(2), seed(1), w(1)];
    } else [a, b, c, d] = [seed(0), seed(3), seed(1), seed(2)];
    const r = offset ? 2 : 1;
    add(r, a, b);
    add(r, c, d);
    add(r + 1, w(offset + 1), w(offset + 2));
    add(r + 1, l(offset + 1), l(offset + 2));
    add(r + 2, l(offset + 3), w(offset + 4));
    add(r + 3, w(offset + 3), w(offset + 5));
  }
  return { games };
}

export function nextBracketSlots(bracket: {
  games: TournamentGame[];
}): LeagueScheduleSlot[] {
  const ready = availableGames(bracket);
  const round = Math.min(...ready.map((game) => game.round));
  return ready
    .filter((game) => game.round === round)
    .map((game) => ({
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      roundNumber: game.round,
      bestOf: game.bestOf,
      stageFixtureNumber: Number(game.key),
    }));
}

export function bracketRanking(
  bracket: { games: TournamentGame[] },
  ids: number[],
): number[] {
  const { games } = bracket;
  if (!games.every((game) => game.winner !== null)) return ids;
  if (games[0]?.stage === 'CBLOL_PLAY_IN')
    return [
      games[0].winner!,
      games[2].winner!,
      resolveSlot(bracket, { match: '3', result: 'LOSER' })!,
      resolveSlot(bracket, { match: '2', result: 'LOSER' })!,
    ];
  const champion = games.at(-1)!.winner!;
  const lastDefeat = new Map<number, number>();
  for (const game of games)
    lastDefeat.set(
      resolveSlot(bracket, { match: game.key, result: 'LOSER' })!,
      game.round,
    );
  return [...ids].sort((a, b) =>
    a === champion
      ? -1
      : b === champion
        ? 1
        : (lastDefeat.get(b) ?? 0) - (lastDefeat.get(a) ?? 0) ||
          ids.indexOf(a) - ids.indexOf(b),
  );
}
