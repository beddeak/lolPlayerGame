import { BadRequestException } from '@nestjs/common';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { TRANSFER_CONFIG } from './config/transfer.config';
import {
  calculateRequiredTransferFee,
  type RequiredTransferFeeInput,
  validateTransferFee,
} from './transfer-policy';

describe('transfer policy', () => {
  const input: RequiredTransferFeeInput = {
    ability: 85,
    currentAge: 25,
    rosterRole: RosterRole.STARTER,
    remainingContractDays: 365,
  };

  it('returns a deterministic integer in 만원 rounded to 100만원', () => {
    const first = calculateRequiredTransferFee(input);
    const second = calculateRequiredTransferFee({ ...input });

    expect(first).toBe(second);
    expect(Number.isInteger(first)).toBe(true);
    expect(first % TRANSFER_CONFIG.fee.roundingUnit).toBe(0);
    expect(first).toBeGreaterThanOrEqual(TRANSFER_CONFIG.fee.contractedMinimum);
    expect(first).toBeLessThanOrEqual(TRANSFER_CONFIG.fee.max);
  });

  it('increases the fee as ability increases because ability is squared', () => {
    const developing = calculateRequiredTransferFee({
      ...input,
      ability: 70,
    });
    const elite = calculateRequiredTransferFee({ ...input, ability: 95 });

    expect(elite).toBeGreaterThan(developing);
  });

  it('applies the prospect premium at the configured age boundary', () => {
    const prospect = calculateRequiredTransferFee({
      ...input,
      currentAge: TRANSFER_CONFIG.fee.prospect.maxAge,
    });
    const prime = calculateRequiredTransferFee({
      ...input,
      currentAge: TRANSFER_CONFIG.fee.prospect.maxAge + 1,
    });

    expect(prospect).toBeGreaterThan(prime);
  });

  it('discounts veterans from the configured minimum veteran age', () => {
    const prime = calculateRequiredTransferFee({
      ...input,
      currentAge: TRANSFER_CONFIG.fee.veteran.minAge - 1,
    });
    const veteran = calculateRequiredTransferFee({
      ...input,
      currentAge: TRANSFER_CONFIG.fee.veteran.minAge,
    });

    expect(veteran).toBeLessThan(prime);
  });

  it('values a starter above an otherwise identical bench player', () => {
    const starter = calculateRequiredTransferFee({
      ...input,
      rosterRole: RosterRole.STARTER,
    });
    const bench = calculateRequiredTransferFee({
      ...input,
      rosterRole: RosterRole.BENCH,
    });

    expect(starter).toBeGreaterThan(bench);
  });

  it('increases the fee for a longer remaining contract', () => {
    const expiring = calculateRequiredTransferFee({
      ...input,
      remainingContractDays: 0,
    });
    const longTerm = calculateRequiredTransferFee({
      ...input,
      remainingContractDays: 365 * 3,
    });

    expect(longTerm).toBeGreaterThan(expiring);
  });

  it('caps the remaining-contract premium and the final fee', () => {
    const cappedContract = calculateRequiredTransferFee({
      ...input,
      remainingContractDays:
        TRANSFER_CONFIG.fee.remainingContract.daysPerYear *
        TRANSFER_CONFIG.fee.remainingContract.maxWeightedYears,
    });
    const excessiveContract = calculateRequiredTransferFee({
      ...input,
      remainingContractDays:
        TRANSFER_CONFIG.fee.remainingContract.daysPerYear * 20,
    });
    const maximum = calculateRequiredTransferFee({
      ability: 100,
      currentAge: TRANSFER_CONFIG.fee.prospect.maxAge,
      rosterRole: RosterRole.STARTER,
      remainingContractDays:
        TRANSFER_CONFIG.fee.remainingContract.daysPerYear * 20,
    });

    expect(excessiveContract).toBe(cappedContract);
    expect(maximum).toBe(TRANSFER_CONFIG.fee.max);
  });

  it('uses the contracted minimum for a player with zero ability', () => {
    expect(
      calculateRequiredTransferFee({
        ability: 0,
        currentAge: 35,
        rosterRole: RosterRole.BENCH,
        remainingContractDays: 0,
      }),
    ).toBe(TRANSFER_CONFIG.fee.contractedMinimum);
  });

  it.each([0, 100, TRANSFER_CONFIG.fee.max])(
    'accepts an integer fee within the configured range: %d',
    (fee) => {
      expect(() => validateTransferFee(fee)).not.toThrow();
    },
  );

  it.each([-1, 1.5, TRANSFER_CONFIG.fee.max + 1, Number.NaN])(
    'rejects an invalid transfer fee: %s',
    (fee) => {
      expect(() => validateTransferFee(fee)).toThrow(BadRequestException);
    },
  );

  it.each([
    { ability: -1 },
    { ability: 101 },
    { ability: Number.NaN },
    { currentAge: 0 },
    { currentAge: 20.5 },
    { rosterRole: 'RESERVE' },
    { remainingContractDays: -1 },
    { remainingContractDays: 1.5 },
  ])('rejects invalid calculation input: %j', (override) => {
    expect(() =>
      calculateRequiredTransferFee({
        ...input,
        ...override,
      } as RequiredTransferFeeInput),
    ).toThrow(BadRequestException);
  });
});
