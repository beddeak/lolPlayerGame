import { CAREER_PLAYER_STATE_CONFIG } from '../../careers/config/player-state.config';

export interface PlayerMatchState {
  form: number;
  condition: number;
  mental: number;
}

export interface PlayerMatchStateModifiers {
  formModifier: number;
  conditionModifier: number;
  mentalModifier: number;
  stateModifier: number;
}

export interface PostMatchPlayerState extends PlayerMatchState {
  formDelta: number;
  conditionDelta: number;
  mentalDelta: number;
}

export function calculatePlayerMatchStateModifiers(
  state: PlayerMatchState,
): PlayerMatchStateModifiers {
  const config = CAREER_PLAYER_STATE_CONFIG;
  const formModifier = calculateBoundedModifier(
    state.form,
    config.matchModifier.form,
  );
  const conditionModifier = calculateBoundedModifier(
    state.condition,
    config.matchModifier.condition,
  );
  const mentalModifier = calculateBoundedModifier(
    state.mental,
    config.matchModifier.mental,
  );

  return {
    formModifier: round(formModifier),
    conditionModifier: round(conditionModifier),
    mentalModifier: round(mentalModifier),
    stateModifier: round(formModifier + conditionModifier + mentalModifier),
  };
}

export function calculatePostMatchPlayerState(
  state: PlayerMatchState,
  rating: number,
  durationMinutes: number,
  won: boolean,
): PostMatchPlayerState {
  const config = CAREER_PLAYER_STATE_CONFIG.postMatch;
  const formDelta = clamp(
    Math.round(
      (rating - config.form.neutralRating) / config.form.ratingPointsPerDelta,
    ) + (won ? config.form.winnerDelta : config.form.loserDelta),
    config.form.minDelta,
    config.form.maxDelta,
  );
  const conditionLoss = Math.min(
    config.condition.maxLoss,
    config.condition.baseLoss +
      Math.ceil(durationMinutes / config.condition.durationMinutesPerLoss),
  );
  const conditionDelta = -conditionLoss;
  const performanceMentalDelta =
    rating >= config.mental.highRatingThreshold
      ? config.mental.performanceDelta
      : rating <= config.mental.lowRatingThreshold
        ? -config.mental.performanceDelta
        : 0;
  const mentalDelta = clamp(
    performanceMentalDelta +
      (won ? config.mental.winnerDelta : config.mental.loserDelta),
    config.mental.minDelta,
    config.mental.maxDelta,
  );

  return {
    form: clampState(state.form + formDelta),
    condition: clampState(state.condition + conditionDelta),
    mental: clampState(state.mental + mentalDelta),
    formDelta,
    conditionDelta,
    mentalDelta,
  };
}

function calculateBoundedModifier(
  value: number,
  config: {
    neutral: number;
    maxPenalty: number;
    maxBonus: number;
  },
): number {
  const stateConfig = CAREER_PLAYER_STATE_CONFIG;
  const clampedValue = clamp(value, stateConfig.min, stateConfig.max);

  if (clampedValue >= config.neutral) {
    if (config.neutral === stateConfig.max) {
      return config.maxBonus;
    }

    return (
      ((clampedValue - config.neutral) / (stateConfig.max - config.neutral)) *
      config.maxBonus
    );
  }

  return (
    ((config.neutral - clampedValue) / (config.neutral - stateConfig.min)) *
    config.maxPenalty
  );
}

function clampState(value: number): number {
  return clamp(
    value,
    CAREER_PLAYER_STATE_CONFIG.min,
    CAREER_PLAYER_STATE_CONFIG.max,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Number(
    value.toFixed(CAREER_PLAYER_STATE_CONFIG.displayedDecimalPlaces),
  );
}
