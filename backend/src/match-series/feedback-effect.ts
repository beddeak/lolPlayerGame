import { PlayerPersonality } from '../players/enums/player-personality.enum';
import {
  FEEDBACK_OPTION_CONFIG,
  FEEDBACK_PERSONALITY_CONFIG,
  FEEDBACK_STATE_CONFIG,
} from './config/feedback.config';
import { FeedbackOption } from './enums/feedback-option.enum';

export interface FeedbackPlayerState {
  personality: PlayerPersonality;
  mental: number;
  form: number;
  coachTrust: number;
}

export interface FeedbackPlayerEffect {
  personality: PlayerPersonality;
  mentalBefore: number;
  mentalDelta: number;
  mentalAfter: number;
  formBefore: number;
  formDelta: number;
  formAfter: number;
  coachTrustBefore: number;
  coachTrustDelta: number;
  coachTrustAfter: number;
}

export function calculateFeedbackPlayerEffect(
  state: FeedbackPlayerState,
  option: FeedbackOption,
): FeedbackPlayerEffect {
  const optionConfig = FEEDBACK_OPTION_CONFIG[option];
  const personalityConfig = FEEDBACK_PERSONALITY_CONFIG[state.personality];
  const optionMultiplier = personalityConfig.optionMultipliers[option] ?? 1;
  const reactionMultiplier =
    personalityConfig.toneMultipliers[optionConfig.tone] * optionMultiplier;
  const mentalContext =
    optionConfig.mentalDelta < 0
      ? 1 +
        (FEEDBACK_STATE_CONFIG.neutral - state.mental) /
          FEEDBACK_STATE_CONFIG.mentalResilienceDivisor
      : 1 +
        (FEEDBACK_STATE_CONFIG.neutral - state.form) /
          FEEDBACK_STATE_CONFIG.formContextDivisor;
  const formContext =
    1 +
    (FEEDBACK_STATE_CONFIG.neutral - state.form) /
      FEEDBACK_STATE_CONFIG.formContextDivisor;
  const trustContext =
    optionConfig.coachTrustDelta < 0
      ? 1 +
        (FEEDBACK_STATE_CONFIG.neutral - state.coachTrust) /
          FEEDBACK_STATE_CONFIG.trustContextDivisor
      : 1 +
        (state.coachTrust - FEEDBACK_STATE_CONFIG.neutral) /
          FEEDBACK_STATE_CONFIG.trustContextDivisor;
  const mentalDelta = roundSigned(
    optionConfig.mentalDelta * reactionMultiplier * mentalContext,
  );
  const formDelta = roundSigned(
    optionConfig.formDelta * reactionMultiplier * formContext,
  );
  const coachTrustDelta = roundSigned(
    optionConfig.coachTrustDelta *
      personalityConfig.coachTrustMultiplier *
      reactionMultiplier *
      trustContext,
  );
  const mentalAfter = clampState(state.mental + mentalDelta);
  const formAfter = clampState(state.form + formDelta);
  const coachTrustAfter = clampState(state.coachTrust + coachTrustDelta);

  return {
    personality: state.personality,
    mentalBefore: state.mental,
    mentalDelta: mentalAfter - state.mental,
    mentalAfter,
    formBefore: state.form,
    formDelta: formAfter - state.form,
    formAfter,
    coachTrustBefore: state.coachTrust,
    coachTrustDelta: coachTrustAfter - state.coachTrust,
    coachTrustAfter,
  };
}

function clampState(value: number): number {
  return Math.min(
    FEEDBACK_STATE_CONFIG.max,
    Math.max(FEEDBACK_STATE_CONFIG.min, value),
  );
}

function roundSigned(value: number): number {
  return value < 0 ? -Math.round(Math.abs(value)) : Math.round(value);
}
