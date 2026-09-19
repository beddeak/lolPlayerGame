import {
  Entrant,
  InternationalKind,
  Slot,
  TournamentState,
} from './tournament.types';

const team = (teamId: number): Slot => ({ teamId });
const win = (match: string): Slot => ({ match, result: 'WINNER' });
const lose = (match: string): Slot => ({ match, result: 'LOSER' });

/** Declarative bracket edges prevent accidental survivor re-seeding or extra lives. */
function add(
  state: TournamentState,
  key: string,
  stage: string,
  round: number,
  day: string,
  a: Slot,
  b: Slot,
  bestOf: 1 | 3 | 5 = 5,
) {
  state.games.push({
    key,
    stage,
    round,
    day: `${state.year}-${day}`,
    a,
    b,
    bestOf,
    winner: null,
  });
}

function gsl(
  state: TournamentState,
  prefix: string,
  entrants: Slot[],
  days: string[],
  singleQualifier: boolean,
) {
  const key = (index: number) => `${prefix}_${index}`;
  add(state, key(1), prefix, 1, days[0], entrants[0], entrants[3]);
  add(state, key(2), prefix, 1, days[0], entrants[1], entrants[2]);
  add(state, key(3), prefix, 2, days[1], win(key(1)), win(key(2)));
  add(state, key(4), prefix, 2, days[1], lose(key(1)), lose(key(2)));
  add(state, key(5), prefix, 3, days[2], lose(key(3)), win(key(4)));
  if (singleQualifier) {
    add(state, key(6), prefix, 4, days[3], win(key(3)), win(key(5)));
    return [win(key(6))];
  }
  return [win(key(3)), win(key(5))];
}

function singleElimination(
  state: TournamentState,
  slots: Slot[],
  days: string[],
) {
  let round = 1;
  let current = slots;
  while (current.length > 1) {
    const next: Slot[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const key = `KO_${round}_${index / 2 + 1}`;
      // Quarterfinals span four days, semifinals two, final one.
      const day =
        slots.length === 8
          ? days[round === 1 ? index / 2 : round === 2 ? 4 + index / 2 : 6]
          : days[round - 1];
      add(
        state,
        key,
        'KNOCKOUT',
        round,
        day,
        current[index],
        current[index + 1],
      );
      next.push(win(key));
    }
    current = next;
    round++;
  }
}

function msiBracket(state: TournamentState, slots: Slot[]) {
  for (let index = 0; index < 4; index++)
    add(
      state,
      `UQ${index}`,
      'BRACKET',
      1,
      index < 2 ? '07-03' : '07-04',
      slots[index * 2],
      slots[index * 2 + 1],
    );
  add(state, 'US0', 'BRACKET', 2, '07-05', win('UQ0'), win('UQ1'));
  add(state, 'US1', 'BRACKET', 2, '07-05', win('UQ2'), win('UQ3'));
  add(state, 'L10', 'BRACKET', 2, '07-06', lose('UQ0'), lose('UQ1'));
  add(state, 'L11', 'BRACKET', 2, '07-06', lose('UQ2'), lose('UQ3'));
  add(state, 'L20', 'BRACKET', 3, '07-08', win('L10'), lose('US1'));
  add(state, 'L21', 'BRACKET', 3, '07-08', win('L11'), lose('US0'));
  add(state, 'UF', 'BRACKET', 3, '07-09', win('US0'), win('US1'));
  add(state, 'L3', 'BRACKET', 4, '07-10', win('L20'), win('L21'));
  add(state, 'LF', 'BRACKET', 5, '07-11', win('L3'), lose('UF'));
  add(state, 'GF', 'BRACKET', 6, '07-12', win('UF'), win('LF'));
}

export function resolveSlot(
  state: Pick<TournamentState, 'games'>,
  slot: Slot,
): number | null {
  if ('teamId' in slot) return slot.teamId;
  const game = state.games.find((value) => value.key === slot.match);
  if (!game?.winner) return null;
  if (slot.result === 'WINNER') return game.winner;
  const a = resolveSlot(state, game.a);
  const b = resolveSlot(state, game.b);
  return a === game.winner ? b : a;
}

