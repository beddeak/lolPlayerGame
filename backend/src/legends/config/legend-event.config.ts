export const LEGEND_EVENT_CONFIG = {
  maxEvents: 2,
  probabilities: {
    normal: [0.15, 0.5, 0.35],
    afterZeroSeason: [0.05, 0.55, 0.4],
  },
  guaranteeAfterZeroSeasons: 2,
  reveal: { earliest: '11-20', latest: '12-20' },
  ai: { minDecisionDays: 7, maxDecisionDays: 14, maxInterestedClubs: 4 },
} as const;
