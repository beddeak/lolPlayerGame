import { PlayerPersonality } from '../../players/enums/player-personality.enum';
import { TrainingType } from '../enums/training-type.enum';

export const TRAINING_CONFIG = {
  usesPerPeriod: {
    team: 2,
    individual: 2,
  },
  growth: {
    [TrainingType.STRATEGY]: 4,
    [TrainingType.CHEMISTRY]: 3,
    [TrainingType.LANING]: 1,
    [TrainingType.CHAMPION_POOL]: 2,
    [TrainingType.ROLE]: 4,
    [TrainingType.POSITION]: 5,
  },
  conditionLoss: {
    [TrainingType.LANING]: 8,
    [TrainingType.CHAMPION_POOL]: 6,
    [TrainingType.ROLE]: 7,
    [TrainingType.POSITION]: 9,
  },
  personalityConditionAdjustment: {
    [PlayerPersonality.DEVOTED]: -1,
    [PlayerPersonality.LOYAL]: 0,
    [PlayerPersonality.SELF_CENTERED]: 1,
    [PlayerPersonality.PROFESSIONAL]: -1,
    [PlayerPersonality.SENSITIVE]: 2,
  },
  overload: {
    additionalConditionLoss: 5,
    baseFormDropChance: 0.35,
    sensitiveFormDropChanceBonus: 0.2,
    lowConditionThreshold: 40,
    lowConditionFormDropChanceBonus: 0.2,
    formDrop: 2,
  },
  laningGrowthChance: {
    base: 0.35,
    perPotentialGap: 0.015,
    min: 0.2,
    max: 0.9,
  },
} as const;
