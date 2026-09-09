import { RosterRole } from '../../careers/enums/roster-role.enum';

/** All monetary amounts are expressed in ten thousand KRW (만원). */
export const TRANSFER_CONFIG = {
  fee: {
    min: 0,
    max: 500_000,
    roundingUnit: 100,
    contractedMinimum: 5_000,
    base: 2_000,
    abilitySquaredMultiplier: 20,
    prospect: {
      maxAge: 22,
      multiplier: 1.25,
    },
    veteran: {
      minAge: 30,
      multiplier: 0.8,
    },
    rosterRoleMultiplier: {
      [RosterRole.STARTER]: 1.25,
      [RosterRole.BENCH]: 0.8,
    },
    remainingContract: {
      daysPerYear: 365,
      multiplierPerYear: 0.18,
      maxWeightedYears: 5,
    },
  },
} as const;
