import { MANAGER_CAREER_CONFIG } from './config/manager-career.config';
import {
  evaluateSeries,
  evaluateSplitReview,
  evaluateTransferReview,
  expectedLeagueRank,
  expectedSeriesWinChance,
  hasPoorManagerResults,
  ManagerResultState,
  ManagerSeriesEvaluation,
} from './manager-policy';

function initial(
  changes: Partial<ManagerResultState> = {},
): ManagerResultState {
  return {
    fanApproval: MANAGER_CAREER_CONFIG.initialFanApproval,
    boardConfidence: MANAGER_CAREER_CONFIG.initialBoardConfidence,
    played: 0,
    wins: 0,
    expectedWins: 0,
    winningStreak: 0,
    losingStreak: 0,
    status: 'ACTIVE',
    warningAtPlayed: null,
    ...changes,
  };
}

function series(
  state: ManagerResultState,
  won: boolean,
  expectedWinChance = 0.5,
): ManagerSeriesEvaluation {
  return evaluateSeries({ ...state, won, expectedWinChance });
}

function repeat(
  state: ManagerResultState,
  won: boolean,
  count: number,
  expectedWinChance = 0.5,
): ManagerSeriesEvaluation {
  let result = series(state, won, expectedWinChance);
  for (let index = 1; index < count; index += 1) {
    result = series(result, won, expectedWinChance);
  }
  return result;
}

describe('manager public-ability expectations', () => {
  it('has symmetric, bounded matchup expectations without rating bonuses', () => {
    expect(expectedSeriesWinChance(80, 80)).toBe(0.5);
    expect(expectedSeriesWinChance(90, 80)).toBeCloseTo(0.625);
    expect(expectedSeriesWinChance(80, 90)).toBeCloseTo(0.375);
    expect(expectedSeriesWinChance(100, 0)).toBe(0.85);
    expect(expectedSeriesWinChance(0, 100)).toBe(0.15);
    expect(
      expectedSeriesWinChance(82, 93) + expectedSeriesWinChance(93, 82),
    ).toBeCloseTo(1);
  });

  it('shares expected ranks fairly between equally strong teams', () => {
    expect(expectedLeagueRank(90, [90, 80, 70, 60])).toBe(1);
    expect(expectedLeagueRank(60, [90, 80, 70, 60])).toBe(4);
    expect(expectedLeagueRank(80, [90, 80, 80, 60])).toBe(2.5);
    expect(expectedLeagueRank(70, [70, 70, 70, 70])).toBe(2.5);
  });

  it.each([101, 119])(
    'accepts public strength %i above the old 100 cap',
    (strength) => {
      expect(expectedSeriesWinChance(strength, strength)).toBe(0.5);
      expect(expectedSeriesWinChance(strength, 0)).toBe(0.85);
      expect(expectedSeriesWinChance(0, strength)).toBe(0.15);
      expect(expectedLeagueRank(strength, [strength, 100])).toBe(1);
      expect(expectedLeagueRank(100, [strength, 100])).toBe(2);
    },
  );

  it.each([NaN, Infinity, -1, 120])(
    'rejects invalid public strength %s',
    (invalid) => {
      expect(() => expectedSeriesWinChance(invalid, 80)).toThrow();
      expect(() => expectedSeriesWinChance(80, invalid)).toThrow();
      expect(() => expectedLeagueRank(invalid, [invalid, 80])).toThrow();
      expect(() => expectedLeagueRank(80, [80, invalid])).toThrow();
    },
  );

  it('rejects absent managed team or empty league rather than inventing rank', () => {
    expect(() => expectedLeagueRank(80, [])).toThrow();
    expect(() => expectedLeagueRank(80, [90, 70])).toThrow();
  });
});

