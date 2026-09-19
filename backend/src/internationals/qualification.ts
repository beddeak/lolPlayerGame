import {
  Entrant,
  INTERNATIONAL_REGIONS,
  InternationalKind,
  InternationalRegion,
  TournamentState,
} from './tournament.types';
import { resolveSlot } from './tournament-engine';

export interface RegionalQualification {
  region: InternationalRegion;
  /** Ordered seeds from completed, same-year regional competition. */
  ranking: number[];
  playoffTeamIds: number[];
}
export const INTERNATIONAL_WINDOWS = {
  [InternationalKind.FIRST_STAND]: {
    preparation: '03-09',
    starts: '03-16',
    ends: '03-22',
    split: 1,
    count: 8,
  },
  [InternationalKind.MSI]: {
    preparation: '06-22',
    starts: '06-28',
    ends: '07-12',
    split: 2,
    count: 11,
  },
  [InternationalKind.WORLDS]: {
    preparation: '10-08',
    starts: '10-15',
    ends: '11-14',
    split: 3,
    count: 19,
  },
} as const;

export function tournamentFinalists(
  state: TournamentState,
): [Entrant, Entrant] | null {
  if (!state.champion) return null;
  const key =
    state.kind === InternationalKind.FIRST_STAND
      ? 'KO_2_1'
      : state.kind === InternationalKind.MSI
        ? 'GF'
        : 'KO_3_1';
  const final = state.games.find((game) => game.key === key)!;
  const loser = [resolveSlot(state, final.a), resolveSlot(state, final.b)].find(
    (id) => id !== state.champion,
  )!;
  return [
    state.entrants.find((entry) => entry.teamId === state.champion)!,
    state.entrants.find((entry) => entry.teamId === loser)!,
  ];
}

export function qualifyInternational(
  kind: InternationalKind,
  results: RegionalQualification[],
  previous: TournamentState | null,
) {
  const reasons: string[] = [];
  const allocations = new Map<InternationalRegion, number>(
    INTERNATIONAL_REGIONS.map((region) => [
      region,
      kind === InternationalKind.FIRST_STAND
        ? region === 'LCK' || region === 'LPL'
          ? 2
          : 1
        : kind === InternationalKind.MSI
          ? region === 'CBLOL'
            ? 1
            : 2
          : region === 'CBLOL'
            ? 2
            : 3,
    ]),
  );
  let byeRegion: InternationalRegion | null = null;
  let champion: Entrant | null = null;
  if (kind !== InternationalKind.FIRST_STAND) {
    const expected =
      kind === InternationalKind.MSI
        ? InternationalKind.FIRST_STAND
        : InternationalKind.MSI;
    const finalists =
      previous?.kind === expected ? tournamentFinalists(previous) : null;
    if (!finalists) reasons.push(`${expected} 완료 기록이 필요합니다.`);
    else if (kind === InternationalKind.MSI) {
      // CBLOL has only one MSI seed, so its victory cannot create a nonexistent second seed.
      byeRegion = finalists.find((entry) => entry.region !== 'CBLOL')!.region;
    } else {
      champion = finalists[0];
      // The bonus belongs to the second-place REGION, not a second team
      // from the champion's region when both MSI finalists share a league.
      const lastDefeat = new Map<number, string>();
      for (const game of previous!.games.filter(
        (game) => game.winner !== null,
      )) {
        const loser = resolveSlot(previous!, {
          match: game.key,
          result: 'LOSER',
        });
        if (loser !== null && game.day > (lastDefeat.get(loser) ?? ''))
          lastDefeat.set(loser, game.day);
      }
      const secondRegion = previous!.entrants
        .filter((entry) => entry.region !== champion!.region)
        .sort(
          (a, b) =>
            (lastDefeat.get(b.teamId) ?? '').localeCompare(
              lastDefeat.get(a.teamId) ?? '',
            ) ||
            a.regionalSeed - b.regionalSeed ||
            a.teamId - b.teamId,
        )[0];
      for (const entry of [champion, secondRegion])
        allocations.set(entry.region, allocations.get(entry.region)! + 1);
    }
  }
  const entrants: Entrant[] = [];
  for (const region of INTERNATIONAL_REGIONS) {
    const result = results.find((value) => value.region === region);
    const count = allocations.get(region)!;
    if (!result || result.ranking.length < count) {
      reasons.push(
        `${region}: 완료된 지역 예선의 ${count}개 진출 시드 필요 (현재 ${result?.ranking.length ?? 0}개).`,
      );
      continue;
    }
    let ids = result.ranking.slice(0, count);
    if (
      kind === InternationalKind.WORLDS &&
      champion?.region === region &&
      result.playoffTeamIds.includes(champion.teamId) &&
      !ids.includes(champion.teamId)
    ) {
      ids = [...ids.slice(0, count - 1), champion.teamId];
    }
    ids.forEach((teamId, index) =>
      entrants.push({
        teamId,
        region,
        regionalSeed: index + 1,
        entry:
          kind === InternationalKind.MSI && index === 1 && region !== byeRegion
            ? 'PLAY_IN'
            : 'MAIN',
      }),
    );
  }
  if (new Set(entrants.map((entry) => entry.teamId)).size !== entrants.length)
    reasons.push('지역 진출팀에 중복 구단이 있습니다.');
  if (kind === InternationalKind.WORLDS && champion) {
    // Game seeding policy: each non-winning region's lowest seed; larger seed
    // numbers enter play-in first, then a stable region order resolves ties.
    const lowest = INTERNATIONAL_REGIONS.filter(
      (region) => region !== champion.region,
    )
      .flatMap((region) =>
        entrants.filter((entry) => entry.region === region).slice(-1),
      )
      .sort(
        (a, b) =>
          b.regionalSeed - a.regionalSeed ||
          INTERNATIONAL_REGIONS.indexOf(b.region) -
            INTERNATIONAL_REGIONS.indexOf(a.region),
      );
    for (const entry of lowest.slice(0, 4)) entry.entry = 'PLAY_IN';
  }
  return {
    entrants: reasons.length ? null : entrants,
    reasons,
    allocations: Object.fromEntries(allocations) as Record<
      InternationalRegion,
      number
    >,
  };
}
