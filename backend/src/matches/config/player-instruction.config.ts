import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { Position } from '../../players/enums/position.enum';
import { SimpleMatchStatKey } from '../simulation/simple-match.types';

interface PlayerInstructionTuning {
  statMultipliers: Partial<Record<SimpleMatchStatKey, number>>;
}

type PositionInstructionTuning = Record<
  Position,
  Partial<Record<PlayerInstruction, PlayerInstructionTuning>>
>;

export const PLAYER_INSTRUCTION_CONFIG: PositionInstructionTuning = {
  [Position.TOP]: {
    [PlayerInstruction.CARRY]: {
      statMultipliers: { mechanics: 1.15, laning: 1.15, teamFight: 1.05 },
    },
    [PlayerInstruction.WEAK_SIDE]: {
      statMultipliers: { gameSense: 1.1, teamPlay: 1.1, mental: 1.15 },
    },
    [PlayerInstruction.SPLIT_PUSH]: {
      statMultipliers: { laning: 1.15, macro: 1.15, gameSense: 1.05 },
    },
    [PlayerInstruction.TEAMFIGHT]: {
      statMultipliers: { teamFight: 1.2, teamPlay: 1.1, mental: 1.05 },
    },
  },
  [Position.JUNGLE]: {
    [PlayerInstruction.PLAY_FOR_TOP]: {
      statMultipliers: { gameSense: 1.15, macro: 1.1, teamPlay: 1.1 },
    },
    [PlayerInstruction.PLAY_FOR_MID]: {
      statMultipliers: { gameSense: 1.15, macro: 1.1, teamPlay: 1.1 },
    },
    [PlayerInstruction.PLAY_FOR_BOT]: {
      statMultipliers: { gameSense: 1.15, macro: 1.1, teamPlay: 1.1 },
    },
    [PlayerInstruction.FARM_CARRY]: {
      statMultipliers: { mechanics: 1.15, championPool: 1.1, teamFight: 1.1 },
    },
    [PlayerInstruction.OBJECTIVE]: {
      statMultipliers: { macro: 1.2, gameSense: 1.15, mental: 1.05 },
    },
    [PlayerInstruction.AGGRESSIVE_GANK]: {
      statMultipliers: { mechanics: 1.15, gameSense: 1.15, laning: 1.05 },
    },
  },
  [Position.MID]: {
    [PlayerInstruction.CARRY]: {
      statMultipliers: { mechanics: 1.15, laning: 1.15, teamFight: 1.05 },
    },
    [PlayerInstruction.ROAM_TOP]: {
      statMultipliers: { gameSense: 1.15, macro: 1.1, teamPlay: 1.1 },
    },
    [PlayerInstruction.ROAM_BOT]: {
      statMultipliers: { gameSense: 1.15, macro: 1.1, teamPlay: 1.1 },
    },
    [PlayerInstruction.SUPPORT_JUNGLE]: {
      statMultipliers: { gameSense: 1.15, macro: 1.15, teamPlay: 1.1 },
    },
    [PlayerInstruction.SCALING]: {
      statMultipliers: { mechanics: 1.05, teamFight: 1.15, championPool: 1.1 },
    },
  },
  [Position.ADC]: {
    [PlayerInstruction.HYPER_CARRY]: {
      statMultipliers: { mechanics: 1.1, teamFight: 1.2, championPool: 1.1 },
    },
    [PlayerInstruction.LANE_PRESSURE]: {
      statMultipliers: { mechanics: 1.15, laning: 1.2, mental: 1.05 },
    },
    [PlayerInstruction.SAFE_FARM]: {
      statMultipliers: { gameSense: 1.1, laning: 1.1, mental: 1.15 },
    },
    [PlayerInstruction.WEAK_SIDE]: {
      statMultipliers: { gameSense: 1.15, teamPlay: 1.1, mental: 1.15 },
    },
  },
  [Position.SUPPORT]: {
    [PlayerInstruction.PROTECT_ADC]: {
      statMultipliers: { gameSense: 1.1, teamPlay: 1.2, mental: 1.05 },
    },
    [PlayerInstruction.ROAM_TOP]: {
      statMultipliers: { gameSense: 1.15, macro: 1.15, teamPlay: 1.05 },
    },
    [PlayerInstruction.ROAM_MID]: {
      statMultipliers: { gameSense: 1.15, macro: 1.15, teamPlay: 1.05 },
    },
    [PlayerInstruction.ROAM_UPPER]: {
      statMultipliers: { gameSense: 1.15, macro: 1.2, teamPlay: 1.05 },
    },
    [PlayerInstruction.ENGAGE]: {
      statMultipliers: { mechanics: 1.05, teamFight: 1.2, mental: 1.1 },
    },
    [PlayerInstruction.UTILITY]: {
      statMultipliers: { gameSense: 1.15, teamPlay: 1.15, championPool: 1.1 },
    },
  },
};

export const ROLE_PROFICIENCY_MATCH_CONFIG = {
  neutral: 50,
  min: 0,
  max: 100,
  maxPenalty: -10,
  maxBonus: 5,
} as const;
