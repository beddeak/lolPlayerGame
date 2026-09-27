import { selectPlayerOfGame, selectPlayerOfMatch } from './match-awards';

const player = (
  careerPlayerId: number,
  rating: number,
  kills = 2,
  deaths = 1,
  assists = 5,
) => ({ careerPlayerId, rating, kills, deaths, assists });
const game = (winnerTeamId: number, ratings: number[] = [8, 7, 10]) => ({
  winnerTeamId,
  teams: [
    {
      teamId: 1,
      playerStats: [player(11, ratings[0]), player(12, ratings[1])],
    },
    { teamId: 2, playerStats: [player(21, ratings[2])] },
  ],
});

describe('winner-only POG / series POM', () => {
  it('never gives POG to the losing player with the highest rating', () => {
    expect(selectPlayerOfGame(game(1))?.careerPlayerId).toBe(11);
  });
  it('returns null without a completed series, or when winner stats are missing', () => {
    expect(selectPlayerOfMatch([game(1)], null)).toBeNull();
    expect(selectPlayerOfMatch([], 1)).toBeNull();
    expect(selectPlayerOfGame({ ...game(1), winnerTeamId: 9 })).toBeNull();
  });
  it('evaluates every set including the winner team loss, not just the last POG', () => {
    const games = [
      game(1, [9, 7, 10]),
      game(2, [9, 5, 10]),
      game(1, [6, 10, 10]),
    ];
    expect(selectPlayerOfGame(games[2])?.careerPlayerId).toBe(12);
    expect(selectPlayerOfMatch(games, 1)).toEqual({
      careerPlayerId: 11,
      teamId: 1,
      gamesPlayed: 3,
      totalRating: 24,
      averageRating: 8,
      pogCount: 1,
      kills: 6,
      deaths: 3,
      assists: 15,
    });
  });
  it('handles BO1 and BO5 without mutating saved snapshots', () => {
    const games = [game(1), game(2), game(1), game(2), game(1)];
    const snapshot = JSON.stringify(games);
    expect(selectPlayerOfMatch([games[0]], 1)?.gamesPlayed).toBe(1);
    expect(selectPlayerOfMatch(games, 1)?.gamesPlayed).toBe(5);
    expect(JSON.stringify(games)).toBe(snapshot);
  });
  it('does not reward a one-set substitute over a stronger full-series total', () => {
    const games = [game(1), game(1)];
    games[1].teams[0].playerStats[1] = player(13, 10);
    expect(selectPlayerOfMatch(games, 1)?.careerPlayerId).toBe(11);
  });
  it('uses kill involvement, then fewer deaths, then stable ID for POG ties', () => {
    const value = game(1, [8, 8, 10]);
    value.teams[0].playerStats[1].assists = 6;
    expect(selectPlayerOfGame(value)?.careerPlayerId).toBe(12);
    value.teams[0].playerStats[0].assists = 6;
    value.teams[0].playerStats[0].deaths = 0;
    expect(selectPlayerOfGame(value)?.careerPlayerId).toBe(11);
    value.teams[0].playerStats[1].deaths = 0;
    value.teams[0].playerStats.reverse();
    expect(selectPlayerOfGame(value)?.careerPlayerId).toBe(11);
  });
  it('ignores invalid stats and selects no award rather than fabricating one', () => {
    const value = game(1, [NaN, Infinity, 10]);
    expect(selectPlayerOfGame(value)).toBeNull();
    expect(selectPlayerOfMatch([value], 1)).toBeNull();
  });
  it('prioritizes POG count for tied series totals, before kill involvement', () => {
    const games = [
      game(1, [9, 8, 10]),
      game(1, [9, 8, 10]),
      game(1, [6, 8, 10]),
    ];
    for (const value of games) value.teams[0].playerStats[1].assists = 20;
    expect(selectPlayerOfMatch(games, 1)).toMatchObject({
      careerPlayerId: 11,
      totalRating: 24,
      pogCount: 2,
    });
  });
  it('keeps tied POM selection stable regardless of stored player ordering', () => {
    const games = [game(1, [9, 7, 10]), game(1, [7, 9, 10])];
    for (const value of games) value.teams[0].playerStats.reverse();
    expect(selectPlayerOfMatch(games, 1)?.careerPlayerId).toBe(11);
    games[1].teams[0].playerStats.find((p) => p.careerPlayerId === 12)!.deaths =
      0;
    expect(selectPlayerOfMatch(games, 1)?.careerPlayerId).toBe(12);
  });
});
