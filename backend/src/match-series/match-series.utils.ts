import { BO3_SERIES_CONFIG } from './config/bo3-series.config';

export function deriveSeriesGameSeed(
  seriesSeed: number,
  gameNumber: number,
): number {
  if (
    !Number.isInteger(gameNumber) ||
    gameNumber < BO3_SERIES_CONFIG.firstGameNumber ||
    gameNumber > BO3_SERIES_CONFIG.maxGames
  ) {
    throw new RangeError(
      `BO3 gameNumber must be between ${BO3_SERIES_CONFIG.firstGameNumber} and ${BO3_SERIES_CONFIG.maxGames}`,
    );
  }

  return (
    (seriesSeed +
      (gameNumber - BO3_SERIES_CONFIG.firstGameNumber) *
        BO3_SERIES_CONFIG.seedIncrement) %
    BO3_SERIES_CONFIG.uint32Range
  );
}
