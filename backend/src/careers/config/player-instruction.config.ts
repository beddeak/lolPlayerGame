import { Position } from '../../players/enums/position.enum';
import { PlayerInstruction } from '../enums/player-instruction.enum';

export const PLAYER_INSTRUCTIONS_BY_POSITION: Record<
  Position,
  readonly PlayerInstruction[]
> = {
  [Position.TOP]: [
    PlayerInstruction.CARRY,
    PlayerInstruction.WEAK_SIDE,
    PlayerInstruction.SPLIT_PUSH,
    PlayerInstruction.TEAMFIGHT,
  ],
  [Position.JUNGLE]: [
    PlayerInstruction.PLAY_FOR_TOP,
    PlayerInstruction.PLAY_FOR_MID,
    PlayerInstruction.PLAY_FOR_BOT,
    PlayerInstruction.FARM_CARRY,
    PlayerInstruction.OBJECTIVE,
    PlayerInstruction.AGGRESSIVE_GANK,
  ],
  [Position.MID]: [
    PlayerInstruction.CARRY,
    PlayerInstruction.ROAM_TOP,
    PlayerInstruction.ROAM_BOT,
    PlayerInstruction.SUPPORT_JUNGLE,
    PlayerInstruction.SCALING,
  ],
  [Position.ADC]: [
    PlayerInstruction.HYPER_CARRY,
    PlayerInstruction.LANE_PRESSURE,
    PlayerInstruction.SAFE_FARM,
    PlayerInstruction.WEAK_SIDE,
  ],
  [Position.SUPPORT]: [
    PlayerInstruction.PROTECT_ADC,
    PlayerInstruction.ROAM_TOP,
    PlayerInstruction.ROAM_MID,
    PlayerInstruction.ROAM_UPPER,
    PlayerInstruction.ENGAGE,
    PlayerInstruction.UTILITY,
  ],
};

export const ROLE_PROFICIENCY_CONFIG = {
  initial: 50,
  min: 0,
  max: 100,
} as const;
