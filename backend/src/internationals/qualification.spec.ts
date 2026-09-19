import { qualifyInternational, tournamentFinalists } from './qualification';
import {
  availableGames,
  createTournament,
  recordResult,
} from './tournament-engine';
import {
  INTERNATIONAL_REGIONS,
  InternationalKind,
  TournamentState,
} from './tournament.types';

const results = INTERNATIONAL_REGIONS.map((region, index) => ({
  region,
  ranking: Array.from({ length: 8 }, (_, seed) => index * 10 + seed + 1),
  playoffTeamIds: Array.from({ length: 6 }, (_, seed) => index * 10 + seed + 1),
}));
function finish(state: TournamentState, preferredRegion?: string) {
  while (!state.champion) {
    const game = availableGames(state)[0];
    const winner =
      state.entrants.find((entry) => entry.teamId === game.teamBId)!.region ===
      preferredRegion
        ? game.teamBId
        : game.teamAId;
    state = recordResult(state, game.key, winner);
  }
  return state;
}
describe('international qualification', () => {
  it('never scales down missing regional data or invents previous tournament results', () => {
    expect(
      qualifyInternational(
        InternationalKind.FIRST_STAND,
        results.slice(0, 4),
        null,
      ).entrants,
    ).toBeNull();
    expect(
      qualifyInternational(InternationalKind.MSI, results, null).entrants,
    ).toBeNull();
    expect(
      qualifyInternational(InternationalKind.WORLDS, results, null).entrants,
    ).toBeNull();
  });
  it.each(INTERNATIONAL_REGIONS)(
    'builds 8 → 11 → 19, with correct play-in sizes after %s wins',
    (region) => {
      const fstEntries = qualifyInternational(
        InternationalKind.FIRST_STAND,
        results,
        null,
      ).entrants!;
      expect(fstEntries).toHaveLength(8);
      const fst = finish(
        createTournament(InternationalKind.FIRST_STAND, 2026, fstEntries),
        region,
      );
      const msiEntries = qualifyInternational(
        InternationalKind.MSI,
        results,
        fst,
      ).entrants!;
      expect(msiEntries).toHaveLength(11);
      expect(
        msiEntries.filter((entry) => entry.entry === 'PLAY_IN'),
      ).toHaveLength(4);
      const msi = finish(
        createTournament(InternationalKind.MSI, 2026, msiEntries),
        region,
      );
      const worlds = qualifyInternational(
        InternationalKind.WORLDS,
        results,
        msi,
      ).entrants!;
      expect(worlds).toHaveLength(19);
      expect(new Set(worlds.map((entry) => entry.teamId)).size).toBe(19);
      for (const league of INTERNATIONAL_REGIONS)
        expect(
          worlds.filter((entry) => entry.region === league).length,
        ).toBeLessThanOrEqual(league === 'CBLOL' ? 3 : 4);
      expect(worlds.filter((entry) => entry.entry === 'PLAY_IN')).toHaveLength(
        4,
      );
      expect(
        worlds
          .filter((entry) => entry.region === region)
          .every((entry) => entry.entry === 'MAIN'),
      ).toBe(true);
      const champion = tournamentFinalists(msi)![0];
      const lowerRank = results.map((result) =>
        result.region === champion.region
          ? {
              ...result,
              ranking: [
                ...result.ranking.filter((id) => id !== champion.teamId),
                champion.teamId,
              ],
            }
          : result,
      );
      expect(
        qualifyInternational(
          InternationalKind.WORLDS,
          lowerRank,
          msi,
        ).entrants!.some((entry) => entry.teamId === champion.teamId),
      ).toBe(true);
      const missedPlayoffs = lowerRank.map((result) => ({
        ...result,
        playoffTeamIds: result.playoffTeamIds.filter(
          (id) => id !== champion.teamId,
        ),
      }));
      expect(
        qualifyInternational(
          InternationalKind.WORLDS,
          missedPlayoffs,
          msi,
        ).entrants!.some((entry) => entry.teamId === champion.teamId),
      ).toBe(false);
    },
  );
  it('rejects duplicated team identities', () => {
    expect(
      qualifyInternational(
        InternationalKind.FIRST_STAND,
        results.map((row) => ({ ...row, ranking: [1, 2] })),
        null,
      ).reasons,
    ).toContain('지역 진출팀에 중복 구단이 있습니다.');
  });
});
