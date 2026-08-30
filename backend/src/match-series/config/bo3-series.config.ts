export const BO3_SERIES_CONFIG = {
  bestOf: 3,
  winsRequired: 2,
  maxGames: 3,
  firstGameNumber: 1,
  seedIncrement: 1,
  uint32Range: 0x1_0000_0000,
  analysisDecimalPlaces: 2,
} as const;

export const MATCH_SERIES_CONFIG = {
  defaultBestOf: BO3_SERIES_CONFIG.bestOf,
  allowedBestOf: [1, 3, 5] as const,
  firstGameNumber: BO3_SERIES_CONFIG.firstGameNumber,
  seedIncrement: BO3_SERIES_CONFIG.seedIncrement,
  uint32Range: BO3_SERIES_CONFIG.uint32Range,
  analysisDecimalPlaces: BO3_SERIES_CONFIG.analysisDecimalPlaces,
} as const;

export type MatchSeriesBestOf =
  (typeof MATCH_SERIES_CONFIG.allowedBestOf)[number];

export function getSeriesWinsRequired(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}
