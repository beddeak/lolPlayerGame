import { PLAYER_CARD_BASE_STAT_FIELDS } from '../../players/constants/player-card.constants';
import { assertPlayerStat } from '../../players/utils/player-stat.transformer';

// Validate the complete input before connecting to the DB, running migrations,
// or updating any catalog row. Missing potential is derived from valid base stats.
export function validatePlayerCardSeeds(cards: readonly unknown[]): void {
  for (const [index, card] of cards.entries()) {
    if (typeof card !== 'object' || card === null || Array.isArray(card)) {
      throw new Error(`playerCards[${index}] must be an object`);
    }
    const fields = card as Record<string, unknown>;
    const label =
      typeof fields.key === 'string' ? fields.key : `playerCards[${index}]`;
    for (const stat of PLAYER_CARD_BASE_STAT_FIELDS) {
      assertPlayerStat(fields[stat], `${label}.${stat}`);
    }
    if (fields.potential !== undefined) {
      assertPlayerStat(fields.potential, `${label}.potential`);
    }
  }
}
