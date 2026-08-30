import { MATCH_SERIES_CONFIG } from './config/bo3-series.config';

export function deriveSeriesGameSeed(
  seriesSeed: number,
  gameNumber: number,
  bestOf: number = MATCH_SERIES_CONFIG.defaultBestOf,
): number {
  if (
    !Number.isInteger(gameNumber) ||
    gameNumber < MATCH_SERIES_CONFIG.firstGameNumber ||
    gameNumber > bestOf
  ) {
    throw new RangeError(
      `BO${bestOf} gameNumber must be between ${MATCH_SERIES_CONFIG.firstGameNumber} and ${bestOf}`,
    );
  }

  return (
    (seriesSeed +
      (gameNumber - MATCH_SERIES_CONFIG.firstGameNumber) *
        MATCH_SERIES_CONFIG.seedIncrement) %
    MATCH_SERIES_CONFIG.uint32Range
  );
}
