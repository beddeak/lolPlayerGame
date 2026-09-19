export const PLAYER_CARD_YEAR_MIN = 1900;
export const PLAYER_CARD_YEAR_MAX = 9999;
export const PLAYER_CARD_STARTING_AGE_MIN = 16;
export const PLAYER_CARD_STARTING_AGE_MAX = 40;
export const PLAYER_CARD_STAT_MIN = 0;
// Base card/current career stats and hidden potential must remain below 120.
// Form, condition, chemistry and proficiency use their separate 0..100 scales.
export const PLAYER_CARD_STAT_MAX = 119;

export const PLAYER_CARD_BASE_STAT_FIELDS = [
  'mechanics',
  'gameSense',
  'laning',
  'teamFight',
  'macro',
  'teamPlay',
  'mental',
  'championPool',
] as const;
