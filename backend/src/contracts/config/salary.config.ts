// Game balance, not reported real-world salaries. Money is in 만원/year.
// Ability is the mean of the eight current core stats, NOT the card's display OVR.
export const SALARY_CONFIG = {
  roundingUnit: 100,
  maxMarketAnnualSalary: 400_000,
  points: [
    { ability: 0, annualSalary: 1_000 },
    { ability: 60, annualSalary: 3_000 },
    { ability: 70, annualSalary: 10_000 },
    { ability: 75, annualSalary: 15_000 },
    { ability: 80, annualSalary: 30_000 },
    { ability: 85, annualSalary: 50_000 },
    { ability: 90, annualSalary: 80_000 },
    { ability: 92, annualSalary: 100_000 },
    { ability: 94, annualSalary: 200_000 },
    { ability: 95, annualSalary: 250_000 },
    { ability: 98, annualSalary: 350_000 },
    { ability: 100, annualSalary: 400_000 },
  ],
} as const;
