import { estimateMarketAnnualSalary } from './market-salary';
import { SALARY_CONFIG } from './config/salary.config';

describe('market salary balance (만원/year)', () => {
  it.each([
    [0, 1_000],
    [60, 3_000],
    [70, 10_000],
    [75, 15_000],
    [80, 30_000],
    [85, 50_000],
    [90, 80_000],
    [92, 100_000],
    [94, 200_000],
    [95, 250_000],
    [98, 350_000],
    [100, 400_000],
    [119, 400_000],
  ])(
    'estimates ability %s at %s instead of a flat quadratic price',
    (ability, salary) => {
      expect(estimateMarketAnnualSalary(ability)).toBe(salary);
    },
  );

  it('interpolates fractional ability and rounds up in 100만원 units', () => {
    expect(estimateMarketAnnualSalary(82.5)).toBe(40_000);
    expect(estimateMarketAnnualSalary(80.125)).toBe(30_500);
    expect(estimateMarketAnnualSalary(94.125)).toBe(206_300);
  });

  it('is finite, nondecreasing and capped across all attainable stat averages', () => {
    let previous = 0;
    for (let eighth = 0; eighth <= 119 * 8; eighth++) {
      const salary = estimateMarketAnnualSalary(eighth / 8);
      expect(Number.isSafeInteger(salary)).toBe(true);
      expect(salary % SALARY_CONFIG.roundingUnit).toBe(0);
      expect(salary).toBeGreaterThanOrEqual(previous);
      expect(salary).toBeLessThanOrEqual(SALARY_CONFIG.maxMarketAnnualSalary);
      previous = salary;
    }
  });

  it.each([NaN, Infinity, -Infinity, -1, 120])(
    'rejects invalid ability %s',
    (ability) => {
      expect(() => estimateMarketAnnualSalary(ability)).toThrow();
    },
  );
});
