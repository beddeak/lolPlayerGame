import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { Position } from '../../players/enums/position.enum';
import { SimpleMatchStatKey } from '../simulation/simple-match.types';

export interface ChampionArchetypeTuning {
  position: Position;
  statMultipliers: Partial<Record<SimpleMatchStatKey, number>>;
  phaseRatings: {
    early: number;
    mid: number;
    late: number;
  };
}

export const CHAMPION_ARCHETYPE_CONFIG: Record<
  ChampionArchetype,
  ChampionArchetypeTuning
> = {
  [ChampionArchetype.TOP_TANK]: {
    position: Position.TOP,
    statMultipliers: {
      gameSense: 1.1,
      teamFight: 1.25,
      teamPlay: 1.15,
      mental: 1.1,
    },
    phaseRatings: { early: 68, mid: 86, late: 92 },
  },
  [ChampionArchetype.TOP_AD_BRUISER]: {
    position: Position.TOP,
    statMultipliers: {
      mechanics: 1.15,
      laning: 1.15,
      teamFight: 1.1,
      mental: 1.05,
    },
    phaseRatings: { early: 86, mid: 88, late: 78 },
  },
  [ChampionArchetype.TOP_AP_BRUISER]: {
    position: Position.TOP,
    statMultipliers: {
      mechanics: 1.1,
      gameSense: 1.1,
      teamFight: 1.15,
      championPool: 1.1,
    },
    phaseRatings: { early: 78, mid: 90, late: 84 },
  },
  [ChampionArchetype.TOP_SIDE_LANE]: {
    position: Position.TOP,
    statMultipliers: {
      mechanics: 1.15,
      laning: 1.3,
      teamFight: 0.8,
      macro: 1.15,
      teamPlay: 0.85,
    },
    phaseRatings: { early: 94, mid: 92, late: 86 },
  },
  [ChampionArchetype.TOP_VALUE]: {
    position: Position.TOP,
    statMultipliers: {
      gameSense: 1.15,
      teamFight: 1.15,
      macro: 1.15,
      teamPlay: 1.15,
      championPool: 1.1,
    },
    phaseRatings: { early: 70, mid: 84, late: 98 },
  },
  [ChampionArchetype.JUNGLE_ENGAGE]: {
    position: Position.JUNGLE,
    statMultipliers: {
      gameSense: 1.15,
      teamFight: 1.25,
      macro: 1.15,
      teamPlay: 1.15,
      mental: 1.05,
    },
    phaseRatings: { early: 82, mid: 92, late: 85 },
  },
  [ChampionArchetype.JUNGLE_SCALING]: {
    position: Position.JUNGLE,
    statMultipliers: {
      mechanics: 1.1,
      gameSense: 1.1,
      teamFight: 1.15,
      macro: 1.15,
      championPool: 1.05,
    },
    phaseRatings: { early: 58, mid: 84, late: 98 },
  },
  [ChampionArchetype.JUNGLE_EARLY_SNOWBALL]: {
    position: Position.JUNGLE,
    statMultipliers: {
      mechanics: 1.15,
      gameSense: 1.2,
      teamFight: 0.9,
      macro: 1.1,
      mental: 1.1,
    },
    phaseRatings: { early: 100, mid: 82, late: 55 },
  },
  [ChampionArchetype.MID_ASSASSIN]: {
    position: Position.MID,
    statMultipliers: {
      mechanics: 1.25,
      gameSense: 1.1,
      laning: 1.15,
      teamFight: 0.9,
      macro: 1.05,
    },
    phaseRatings: { early: 92, mid: 88, late: 62 },
  },
  [ChampionArchetype.MID_STANDING_MAGE]: {
    position: Position.MID,
    statMultipliers: {
      mechanics: 1.1,
      laning: 1.15,
      teamFight: 1.2,
      macro: 1.1,
    },
    phaseRatings: { early: 78, mid: 90, late: 94 },
  },
  [ChampionArchetype.MID_TANK]: {
    position: Position.MID,
    statMultipliers: {
      gameSense: 1.15,
      teamFight: 1.15,
      macro: 1.1,
      teamPlay: 1.2,
      mental: 1.1,
    },
    phaseRatings: { early: 70, mid: 86, late: 88 },
  },
  [ChampionArchetype.MID_AP_BRUISER]: {
    position: Position.MID,
    statMultipliers: {
      mechanics: 1.15,
      laning: 1.1,
      teamFight: 1.15,
      mental: 1.1,
    },
    phaseRatings: { early: 82, mid: 91, late: 84 },
  },
  [ChampionArchetype.MID_AD_BRUISER]: {
    position: Position.MID,
    statMultipliers: {
      mechanics: 1.2,
      laning: 1.2,
      teamFight: 1.05,
      mental: 1.05,
    },
    phaseRatings: { early: 90, mid: 88, late: 72 },
  },
  [ChampionArchetype.MID_VALUE]: {
    position: Position.MID,
    statMultipliers: {
      gameSense: 1.15,
      teamFight: 1.15,
      macro: 1.2,
      teamPlay: 1.15,
      championPool: 1.1,
    },
    phaseRatings: { early: 68, mid: 86, late: 100 },
  },
  [ChampionArchetype.LANE_BULLY]: {
    position: Position.ADC,
    statMultipliers: { mechanics: 1.1, laning: 1.25, teamFight: 0.9 },
    phaseRatings: { early: 100, mid: 85, late: 52 },
  },
  [ChampionArchetype.HYPER_CARRY]: {
    position: Position.ADC,
    statMultipliers: {
      mechanics: 1.1,
      laning: 0.9,
      teamFight: 1.25,
      championPool: 1.05,
    },
    phaseRatings: { early: 55, mid: 82, late: 100 },
  },
  [ChampionArchetype.WEAKSIDE_SAFE]: {
    position: Position.ADC,
    statMultipliers: {
      gameSense: 1.1,
      laning: 1.05,
      teamPlay: 1.1,
      mental: 1.2,
    },
    phaseRatings: { early: 78, mid: 80, late: 76 },
  },
  [ChampionArchetype.GRAB]: {
    position: Position.SUPPORT,
    statMultipliers: {
      mechanics: 1.15,
      gameSense: 1.1,
      laning: 1.1,
      teamFight: 1.05,
    },
    phaseRatings: { early: 90, mid: 78, late: 60 },
  },
  [ChampionArchetype.UTILITY]: {
    position: Position.SUPPORT,
    statMultipliers: {
      gameSense: 1.1,
      macro: 1.15,
      teamPlay: 1.25,
      championPool: 1.1,
    },
    phaseRatings: { early: 72, mid: 85, late: 92 },
  },
  [ChampionArchetype.TANK_ENGAGE]: {
    position: Position.SUPPORT,
    statMultipliers: {
      gameSense: 1.1,
      teamFight: 1.25,
      teamPlay: 1.1,
      mental: 1.1,
    },
    phaseRatings: { early: 75, mid: 88, late: 82 },
  },
};

export const CHAMPION_ARCHETYPE_PHASE_CONFIG = {
  weights: {
    early: 0.3,
    mid: 0.45,
    late: 0.25,
  },
  neutralRating: 75,
  minRating: 0,
  maxRating: 100,
  maxPenalty: -3,
  maxBonus: 3,
} as const;
