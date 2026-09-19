import { Region } from '../careers/enums/region.enum';
import {
  LeagueSplitResponseDto,
  LeagueStageResponseDto,
  LeagueStandingResponseDto,
} from '../leagues/dto/league-split-response.dto';
import { LeagueSplitStatus } from '../leagues/enums/league-split-status.enum';
import { lcpQualification } from './lcp-qualification';

function split(
  number: number,
  order = [1, 2, 3, 4, 5, 6, 7, 8],
): LeagueSplitResponseDto {
  const rows = order.map(
    (id, index) =>
      ({
        teamId: id,
        rank: index + 1,
        gameDifference: id === 1 ? 10 : -2,
        seriesWins: index < 4 ? 3 : 2,
        seriesLosses: index < 4 ? Math.min(index, 2) : 3,
      }) as LeagueStandingResponseDto,
  );
  return {
    region: Region.LCP,
    splitNumber: number,
    status: LeagueSplitStatus.COMPLETED,
    stages: [
      { code: 'REGULAR', standings: rows, fixtures: [] },
      {
        code: 'PLAYOFFS',
        standings: rows.slice(0, number === 3 ? 4 : 6),
        participants: rows
          .slice(0, number === 3 ? 4 : 6)
          .map((row) => ({ teamId: row.teamId })),
      },
    ] as unknown as LeagueStageResponseDto[],
  } as LeagueSplitResponseDto;
}
describe('LCP championship point qualification', () => {
  it('requires all same-season splits through the requested competition', () => {
    expect(lcpQualification([split(2)], 2)).toBeNull();
    expect(lcpQualification([split(1)], 2)).toBeNull();
  });
  it('clamps negative game points, doubles Split 2 games, and retains standing points', () => {
    const result = lcpQualification([split(1), split(2)], 2)!;
    expect(result.championshipPoints[1]).toBe(10 + 7 + 20 + 20 + 7 + 20);
    expect(result.championshipPoints[2]).toBe(6 + 15 + 6 + 15);
  });
  it('MSI uses the winner and highest-point other team, not necessarily runner-up', () => {
    const result = lcpQualification(
      [split(1), split(2, [3, 4, 2, 1, 5, 6, 7, 8])],
      2,
    )!;
    expect(result.ranking.slice(0, 2)).toEqual([3, 1]);
  });
  it('Worlds uses two playoff finalists and the highest-point remaining team; adds seeding bonus separately', () => {
    const third = split(3, [3, 4, 2, 1, 5, 6, 7, 8]);
    third.stages[0].fixtures = [
      { roundNumber: 6, winnerTeamId: 5 },
    ] as LeagueStageResponseDto['fixtures'];
    const result = lcpQualification([split(1), split(2), third], 3)!;
    expect(result.ranking.slice(0, 3)).toEqual([3, 4, 1]);
    expect(result.championshipPoints[5]).toBe(3 + 3 + 15 + 5);
    expect(result.championshipPoints[2]).toBe(6 + 15 + 6 + 15 + 30 + 15);
  });
});