export function availableGames(state: Pick<TournamentState, 'games'>) {
  return state.games.flatMap((game) => {
    if (game.winner !== null) return [];
    const teamAId = resolveSlot(state, game.a),
      teamBId = resolveSlot(state, game.b);
    return teamAId !== null && teamBId !== null
      ? [{ ...game, teamAId, teamBId }]
      : [];
  });
}

/** Initial drawing is deterministic: different seeds from one region split across groups. */
export function createTournament(
  kind: InternationalKind,
  year: number,
  entrants: Entrant[],
): TournamentState {
  const expected =
    kind === InternationalKind.FIRST_STAND
      ? 8
      : kind === InternationalKind.MSI
        ? 11
        : 19;
  if (
    entrants.length !== expected ||
    new Set(entrants.map((entry) => entry.teamId)).size !== expected
  )
    throw new Error(`${kind} requires ${expected} unique teams`);
  if (
    entrants.some(
      (entry) => !Number.isInteger(entry.teamId) || entry.teamId < 1,
    )
  )
    throw new Error('Invalid team ID');
  const state: TournamentState = {
    version: 1,
    kind,
    year,
    entrants: structuredClone(entrants),
    games: [],
    champion: null,
  };
  const ordered = [...entrants].sort(
    (a, b) =>
      a.regionalSeed - b.regionalSeed || a.region.localeCompare(b.region),
  );
  if (kind === InternationalKind.FIRST_STAND) {
    const lck = ordered.filter((entry) => entry.region === 'LCK');
    const lpl = ordered.filter((entry) => entry.region === 'LPL');
    const others = ordered.filter(
      (entry) => !['LCK', 'LPL'].includes(entry.region),
    );
    if (lck.length !== 2 || lpl.length !== 2 || others.length !== 4)
      throw new Error('Invalid First Stand regional allocation');
    const a = gsl(
      state,
      'GROUP_A',
      [lck[0], lpl[1], others[0], others[2]].map((entry) => team(entry.teamId)),
      ['03-16', '03-18', '03-20'],
      false,
    );
    const b = gsl(
      state,
      'GROUP_B',
      [lpl[0], lck[1], others[1], others[3]].map((entry) => team(entry.teamId)),
      ['03-17', '03-19', '03-20'],
      false,
    );
    singleElimination(state, [a[0], b[1], b[0], a[1]], ['03-21', '03-22']);
  } else {
    const playIn = ordered
      .filter((entry) => entry.entry === 'PLAY_IN')
      .map((entry) => team(entry.teamId));
    const direct = ordered
      .filter((entry) => entry.entry === 'MAIN')
      .map((entry) => team(entry.teamId));
    if (playIn.length !== 4 || direct.length !== expected - 4)
      throw new Error('Exactly four play-in teams are required');
    const winner = gsl(
      state,
      'PLAY_IN',
      playIn,
      kind === InternationalKind.MSI
        ? ['06-28', '06-29', '06-30', '07-01']
        : ['10-15', '10-16', '10-17', '10-18'],
      true,
    )[0];
    if (kind === InternationalKind.MSI) msiBracket(state, [...direct, winner]);
  }
  return state;
}

function swissStandings(state: TournamentState) {
  const playInWinner = resolveSlot(state, win('PLAY_IN_6'));
  const entrants = state.entrants.filter(
    (entry) => entry.entry === 'MAIN' || entry.teamId === playInWinner,
  );
  const table = new Map(
    entrants.map((entry) => [entry.teamId, { ...entry, wins: 0, losses: 0 }]),
  );
  for (const game of state.games.filter(
    (value) => value.stage === 'SWISS' && value.winner !== null,
  )) {
    const a = table.get(resolveSlot(state, game.a)!)!,
      b = table.get(resolveSlot(state, game.b)!)!;
    (game.winner === a.teamId ? a : b).wins++;
    (game.winner === a.teamId ? b : a).losses++;
  }
  return [...table.values()];
}

