import {
  availableGames,
  createTournament,
  recordResult,
  resolveSlot,
} from './tournament-engine';
import {
  Entrant,
  INTERNATIONAL_REGIONS,
  InternationalKind,
  TournamentState,
} from './tournament.types';

export function testEntrants(kind: InternationalKind): Entrant[] {
  let id = 1;
  return INTERNATIONAL_REGIONS.flatMap((region) => {
    const count =
      kind === InternationalKind.FIRST_STAND
        ? ['LCK', 'LPL'].includes(region)
          ? 2
          : 1
        : kind === InternationalKind.MSI
          ? region === 'CBLOL'
            ? 1
            : 2
          : ['LCK', 'LPL'].includes(region)
            ? 4
            : region === 'CBLOL'
              ? 2
              : 3;
    return Array.from({ length: count }, (_, index): Entrant => ({
      teamId: id++,
      region,
      regionalSeed: index + 1,
      entry:
        kind === InternationalKind.MSI
          ? index === 1 && region !== 'LCK'
            ? 'PLAY_IN'
            : 'MAIN'
          : kind === InternationalKind.WORLDS &&
              ['LPL', 'LEC', 'LCS', 'LCP'].includes(region) &&
              index === count - 1
            ? 'PLAY_IN'
            : 'MAIN',
    }));
  });
}

function finish(source: TournamentState, seed = 1) {
  let state = source;
  let count = 0;
  while (state.champion === null) {
    const ready = availableGames(state).sort((a, b) =>
      a.day.localeCompare(b.day),
    );
    if (!ready.length || count++ > 100) throw new Error('Tournament stalled');
    const game = ready[0];
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    state = recordResult(
      state,
      game.key,
      seed / 4294967296 < 0.5 ? game.teamAId : game.teamBId,
    );
  }
  return state;
}

describe('2026 international tournament state machine', () => {
  it.each(Object.values(InternationalKind))(
    'completes %s without duplicate fixtures, self matches or unresolved results',
    (kind) => {
      for (let seed = 1; seed <= 100; seed++) {
        const initial = createTournament(kind, 2026, testEntrants(kind));
        const done = finish(initial, seed);
        expect(initial.champion).toBeNull();
        expect(done.games.every((game) => game.winner !== null)).toBe(true);
        expect(new Set(done.games.map((game) => game.key)).size).toBe(
          done.games.length,
        );
        for (const game of done.games) {
          expect(resolveSlot(done, game.a)).not.toBe(resolveSlot(done, game.b));
          expect([
            resolveSlot(done, game.a),
            resolveSlot(done, game.b),
          ]).toContain(game.winner);
        }
      }
    },
  );
  it('runs two GSL groups into cross-group semifinals and a BO5 final', () => {
    const done = finish(
      createTournament(
        InternationalKind.FIRST_STAND,
        2026,
        testEntrants(InternationalKind.FIRST_STAND),
      ),
    );
    expect(done.games).toHaveLength(13);
    expect(done.games.every((game) => game.bestOf === 5)).toBe(true);
    expect(done.games.filter((game) => game.stage === 'GROUP_A')).toHaveLength(
      5,
    );
    expect(done.games.filter((game) => game.stage === 'GROUP_B')).toHaveLength(
      5,
    );
    const semifinal = done.games.find((game) => game.key === 'KO_1_1')!;
    expect(semifinal.a).toEqual({ match: 'GROUP_A_3', result: 'WINNER' });
    expect(semifinal.b).toEqual({ match: 'GROUP_B_5', result: 'WINNER' });
  });
  it('uses a single-qualifier MSI play-in and exact upper/lower bracket edges without a final reset', () => {
    const done = finish(
      createTournament(
        InternationalKind.MSI,
        2026,
        testEntrants(InternationalKind.MSI),
      ),
    );
    expect(done.games.filter((game) => game.stage === 'PLAY_IN')).toHaveLength(
      6,
    );
    expect(done.games.filter((game) => game.stage === 'BRACKET')).toHaveLength(
      14,
    );
    expect(done.games.at(-1)?.day).toBe('2026-07-12');
    const losses = new Map<number, number>();
    for (const game of done.games) {
      const loser = [
        resolveSlot(done, game.a)!,
        resolveSlot(done, game.b)!,
      ].find((id) => id !== game.winner)!;
      losses.set(loser, (losses.get(loser) ?? 0) + 1);
    }
    // Lower bracket runner-up may lose twice; upper bracket winner gets no extra GF life.
    expect(Math.max(...losses.values())).toBeLessThanOrEqual(3); // A play-in loss carries no penalty into main bracket.
    expect(availableGames(done)).toEqual([]);
  });
  it('runs 16-team Swiss to 2x3-0, 3x3-1, 3x3-2 with same-record/no-repeat pairings and correct series lengths', () => {
    const done = finish(
      createTournament(
        InternationalKind.WORLDS,
        2026,
        testEntrants(InternationalKind.WORLDS),
      ),
      42,
    );
    const records = new Map<number, { wins: number; losses: number }>();
    const pairs = new Set<string>();
    for (const game of done.games.filter((value) => value.stage === 'SWISS')) {
      const a = resolveSlot(done, game.a)!,
        b = resolveSlot(done, game.b)!;
      for (const id of [a, b])
        if (!records.has(id)) records.set(id, { wins: 0, losses: 0 });
      const ar = records.get(a)!,
        br = records.get(b)!;
      expect(ar).toEqual(br);
      expect(game.bestOf).toBe(ar.wins === 2 || ar.losses === 2 ? 3 : 1);
      const key = [a, b].sort((x, y) => x - y).join(':');
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
      (game.winner === a ? ar : br).wins++;
      (game.winner === a ? br : ar).losses++;
    }
    expect(records.size).toBe(16);
    for (const [losses, count] of [
      [0, 2],
      [1, 3],
      [2, 3],
    ])
      expect(
        [...records.values()].filter(
          (record) => record.wins === 3 && record.losses === losses,
        ),
      ).toHaveLength(count);
    expect(done.games.filter((game) => game.stage === 'KNOCKOUT')).toHaveLength(
      7,
    );
    expect(done.games.at(-1)?.day).toBe('2026-11-14');
  });
  it('rejects missing/duplicate entrants, unknown winners and double submissions without changing input', () => {
    const entrants = testEntrants(InternationalKind.FIRST_STAND);
    expect(() =>
      createTournament(InternationalKind.FIRST_STAND, 2026, entrants.slice(1)),
    ).toThrow();
    expect(() =>
      createTournament(InternationalKind.FIRST_STAND, 2026, [
        ...entrants.slice(1),
        entrants[1],
      ]),
    ).toThrow();
    const state = createTournament(
      InternationalKind.FIRST_STAND,
      2026,
      entrants,
    );
    expect(() => recordResult(state, 'KO_2_1', entrants[0].teamId)).toThrow();
    const game = availableGames(state)[0];
    expect(() => recordResult(state, game.key, 9999)).toThrow();
    const next = recordResult(state, game.key, game.teamAId);
    expect(() => recordResult(next, game.key, game.teamAId)).toThrow();
    expect(state.games[0].winner).toBeNull();
  });
});
