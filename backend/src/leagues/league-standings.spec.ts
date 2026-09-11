import { LeagueStandingResponseDto } from './dto/league-split-response.dto';
import { rankTournamentStandings } from './league-standings';

describe('rankTournamentStandings', () => {
  const participants = Array.from({ length: 8 }, (_, index) => ({
    teamId: index + 1,
    seed: index + 1,
  }));
  const standings = participants.map(({ teamId }) => ({
    teamId,
    rank: teamId,
    teamCode: `T${teamId}`,
    teamName: `Team ${teamId}`,
    played: 0,
    seriesWins: 0,
    seriesLosses: 0,
    gameWins: 0,
    gameLosses: 0,
    gameDifference: 0,
  })) satisfies LeagueStandingResponseDto[];

  it('ranks double-elimination teams by their second loss, including a bracket reset', () => {
    // Team 2 loses round one, wins through the lower bracket, and forces
    // a final reset before Team 1 wins. Its extra wins do not make it champion.
    const results = [
      [1, 8],
      [1, 7],
      [1, 6],
      [1, 2],
      [2, 8],
      [2, 7],
      [2, 4],
      [2, 3],
      [3, 6],
      [3, 5],
      [4, 3],
      [4, 4],
      [5, 5],
      [6, 1],
      [7, 2],
    ].map(([roundNumber, loserTeamId]) => ({ roundNumber, loserTeamId }));
    const rows = standings.map((standing) => ({
      ...standing,
      seriesWins: standing.teamId === 2 ? 6 : 3,
    }));

    const result = rankTournamentStandings(rows, participants, results, 2);

    expect(result.map((row) => row.teamId)).toEqual([1, 2, 5, 3, 4, 6, 7, 8]);
    expect(result.map((row) => row.rank)).toEqual([1, 2, 3, 4, 4, 6, 7, 7]);
    expect(result[1].seriesWins).toBe(6);
    expect(rows[0].rank).toBe(1);
    expect(rows[7].rank).toBe(8);
  });

  it('keeps a once-defeated double-elimination team above eliminated teams', () => {
    const result = rankTournamentStandings(
      standings.slice(0, 3),
      participants.slice(0, 3),
      [
        { roundNumber: 1, loserTeamId: 1 },
        { roundNumber: 1, loserTeamId: 3 },
        { roundNumber: 2, loserTeamId: 3 },
      ],
      2,
    );

    expect(result.map((row) => [row.teamId, row.rank])).toEqual([
      [1, 1],
      [2, 1],
      [3, 3],
    ]);
  });

  it('gives same-round single-elimination exits a shared placement', () => {
    const result = rankTournamentStandings(
      standings.slice(0, 4),
      participants.slice(0, 4),
      [
        { roundNumber: 2, loserTeamId: 2 },
        { roundNumber: 1, loserTeamId: 3 },
        { roundNumber: 1, loserTeamId: 4 },
      ],
      1,
    );

    expect(result.map((row) => [row.teamId, row.rank])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 3],
    ]);
  });
});
