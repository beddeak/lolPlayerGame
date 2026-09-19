import type { ValueTransformer } from 'typeorm';
import {
  PLAYER_CARD_STAT_MAX,
  PLAYER_CARD_STAT_MIN,
} from '../constants/player-card.constants';

export function assertPlayerStat(
  value: unknown,
  label = 'Player stat',
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < PLAYER_CARD_STAT_MIN ||
    value > PLAYER_CARD_STAT_MAX
  ) {
    throw new RangeError(
      `${label} must be an integer between ${PLAYER_CARD_STAT_MIN} and ${PLAYER_CARD_STAT_MAX}`,
    );
  }
}

// Enforce the same boundary for repository.save/insert/update, including
// internal simulation and seed writes which do not pass through HTTP DTOs.
// Reads deliberately preserve existing values instead of silently clamping saves.
export const PLAYER_STAT_TRANSFORMER = {
  to(value: unknown): number {
    assertPlayerStat(value);
    return value;
  },
  from(value: number): number {
    return value;
  },
} satisfies ValueTransformer;
