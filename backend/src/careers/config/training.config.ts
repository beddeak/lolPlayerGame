import { PlayerPersonality } from '../../players/enums/player-personality.enum';
import { TrainingType } from '../enums/training-type.enum';

export const TRAINING_CONFIG = {
  usesPerPeriod: {
    team: 1,
    individual: 1, // per player, preparation only; unavailable during a rest week
  },
  restConditionRecovery: 20,
  scrimConditionLoss: 5,
  growth: {
    [TrainingType.STRATEGY]: 4,
    [TrainingType.CHEMISTRY]: 3,
  },
  conditionLoss: {
    [TrainingType.LANING]: 8,
    [TrainingType.CHAMPION_POOL]: 6,
    [TrainingType.ROLE]: 7,
    [TrainingType.POSITION]: 9,
    [TrainingType.MECHANICS]: 8,
    [TrainingType.GAME_SENSE]: 6,
    [TrainingType.TEAM_FIGHT]: 8,
    [TrainingType.MACRO]: 6,
    [TrainingType.TEAM_PLAY]: 6,
    [TrainingType.MENTAL]: 5,
  },
  personalityConditionAdjustment: {
    [PlayerPersonality.DEVOTED]: -1,
    [PlayerPersonality.LOYAL]: 0,
    [PlayerPersonality.SELF_CENTERED]: 1,
    [PlayerPersonality.PROFESSIONAL]: -1,
    [PlayerPersonality.SENSITIVE]: 2,
  },
  statGrowthChance: {
    base: 0.35,
    perPotentialGap: 0.015,
    min: 0.2,
    max: 0.9,
  },
} as const;
