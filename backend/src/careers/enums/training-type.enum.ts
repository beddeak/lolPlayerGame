export enum TrainingType {
  STRATEGY = 'STRATEGY',
  CHEMISTRY = 'CHEMISTRY',
  LANING = 'LANING',
  CHAMPION_POOL = 'CHAMPION_POOL',
  ROLE = 'ROLE',
  POSITION = 'POSITION',
}

export const TEAM_TRAINING_TYPES: readonly TrainingType[] = [
  TrainingType.STRATEGY,
  TrainingType.CHEMISTRY,
];

export const INDIVIDUAL_TRAINING_TYPES: readonly TrainingType[] = [
  TrainingType.LANING,
  TrainingType.CHAMPION_POOL,
  TrainingType.ROLE,
  TrainingType.POSITION,
];
