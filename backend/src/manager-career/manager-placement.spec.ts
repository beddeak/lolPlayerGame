import { LeagueSplitResponseDto } from '../leagues/dto/league-split-response.dto';
import { getManagerFinalRank } from './manager-placement';

describe('manager final placement', () => {
  const split = {
    stages: [
      {
        sequence: 1,
        standings: [
          { teamId: 1, rank: 1 },
          { teamId: 2, rank: 2 },
          { teamId: 3, rank: 3 },
          { teamId: 4, rank: 4 },
          { teamId: 5, rank: 5 },
          { teamId: 6, rank: 6 },
        ],
      },
      {
        sequence: 2,
        standings: [
          { teamId: 3, rank: 1 },
          { teamId: 4, rank: 2 },
          { teamId: 5, rank: 3 },
          { teamId: 6, rank: 3 },
        ],
      },
      {
        sequence: 3,
        standings: [
          { teamId: 2, rank: 1 },
          { teamId: 3, rank: 2 },
          { teamId: 1, rank: 3 },
          { teamId: 4, rank: 3 },
        ],
      },
    ],
  } as LeagueSplitResponseDto;
  it('grades the playoff champion rather than the regular-season leader', () => {
    expect(getManagerFinalRank(split, 2)).toBe(1);
    expect(getManagerFinalRank(split, 1)).toBe(3);
  });
  it('preserves tied eliminated places and skips qualified teams in earlier stages', () => {
    expect(getManagerFinalRank(split, 4)).toBe(3);
    expect(getManagerFinalRank(split, 5)).toBe(5);
    expect(getManagerFinalRank(split, 6)).toBe(5);
    expect(getManagerFinalRank(split, 7)).toBeUndefined();
  });
});
