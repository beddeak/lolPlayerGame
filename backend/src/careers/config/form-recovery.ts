import { PLAYER_CARD_STAT_MAX } from '../../players/constants/player-card.constants';

// Form is temporary readiness (0..100); Mental is a player ability (0..119).
export const FORM_RECOVERY_CONFIG = {
  match: { minimum: 3, mentalBonus: 4 },
  rest: { minimum: 1, mentalBonus: 2 },
  scrim: { minimum: 1, mentalBonus: 1 },
  feedback: { minimumMultiplier: 0.25, mentalMultiplier: 0.75 },
  passive: { ceiling: 50, slowestDays: 14, fastestDays: 2 },
} as const;

export function mentalRecoveryFactor(mental: number): number {
  return (
    (Math.min(PLAYER_CARD_STAT_MAX, Math.max(0, mental)) /
      PLAYER_CARD_STAT_MAX) **
    2
  );
}

export function formRecovery(
  mental: number,
  source: 'match' | 'rest' | 'scrim',
): number {
  const tuning = FORM_RECOVERY_CONFIG[source];
  return (
    tuning.minimum +
    Math.floor(tuning.mentalBonus * mentalRecoveryFactor(mental))
  );
}

export function feedbackFormRecovery(mental: number, reaction: number): number {
  if (reaction <= 0) return reaction;
  const tuning = FORM_RECOVERY_CONFIG.feedback;
  return Math.min(
    formRecovery(mental, 'match') - 1,
    Math.round(
      reaction *
        (tuning.minimumMultiplier +
          tuning.mentalMultiplier * mentalRecoveryFactor(mental)),
    ),
  );
}

export function passiveRecoveryInterval(mental: number): number {
  const { slowestDays, fastestDays } = FORM_RECOVERY_CONFIG.passive;
  return Math.round(
    slowestDays - (slowestDays - fastestDays) * mentalRecoveryFactor(mental),
  );
}
