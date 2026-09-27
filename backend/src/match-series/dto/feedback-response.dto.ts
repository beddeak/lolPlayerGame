import { PlayerPersonality } from '../../players/enums/player-personality.enum';
import { FeedbackOption } from '../enums/feedback-option.enum';
import { FeedbackType } from '../enums/feedback-type.enum';
import type { FeedbackReaction } from '../next-set-feedback';

export class FeedbackPlayerEffectResponseDto {
  reaction!: FeedbackReaction | null;
  careerPlayerId!: number;
  personality!: PlayerPersonality;
  mentalBefore!: number;
  mentalDelta!: number;
  mentalAfter!: number;
  formBefore!: number;
  formDelta!: number;
  formAfter!: number;
  coachTrustBefore!: number;
  coachTrustDelta!: number;
  coachTrustAfter!: number;
}

export class FeedbackResponseDto {
  id!: number;
  seriesId!: number;
  afterGameId!: number;
  afterGameNumber!: number;
  type!: FeedbackType;
  option!: FeedbackOption;
  targetTeamId!: number;
  targetCareerPlayerId!: number | null;
  effects!: FeedbackPlayerEffectResponseDto[];
  createdAt!: Date;
}
