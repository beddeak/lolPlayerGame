import { buildLeagueGroups, rankBattleGroups } from './league-groups';
import { LeagueStageFormat } from './enums/league-stage-format.enum';
import { LeagueStageStatus } from './enums/league-stage-status.enum';
import { LeagueFixtureStatus } from './enums/league-fixture-status.enum';
import { LeagueGroupPairingMode } from './league-format.types';
import { LeagueStageResponseDto } from './dto/league-split-response.dto';

function stage(codes = ['A', 'B']): LeagueStageResponseDto {
  return {
    code: 'GROUP_BATTLE',
    format: LeagueStageFormat.GROUP,
    status: LeagueStageStatus.ACTIVE,
    settings: {
      groupCodes: codes,
      pairingMode: LeagueGroupPairingMode.CROSS_GROUP,
    },
    participants: [1, 2, 3, 4].map((teamId, i) => ({
      teamId,
      teamCode: `T${teamId}`,
      teamName: `Team ${teamId}`,
      initialSeed: teamId,
      groupCode: codes[i % 2],
    })),
    standings: [4, 2, 3, 1].map((teamId, i) => ({
      rank: i + 1,
      teamId,
      teamCode: `T${teamId}`,
      teamName: `Team ${teamId}`,
      played: 1,
      seriesWins: 1,
      seriesLosses: 0,
      gameWins: 2,
      gameLosses: 0,
      gameDifference: 2,
    })),
    fixtures: [],
  } as unknown as LeagueStageResponseDto;
}

describe('league group projection', () => {
  it('labels legacy groups without moving clubs and ranks within each group using the same tie seed', () => {
    const input = stage();
    const before = structuredClone(input);
    const groups = buildLeagueGroups(input);
    expect(groups.map((g) => g.name)).toEqual(['바론 그룹', '장로 그룹']);
    expect(
      groups.map((g) => g.standings.map((r) => [r.teamId, r.rank])),
    ).toEqual([
      [
        [1, 1],
        [3, 2],
      ],
      [
        [2, 1],
        [4, 2],
      ],
    ]);
    expect(groups.map((g) => g.battleStatus)).toEqual(['PENDING', 'PENDING']);
    expect(input).toEqual(before);
  });

  it('uses persisted Super Week weights, ignores incomplete games and does not reweight old saves', () => {
    const input = stage(['BARON', 'ELDER']);
    input.settings.superWeek = { bestOf: 5, winPoints: 2 };
    input.fixtures = [
      { winnerTeamId: 1, bestOf: 5, status: LeagueFixtureStatus.COMPLETED },
      { winnerTeamId: 2, bestOf: 3, status: LeagueFixtureStatus.COMPLETED },
      {
        winnerTeamId: null,
        bestOf: 5,
        status: LeagueFixtureStatus.IN_PROGRESS,
      },
    ] as LeagueStageResponseDto['fixtures'];
    expect(
      buildLeagueGroups(input).map((g) => [g.points, g.battleStatus]),
    ).toEqual([
      [2, 'LEADING'],
      [1, 'TRAILING'],
    ]);
    input.status = LeagueStageStatus.COMPLETED;
    expect(buildLeagueGroups(input).map((g) => g.battleStatus)).toEqual([
      'WINNER',
      'LOSER',
    ]);
    delete input.settings.superWeek;
    input.status = LeagueStageStatus.ACTIVE;
    expect(
      buildLeagueGroups(input).map((g) => [g.points, g.battleStatus]),
    ).toEqual([
      [1, 'TIED'],
      [1, 'TIED'],
    ]);
  });

  it('uses the same set-difference/seed tiebreak for labels and qualification', () => {
    const input = stage(['BARON', 'ELDER']);
    input.fixtures = [1, 2].map((winnerTeamId) => ({
      winnerTeamId,
      bestOf: 3,
      status: LeagueFixtureStatus.COMPLETED,
    })) as LeagueStageResponseDto['fixtures'];
    input.status = LeagueStageStatus.COMPLETED;
    // Elder has the higher prior seed, independent of alphabetical group code.
    input.participants[0].initialSeed = 2;
    input.participants[1].initialSeed = 1;
    let groups = buildLeagueGroups(input);
    expect(groups.map((g) => [g.battleStatus, g.battleTiebreaker])).toEqual([
      ['LOSER', 'INITIAL_SEED'],
      ['WINNER', 'INITIAL_SEED'],
    ]);
    expect(rankBattleGroups(groups, input.participants)[0].code).toBe('ELDER');
    input.standings.find((r) => r.teamId === 1)!.gameDifference = 3;
    groups = buildLeagueGroups(input);
    expect(groups.map((g) => [g.battleStatus, g.battleTiebreaker])).toEqual([
      ['WINNER', 'GAME_DIFFERENCE'],
      ['LOSER', 'GAME_DIFFERENCE'],
    ]);
    expect(rankBattleGroups(groups, input.participants)[0].code).toBe('BARON');
  });

  it.each([
    ['S', 'A', 'B'],
    ['A', 'B', 'C', 'D'],
    ['ASCEND', 'NIRVANA'],
    ['LEGEND', 'RISE'],
  ])('keeps intra-group stages separate: %j', (...codes) => {
    const input = stage(codes);
    input.code = 'OTHER_GROUP_STAGE';
    input.settings.pairingMode = LeagueGroupPairingMode.INTRA_GROUP;
    expect(buildLeagueGroups(input).map((g) => g.code)).toEqual(codes);
    expect(buildLeagueGroups(input).every((g) => g.battleStatus === null)).toBe(
      true,
    );
  });

  it('keeps missing group data visible without assigning a made-up group', () => {
    const input = stage();
    input.participants[0].groupCode = null;
    expect(buildLeagueGroups(input).at(-1)).toMatchObject({
      code: 'UNASSIGNED',
      standings: [expect.objectContaining({ teamId: 1 })],
    });
    input.format = LeagueStageFormat.ROUND_ROBIN;
    expect(buildLeagueGroups(input)).toEqual([]);
  });
});
