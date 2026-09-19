export enum TrainingType {
  STRATEGY = 'STRATEGY',
  CHEMISTRY = 'CHEMISTRY',
  LANING = 'LANING',
  CHAMPION_POOL = 'CHAMPION_POOL',
  ROLE = 'ROLE',
  POSITION = 'POSITION',
  MECHANICS = 'MECHANICS',
  GAME_SENSE = 'GAME_SENSE',
  TEAM_FIGHT = 'TEAM_FIGHT',
  MACRO = 'MACRO',
  TEAM_PLAY = 'TEAM_PLAY',
  MENTAL = 'MENTAL',
  REST = 'REST',
}

export const TEAM_TRAINING_TYPES: readonly TrainingType[] = [
  TrainingType.STRATEGY,
  TrainingType.CHEMISTRY,
  TrainingType.REST,
];

export const INDIVIDUAL_TRAINING_TYPES: readonly TrainingType[] = [
  TrainingType.LANING,
  TrainingType.CHAMPION_POOL,
  TrainingType.ROLE,
  TrainingType.POSITION,
  TrainingType.MECHANICS,
  TrainingType.GAME_SENSE,
  TrainingType.TEAM_FIGHT,
  TrainingType.MACRO,
  TrainingType.TEAM_PLAY,
  TrainingType.MENTAL,
];
