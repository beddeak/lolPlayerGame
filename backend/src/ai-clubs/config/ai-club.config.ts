/** EASY prototypes: spending limits are club caps, not a complete finance model. */
export const AI_CLUB_CONFIG = {
  difficulty: 'EASY',
  strategyRetention: 0.85,
  decisionIntervalDays: 7,
  renewalLeadDays: 30,
  minUpgrade: 3,
  benchUpgrade: 2,
  initialSalaryBudget: 1_000_000,
  initialTransferBudget: 500_000,
  contractYears: 2,
  salaryOfferRatio: 1.15,
  strategySpecializationThreshold: 4,
} as const;
