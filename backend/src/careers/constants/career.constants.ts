import { Position } from '../../players/enums/position.enum';

export const DEFAULT_CAREER_START_YEAR = 2026;
export const INITIAL_CAREER_TEAM_COUNT = 2;
export const MAX_CAREER_TEAM_COUNT = 48;
export const MAX_BENCH_PLAYERS = 5;

export const STARTER_POSITIONS: readonly Position[] = [
  Position.TOP,
  Position.JUNGLE,
  Position.MID,
  Position.ADC,
  Position.SUPPORT,
];
