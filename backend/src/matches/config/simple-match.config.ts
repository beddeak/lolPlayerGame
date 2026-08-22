import { SimpleMatchStatKey } from '../simulation/simple-match.types';

export const SIMPLE_MATCH_CONFIG = {
  requiredStarterCount: 5,
  rngModifierMin: -5,
  rngModifierMax: 5,
  displayedDecimalPlaces: 3,
  playerStatKeys: [
    'mechanics',
    'gameSense',
    'laning',
    'teamFight',
    'macro',
    'teamPlay',
    'mental',
    'championPool',
  ] satisfies readonly SimpleMatchStatKey[],
} as const;