describe('manager series policy', () => {
  it('updates both independent ratings, counters and running expectation', () => {
    const won = series(initial(), true, 0.3);
    expect(won).toMatchObject({
      played: 1,
      wins: 1,
      expectedWins: 0.3,
      winningStreak: 1,
      losingStreak: 0,
      fanApproval: 70.6,
      boardConfidence: 68.5,
      status: 'ACTIVE',
      transition: 'NONE',
    });
    const lost = series(won, false, 0.7);
    expect(lost).toMatchObject({
      played: 2,
      wins: 1,
      expectedWins: 1,
      winningStreak: 0,
      losingStreak: 1,
      fanApproval: 65,
      boardConfidence: 65,
    });
  });

  it('gives larger rewards for an upset and smaller penalties for expected losses', () => {
    const favoriteWin = series(initial(), true, 0.85);
    const upsetWin = series(initial(), true, 0.15);
    const favoriteLoss = series(initial(), false, 0.85);
    const underdogLoss = series(initial(), false, 0.15);
    expect(upsetWin.fanApproval).toBeGreaterThan(favoriteWin.fanApproval);
    expect(upsetWin.boardConfidence).toBeGreaterThan(
      favoriteWin.boardConfidence,
    );
    expect(underdogLoss.fanApproval).toBeGreaterThan(favoriteLoss.fanApproval);
    expect(underdogLoss.boardConfidence).toBeGreaterThan(
      favoriteLoss.boardConfidence,
    );
  });

  it('does not punish weak expected teams as harshly for the same six losses', () => {
    const weak = repeat(initial(), false, 6, 0.15);
    const favorite = repeat(initial(), false, 6, 0.85);
    expect(weak.status).toBe('ACTIVE');
    expect(favorite.status).toBe('WARNING');
    expect(weak.boardConfidence).toBeGreaterThan(favorite.boardConfidence);
    expect(weak.fanApproval).toBeGreaterThan(favorite.fanApproval);
  });

  it('does not warn before a minimum sample even when both ratings are zero', () => {
    const five = repeat(
      initial({ fanApproval: 0, boardConfidence: 0 }),
      false,
      5,
    );
    expect(five.status).toBe('ACTIVE');
    const six = series(five, false);
    expect(six).toMatchObject({
      status: 'WARNING',
      transition: 'WARNING',
      warningAtPlayed: 6,
    });
  });

  it('warns after sustained poor results and grants three further series', () => {
    const six = repeat(initial(), false, 6);
    expect(six).toMatchObject({
      status: 'WARNING',
      transition: 'WARNING',
      warningAtPlayed: 6,
    });
    const seven = series(six, false);
    const eight = series(seven, false);
    expect(seven.status).toBe('WARNING');
    expect(eight.status).toBe('WARNING');
    expect(eight.warningAtPlayed).toBe(6);
    expect(eight.transition).toBe('NONE');
    const nine = series(eight, false);
    expect(nine).toMatchObject({
      status: 'DISMISSED',
      transition: 'DISMISSED',
      warningAtPlayed: 6,
      played: 9,
    });
  });

  it('does not immediately dismiss a newly warned manager even at zero ratings', () => {
    const warning = repeat(
      initial({ fanApproval: 0, boardConfidence: 0 }),
      false,
      6,
    );
    expect(warning.status).toBe('WARNING');
    expect(series(warning, false).status).toBe('WARNING');
    expect(repeat(warning, false, 2).status).toBe('WARNING');
    expect(repeat(warning, false, 3).status).toBe('DISMISSED');
  });

  it('preserves board support despite very unhappy fans', () => {
    const state = initial({
      fanApproval: 0,
      boardConfidence: 90,
      played: 6,
      wins: 0,
      expectedWins: 3,
      losingStreak: 6,
    });
    const result = repeat(state, false, 3);
    expect(result.fanApproval).toBe(0);
    expect(result.boardConfidence).toBeGreaterThan(50);
    expect(result.status).toBe('ACTIVE');
  });

  it('does not dismiss a warned manager whose board still supports them', () => {
    const result = series(
      initial({
        fanApproval: 0,
        boardConfidence: 80,
        played: 8,
        wins: 0,
        expectedWins: 4,
        losingStreak: 8,
        status: 'WARNING',
        warningAtPlayed: 6,
      }),
      false,
    );
    expect(result.status).toBe('WARNING');
    expect(result.transition).toBe('NONE');
  });

  it('does not warn solely from low ratings when sporting results remain good', () => {
    const result = series(
      initial({
        fanApproval: 0,
        boardConfidence: 0,
        played: 8,
        wins: 6,
        expectedWins: 4,
        losingStreak: 1,
      }),
      false,
    );
    expect(result.status).toBe('ACTIVE');
    expect(hasPoorManagerResults(result)).toBe(false);
  });

  it('requires poor results as well as low ratings before dismissal', () => {
    const result = series(
      initial({
        fanApproval: 0,
        boardConfidence: 0,
        played: 10,
        wins: 6,
        expectedWins: 5,
        losingStreak: 1,
        status: 'WARNING',
        warningAtPlayed: 6,
      }),
      false,
    );
    expect(result.status).toBe('WARNING');
    expect(result.transition).toBe('NONE');
  });

  it('does not let strong historical seasons hide a current six-series collapse', () => {
    const result = series(
      initial({
        fanApproval: 30,
        boardConfidence: 40,
        played: 105,
        wins: 100,
        expectedWins: 80,
        losingStreak: 5,
      }),
      false,
    );
    expect(result.wins / result.played).toBeGreaterThan(0.9);
    expect(result).toMatchObject({
      status: 'WARNING',
      warningAtPlayed: 106,
      losingStreak: 6,
    });
    expect(hasPoorManagerResults(result)).toBe(true);
  });

  it('recovers after improved results and clears the old grace-period marker', () => {
    const warning = repeat(initial(), false, 6);
    const one = series(warning, true);
    expect(one.status).toBe('WARNING');
    const recovered = repeat(warning, true, 3);
    expect(recovered).toMatchObject({
      status: 'ACTIVE',
      transition: 'RECOVERED',
      warningAtPlayed: null,
      winningStreak: 3,
      losingStreak: 0,
    });
  });

  it('grants a new grace period if a recovered manager is warned again', () => {
    const warning = repeat(initial(), false, 6);
    let state: ManagerResultState = repeat(warning, true, 3);
    let newWarning: ManagerSeriesEvaluation | undefined;
    for (let index = 0; index < 20; index += 1) {
      const result = series(state, false);
      if (result.transition === 'WARNING') {
        newWarning = result;
        break;
      }
      state = result;
    }
    expect(newWarning).toBeDefined();
    expect(newWarning!.warningAtPlayed).toBe(newWarning!.played);
    expect(newWarning!.warningAtPlayed).toBeGreaterThan(6);
    expect(repeat(newWarning!, false, 2).status).toBe('WARNING');
  });

  it('treats dismissal as terminal until an explicit future appointment', () => {
    const dismissed = repeat(initial(), false, 9);
    const ignored = series(dismissed, true);
    expect(ignored).toMatchObject({
      played: dismissed.played,
      wins: dismissed.wins,
      expectedWins: dismissed.expectedWins,
      fanApproval: dismissed.fanApproval,
      boardConfidence: dismissed.boardConfidence,
      status: 'DISMISSED',
      transition: 'NONE',
    });
  });

  it('clamps both ratings independently at zero and 100', () => {
    expect(
      series(initial({ fanApproval: 99.9, boardConfidence: 99.8 }), true),
    ).toMatchObject({ fanApproval: 100, boardConfidence: 100 });
    expect(
      series(initial({ fanApproval: 0.2, boardConfidence: 0.3 }), false),
    ).toMatchObject({ fanApproval: 0, boardConfidence: 0 });
    expect(
      series(initial({ fanApproval: 150, boardConfidence: -20 }), true),
    ).toMatchObject({ fanApproval: 100, boardConfidence: 2.5 });
  });

  it('is deterministic and leaves the original input untouched', () => {
    const input = Object.freeze({
      ...initial(),
      won: false,
      expectedWinChance: 0.35,
    });
    const original = { ...input };
    expect(evaluateSeries(input)).toEqual(evaluateSeries(input));
    expect(input).toEqual(original);
  });

  it.each([
    { fanApproval: NaN },
    { boardConfidence: Infinity },
    { played: NaN },
    { played: 1.5 },
    { wins: -1 },
    { wins: 1 },
    { expectedWins: NaN },
    { expectedWins: 1 },
    { winningStreak: Infinity },
    { losingStreak: 1 },
    { warningAtPlayed: 1 },
    { status: 'WARNING' as const, warningAtPlayed: null },
  ])('rejects malformed persistent state %j', (changes) => {
    expect(() => series(initial(changes), false)).toThrow();
  });

  it.each([NaN, Infinity, -0.1, 1.1])(
    'rejects invalid expected chance %s',
    (chance) => {
      expect(() => series(initial(), true, chance)).toThrow();
    },
  );
});