function pairSwiss(
  state: TournamentState,
  ids: number[],
  firstRound: boolean,
): Array<[number, number]> | null {
  if (!ids.length) return [];
  const [first, ...remaining] = ids;
  const regions = new Map(
    state.entrants.map((entry) => [entry.teamId, entry.region]),
  );
  for (let index = remaining.length - 1; index >= 0; index--) {
    const second = remaining[index];
    if (firstRound && regions.get(first) === regions.get(second)) continue;
    const repeated = state.games.some(
      (game) =>
        game.stage === 'SWISS' &&
        [resolveSlot(state, game.a), resolveSlot(state, game.b)].includes(
          first,
        ) &&
        [resolveSlot(state, game.a), resolveSlot(state, game.b)].includes(
          second,
        ),
    );
    if (repeated) continue;
    const tail = pairSwiss(
      state,
      remaining.filter((id) => id !== second),
      firstRound,
    );
    if (tail) return [[first, second], ...tail];
  }
  return null;
}

function advanceWorlds(state: TournamentState) {
  if (
    resolveSlot(state, win('PLAY_IN_6')) === null ||
    state.games.some((game) => game.stage === 'SWISS' && game.winner === null)
  )
    return;
  const table = swissStandings(state).sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      a.regionalSeed - b.regionalSeed ||
      a.teamId - b.teamId,
  );
  const qualifiers = table.filter((entry) => entry.wins === 3);
  if (qualifiers.length === 8) {
    if (!state.games.some((game) => game.stage === 'KNOCKOUT')) {
      // The two 3-0 teams face 3-2 teams on opposite bracket halves.
      singleElimination(
        state,
        [
          qualifiers[0],
          qualifiers[7],
          qualifiers[2],
          qualifiers[4],
          qualifiers[1],
          qualifiers[6],
          qualifiers[3],
          qualifiers[5],
        ].map((entry) => team(entry.teamId)),
        ['11-03', '11-04', '11-05', '11-06', '11-07', '11-08', '11-14'],
      );
    }
    return;
  }
  const round =
    Math.max(
      0,
      ...state.games
        .filter((game) => game.stage === 'SWISS')
        .map((game) => game.round),
    ) + 1;
  if (round > 5) throw new Error('Swiss failed to produce eight qualifiers');
  const dates = ['10-23', '10-24', '10-26', '10-28', '10-31'];
  const active = table.filter((entry) => entry.wins < 3 && entry.losses < 3);
  let index = 0;
  for (const record of new Set(
    active.map((entry) => `${entry.wins}:${entry.losses}`),
  )) {
    const bucket = active.filter(
      (entry) => `${entry.wins}:${entry.losses}` === record,
    );
    const pairings = pairSwiss(
      state,
      bucket.map((entry) => entry.teamId),
      round === 1,
    );
    if (!pairings) throw new Error('No valid Swiss draw without rematches');
    const bestOf = bucket[0].wins === 2 || bucket[0].losses === 2 ? 3 : 1;
    for (const [a, b] of pairings)
      add(
        state,
        `SWISS_${round}_${++index}`,
        'SWISS',
        round,
        dates[round - 1],
        team(a),
        team(b),
        bestOf,
      );
  }
}

/** Pure transition: validation happens before cloning; callers persist atomically. */
export function recordResult(
  source: TournamentState,
  key: string,
  winner: number,
): TournamentState {
  const ready = availableGames(source).find((game) => game.key === key);
  if (!ready || (winner !== ready.teamAId && winner !== ready.teamBId))
    throw new Error('Invalid or already recorded result');
  const state = structuredClone(source);
  state.games.find((game) => game.key === key)!.winner = winner;
  if (state.kind === InternationalKind.WORLDS) advanceWorlds(state);
  const final =
    state.kind === InternationalKind.MSI
      ? 'GF'
      : state.kind === InternationalKind.FIRST_STAND
        ? 'KO_2_1'
        : 'KO_3_1';
  state.champion =
    state.games.find((game) => game.key === final)?.winner ?? null;
  return state;
}
