export const CAREER_PLAYER_STATE_CONFIG = {
  min: 0,
  max: 100,
  initial: {
    form: 50,
    condition: 100,
  },
  matchModifier: {
    form: {
      neutral: 50,
      maxPenalty: -6,
      maxBonus: 6,
    },
    condition: {
      neutral: 100,
      maxPenalty: -12,
      maxBonus: 0,
    },
    mental: {
      neutral: 50,
      maxPenalty: -4,
      maxBonus: 4,
    },
  },
  postMatch: {
    form: {
      neutralRating: 5,
      ratingPointsPerDelta: 2,
      winnerDelta: 1,
      loserDelta: -1,
      minDelta: -4,
      maxDelta: 4,
    },
    condition: {
      baseLoss: 2,
      durationMinutesPerLoss: 10,
      maxLoss: 8,
    },
    mental: {
      highRatingThreshold: 7,
      lowRatingThreshold: 3,
      performanceDelta: 1,
      winnerDelta: 1,
      loserDelta: -1,
      minDelta: -2,
      maxDelta: 2,
    },
  },
  displayedDecimalPlaces: 3,
} as const;