describe('manager split and transfer rating reviews', () => {
  it('rewards a low-expectation fourth-place finish and penalizes favorite eighth', () => {
    const over = evaluateSplitReview({
      fanApproval: 60,
      boardConfidence: 70,
      rank: 4,
      expectedRank: 9,
      teamCount: 10,
    });
    const under = evaluateSplitReview({
      fanApproval: 60,
      boardConfidence: 70,
      rank: 8,
      expectedRank: 1,
      teamCount: 10,
    });
    expect(over.fanDelta).toBeGreaterThan(0);
    expect(over.boardDelta).toBeGreaterThan(0);
    expect(under.fanDelta).toBeLessThan(0);
    expect(under.boardDelta).toBeLessThan(0);
    expect(over.fanDelta).not.toBe(over.boardDelta);
    expect(under).not.toHaveProperty('status');
  });

  it('makes no change for exactly expected rank and supports fractional tie rank', () => {
    expect(
      evaluateSplitReview({
        ...initial(),
        rank: 2,
        expectedRank: 2,
        teamCount: 4,
      }),
    ).toMatchObject({ fanDelta: 0, boardDelta: 0 });
    expect(
      evaluateSplitReview({
        ...initial(),
        rank: 2,
        expectedRank: 2.5,
        teamCount: 4,
      }).fanDelta,
    ).toBeGreaterThan(0);
  });

  it.each([
    { rank: 0 },
    { rank: 11 },
    { rank: 1.5 },
    { expectedRank: NaN },
    { expectedRank: 11 },
    { teamCount: 1 },
    { teamCount: Infinity },
  ])('rejects invalid split results %j', (changes) => {
    expect(() =>
      evaluateSplitReview({
        ...initial(),
        rank: 4,
        expectedRank: 5,
        teamCount: 10,
        ...changes,
      }),
    ).toThrow();
  });

  it('caps transfer feedback and measures signed public lineup impact only', () => {
    const acquired = evaluateTransferReview({
      ...initial(),
      kind: 'ACQUISITION',
      abilityDelta: 100,
    });
    const released = evaluateTransferReview({
      ...initial(),
      kind: 'RELEASE',
      abilityDelta: -100,
    });
    expect(acquired).toMatchObject({ fanDelta: 3, boardDelta: 2 });
    expect(released).toMatchObject({ fanDelta: -3, boardDelta: -2 });
    expect(acquired).not.toHaveProperty('status');
  });

  it('does not invent popularity rewards for a reserve or an unchanged lineup', () => {
    for (const kind of ['ACQUISITION', 'RELEASE'] as const) {
      expect(
        evaluateTransferReview({ ...initial(), kind, abilityDelta: 0 }),
      ).toMatchObject({ fanDelta: 0, boardDelta: 0 });
    }
  });

  it('reports actual bounded deltas when ratings hit their caps', () => {
    expect(
      evaluateTransferReview({
        fanApproval: 99,
        boardConfidence: 99.5,
        kind: 'ACQUISITION',
        abilityDelta: 30,
      }),
    ).toMatchObject({
      fanApproval: 100,
      boardConfidence: 100,
      fanDelta: 1,
      boardDelta: 0.5,
    });
  });

  it.each([NaN, Infinity, -101, 101])(
    'rejects invalid transfer ability delta %s',
    (abilityDelta) => {
      expect(() =>
        evaluateTransferReview({
          ...initial(),
          kind: 'ACQUISITION',
          abilityDelta,
        }),
      ).toThrow();
    },
  );
});
