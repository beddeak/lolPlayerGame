import { SALARY_CONFIG } from './config/salary.config';
import {
  PLAYER_CARD_STAT_MIN,
  PLAYER_CARD_STAT_MAX,
} from '../players/constants/player-card.constants';

/** One shared salary curve for player demands, AI offers and initial wage estimates. */
export function estimateMarketAnnualSalary(ability: number): number {
  if (
    !Number.isFinite(ability) ||
    ability < PLAYER_CARD_STAT_MIN ||
    ability > PLAYER_CARD_STAT_MAX
  ) {
    throw new Error(
      'Salary estimation requires ability within player stat limits',
    );
  }
  const { points, roundingUnit, maxMarketAnnualSalary } = SALARY_CONFIG;
  for (let index = 1; index < points.length; index++) {
    const upper = points[index];
    if (ability > upper.ability) continue;
    const lower = points[index - 1];
    const fraction =
      (ability - lower.ability) / (upper.ability - lower.ability);
    const salary =
      lower.annualSalary + fraction * (upper.annualSalary - lower.annualSalary);
    return Math.ceil(salary / roundingUnit) * roundingUnit;
  }
  // Training above 100 must not create an unbounded wage spiral.
  return maxMarketAnnualSalary;
}
