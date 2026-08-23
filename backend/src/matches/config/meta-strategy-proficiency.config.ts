export const META_MATCH_CONFIG = {
  matchingStrategyBonus: 3,
  nonMatchingStrategyModifier: 0,
} as const;

export const STRATEGY_PROFICIENCY_MATCH_CONFIG = {
  neutral: 50,
  min: 0,
  max: 100,
  maxPenalty: -8,
  maxBonus: 4,
} as const;
