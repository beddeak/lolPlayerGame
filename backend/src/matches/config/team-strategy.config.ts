import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { Position } from '../../players/enums/position.enum';
import { SimpleMatchStatKey } from '../simulation/simple-match.types';

export interface TeamStrategyTuning {
  positionMultipliers: Partial<Record<Position, number>>;
  statMultipliers: Partial<Record<SimpleMatchStatKey, number>>;
}

export const TEAM_STRATEGY_CONFIG: Record<TeamStrategy, TeamStrategyTuning> = {
  [TeamStrategy.BALANCED]: {
    positionMultipliers: {},
    statMultipliers: {},
  },
  [TeamStrategy.TOP_CARRY]: {
    positionMultipliers: { TOP: 1.35, ADC: 0.85 },
    statMultipliers: { mechanics: 1.1, laning: 1.1, teamFight: 1.1 },
  },
  [TeamStrategy.TOP_JUNGLE]: {
    positionMultipliers: { TOP: 1.2, JUNGLE: 1.25, ADC: 0.9 },
    statMultipliers: { gameSense: 1.1, macro: 1.1, teamPlay: 1.05 },
  },
  [TeamStrategy.MID_CARRY]: {
    positionMultipliers: { MID: 1.35, TOP: 0.9 },
    statMultipliers: { mechanics: 1.1, laning: 1.1, championPool: 1.05 },
  },
  [TeamStrategy.MID_JUNGLE]: {
    positionMultipliers: { JUNGLE: 1.25, MID: 1.2, TOP: 0.9 },
    statMultipliers: { gameSense: 1.1, macro: 1.1, teamPlay: 1.05 },
  },
  [TeamStrategy.UPPER_SIDE]: {
    positionMultipliers: {
      TOP: 1.15,
      JUNGLE: 1.15,
      MID: 1.15,
      ADC: 0.8,
      SUPPORT: 0.9,
    },
    statMultipliers: { laning: 1.05, macro: 1.1 },
  },
  [TeamStrategy.BOT_CARRY]: {
    positionMultipliers: { TOP: 0.75, ADC: 1.4, SUPPORT: 1.1 },
    statMultipliers: { teamFight: 1.1, teamPlay: 1.05, championPool: 1.1 },
  },
  [TeamStrategy.BOT_PRESSURE]: {
    positionMultipliers: {
      TOP: 0.8,
      JUNGLE: 1.1,
      ADC: 1.25,
      SUPPORT: 1.25,
    },
    statMultipliers: { mechanics: 1.05, laning: 1.2, teamPlay: 1.05 },
  },
};
