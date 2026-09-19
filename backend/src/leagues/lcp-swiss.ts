import { LeagueScheduleSlot, pairingKey } from './league-schedule';

interface Result {
  roundNumber: number;
  teamAId: number;
  teamBId: number;
  winnerTeamId: number;
}
/** Eight-team Swiss needs the published cross-record pairing in round four. */
export function lcpSwissRound(
  ids: number[],
  results: Result[],
): LeagueScheduleSlot[] {
  const round = Math.max(0, ...results.map((game) => game.roundNumber)) + 1;
  if (round > 6) return [];
  const records = new Map(ids.map((id) => [id, { wins: 0, losses: 0 }]));
  const history = new Set(
    results.map((game) => pairingKey(game.teamAId, game.teamBId)),
  );
  const priorRecords = new Map(ids.map((id) => [id, { wins: 0, losses: 0 }]));
  for (const game of results) {
    const loser =
      game.winnerTeamId === game.teamAId ? game.teamBId : game.teamAId;
    records.get(game.winnerTeamId)!.wins++;
    records.get(loser)!.losses++;
    if (game.roundNumber < 3) {
      priorRecords.get(game.winnerTeamId)!.wins++;
      priorRecords.get(loser)!.losses++;
    }
  }
  let active = ids.filter(
    (id) => records.get(id)!.wins < 3 && records.get(id)!.losses < 3,
  );
  const slots: LeagueScheduleSlot[] = [];
  const add = (a: number, b: number) =>
    slots.push({
      teamAId: a,
      teamBId: b,
      roundNumber: round,
      bestOf: [a, b].some(
        (id) => records.get(id)!.wins === 2 || records.get(id)!.losses === 2,
      )
        ? 5
        : 3,
    });
  if (round === 6) {
    const ranking = [...ids].sort(
      (a, b) =>
        records.get(b)!.wins - records.get(a)!.wins ||
        records.get(a)!.losses - records.get(b)!.losses ||
        ids.indexOf(a) - ids.indexOf(b),
    );
    slots.push({
      teamAId: ranking[0],
      teamBId: ranking[1],
      roundNumber: 6,
      bestOf: 5,
    });
    for (const wins of [1, 2]) {
      const tied = ranking.filter(
        (id) => records.get(id)!.wins === wins && records.get(id)!.losses === 3,
      );
      if (tied.length === 2)
        slots.push({
          teamAId: tied[0],
          teamBId: tied[1],
          roundNumber: 6,
          bestOf: 5,
        });
    }
    return slots;
  }
  if (round === 1) {
    for (let index = 0; index < ids.length / 2; index++)
      add(ids[index], ids[ids.length - 1 - index]);
    return slots;
  }
  if (round === 4) {
    const unbeaten = results.find(
      (game) =>
        game.roundNumber === 3 &&
        priorRecords.get(game.teamAId)!.wins === 2 &&
        priorRecords.get(game.teamBId)!.wins === 2,
    );
    const winless = results.find(
      (game) =>
        game.roundNumber === 3 &&
        priorRecords.get(game.teamAId)!.losses === 2 &&
        priorRecords.get(game.teamBId)!.losses === 2,
    );
    if (!unbeaten || !winless)
      throw new Error('Incomplete LCP Swiss round three');
    const a =
      unbeaten.winnerTeamId === unbeaten.teamAId
        ? unbeaten.teamBId
        : unbeaten.teamAId;
    const b = winless.winnerTeamId;
    add(a, b);
    active = active.filter((id) => id !== a && id !== b);
  }
  const draw = (
    pool: number[],
    allowRepeat: boolean,
  ): Array<[number, number]> | null => {
    if (!pool.length) return [];
    const [first, ...rest] = pool;
    for (const opponent of [...rest].reverse()) {
      if (!allowRepeat && history.has(pairingKey(first, opponent))) continue;
      const tail = draw(
        rest.filter((id) => id !== opponent),
        allowRepeat,
      );
      if (tail) return [[first, opponent], ...tail];
    }
    return null;
  };
  const buckets = new Map<string, number[]>();
  for (const id of active) {
    const record = records.get(id)!;
    const key = `${record.wins}:${record.losses}`;
    buckets.set(key, [...(buckets.get(key) ?? []), id]);
  }
  for (const pool of buckets.values()) {
    const pairs = draw(pool, false) ?? draw(pool, true);
    if (!pairs) throw new Error('Invalid LCP Swiss record bucket');
    for (const [a, b] of pairs) add(a, b);
  }
  return slots;
}
