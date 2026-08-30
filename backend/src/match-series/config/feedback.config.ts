import { PlayerPersonality } from '../../players/enums/player-personality.enum';
import { CAREER_PLAYER_STATE_CONFIG } from '../../careers/config/player-state.config';
import { FeedbackOption } from '../enums/feedback-option.enum';
import { FeedbackType } from '../enums/feedback-type.enum';

export type FeedbackTone = 'ENCOURAGING' | 'DEMANDING' | 'HARSH';

export interface FeedbackOptionTuning {
  type: FeedbackType;
  tone: FeedbackTone;
  mentalDelta: number;
  formDelta: number;
  coachTrustDelta: number;
}

export const FEEDBACK_OPTION_CONFIG: Record<
  FeedbackOption,
  FeedbackOptionTuning
> = {
  [FeedbackOption.TRUST_PLAYER]: {
    type: FeedbackType.INDIVIDUAL,
    tone: 'ENCOURAGING',
    mentalDelta: 2,
    formDelta: 2,
    coachTrustDelta: 3,
  },
  [FeedbackOption.DEMAND_CARRY]: {
    type: FeedbackType.INDIVIDUAL,
    tone: 'DEMANDING',
    mentalDelta: 1,
    formDelta: 3,
    coachTrustDelta: 0,
  },
  [FeedbackOption.RELIEVE_PRESSURE]: {
    type: FeedbackType.INDIVIDUAL,
    tone: 'ENCOURAGING',
    mentalDelta: 3,
    formDelta: 1,
    coachTrustDelta: 2,
  },
  [FeedbackOption.DEMAND_AGGRESSION]: {
    type: FeedbackType.INDIVIDUAL,
    tone: 'DEMANDING',
    mentalDelta: 0,
    formDelta: 2,
    coachTrustDelta: -1,
  },
  [FeedbackOption.BLAME_PLAYER]: {
    type: FeedbackType.INDIVIDUAL,
    tone: 'HARSH',
    mentalDelta: -4,
    formDelta: -3,
    coachTrustDelta: -4,
  },
  [FeedbackOption.PRAISE_TEAM]: {
    type: FeedbackType.TEAM,
    tone: 'ENCOURAGING',
    mentalDelta: 2,
    formDelta: 2,
    coachTrustDelta: 2,
  },
  [FeedbackOption.REFOCUS_TEAM]: {
    type: FeedbackType.TEAM,
    tone: 'ENCOURAGING',
    mentalDelta: 1,
    formDelta: 2,
    coachTrustDelta: 1,
  },
  [FeedbackOption.WAKE_UP_TEAM]: {
    type: FeedbackType.TEAM,
    tone: 'DEMANDING',
    mentalDelta: -1,
    formDelta: 2,
    coachTrustDelta: -1,
  },
  [FeedbackOption.DISAPPOINTED_TEAM]: {
    type: FeedbackType.TEAM,
    tone: 'HARSH',
    mentalDelta: -2,
    formDelta: -1,
    coachTrustDelta: -3,
  },
  [FeedbackOption.ABUSIVE_TEAM]: {
    type: FeedbackType.TEAM,
    tone: 'HARSH',
    mentalDelta: -6,
    formDelta: -3,
    coachTrustDelta: -7,
  },
};

export const FEEDBACK_PERSONALITY_CONFIG: Record<
  PlayerPersonality,
  {
    toneMultipliers: Record<FeedbackTone, number>;
    coachTrustMultiplier: number;
    optionMultipliers: Partial<Record<FeedbackOption, number>>;
  }
> = {
  [PlayerPersonality.DEVOTED]: {
    toneMultipliers: {
      ENCOURAGING: 1.15,
      DEMANDING: 1.1,
      HARSH: 0.9,
    },
    coachTrustMultiplier: 1,
    optionMultipliers: {
      [FeedbackOption.REFOCUS_TEAM]: 1.2,
    },
  },
  [PlayerPersonality.LOYAL]: {
    toneMultipliers: {
      ENCOURAGING: 1.1,
      DEMANDING: 1,
      HARSH: 1.1,
    },
    coachTrustMultiplier: 1.35,
    optionMultipliers: {
      [FeedbackOption.TRUST_PLAYER]: 1.2,
    },
  },
  [PlayerPersonality.SELF_CENTERED]: {
    toneMultipliers: {
      ENCOURAGING: 0.9,
      DEMANDING: 1.15,
      HARSH: 1.35,
    },
    coachTrustMultiplier: 1.4,
    optionMultipliers: {
      [FeedbackOption.DEMAND_CARRY]: 1.4,
      [FeedbackOption.BLAME_PLAYER]: 1.25,
      [FeedbackOption.ABUSIVE_TEAM]: 1.25,
    },
  },
  [PlayerPersonality.PROFESSIONAL]: {
    toneMultipliers: {
      ENCOURAGING: 0.75,
      DEMANDING: 0.8,
      HARSH: 0.55,
    },
    coachTrustMultiplier: 0.7,
    optionMultipliers: {},
  },
  [PlayerPersonality.SENSITIVE]: {
    toneMultipliers: {
      ENCOURAGING: 1.3,
      DEMANDING: 1.25,
      HARSH: 1.65,
    },
    coachTrustMultiplier: 1.25,
    optionMultipliers: {
      [FeedbackOption.RELIEVE_PRESSURE]: 1.2,
      [FeedbackOption.ABUSIVE_TEAM]: 1.2,
    },
  },
};

export const FEEDBACK_STATE_CONFIG = {
  min: 0,
  max: 100,
  initialCoachTrust: CAREER_PLAYER_STATE_CONFIG.initial.coachTrust,
  neutral: 50,
  formContextDivisor: 200,
  mentalResilienceDivisor: 125,
  trustContextDivisor: 250,
} as const;
