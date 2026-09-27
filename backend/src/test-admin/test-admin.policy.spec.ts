import { BadRequestException, ConflictException } from '@nestjs/common';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import {
  applyTestStats,
  assertTestTarget,
  validateTestStats,
} from './test-admin.policy';

describe('test admin stat and date policy', () => {
  it.each([-1, 120, 3.5, NaN, Infinity, '99', null])(
    'rejects invalid base stat %s',
    (value) => {
      expect(() =>
        validateTestStats(
          { currentMechanics: value as number },
          { currentMechanics: 80 },
        ),
      ).toThrow(BadRequestException);
    },
  );
  it.each(['form', 'condition', 'coachTrust'])('caps %s at 100', (field) => {
    expect(() => validateTestStats({ [field]: 101 }, { [field]: 50 })).toThrow(
      BadRequestException,
    );
    expect(validateTestStats({ [field]: 100 }, { [field]: 0 })).toEqual([
      field,
    ]);
  });
  it('rejects immutable fields, empty requests and missing expected values', () => {
    for (const field of [
      'playerCardId',
      'currentTeamId',
      'potential',
      'personality',
      'currentAge',
    ])
      expect(() => validateTestStats({ [field]: 1 }, { [field]: 1 })).toThrow(
        BadRequestException,
      );
    expect(() => validateTestStats({}, {})).toThrow();
    expect(() => validateTestStats({ currentMechanics: 99 }, {})).toThrow();
  });
  it('validates all fields and stale state before mutating any', () => {
    const player = { currentMechanics: 80, condition: 90 } as CareerPlayer;
    expect(() =>
      applyTestStats(
        player,
        { currentMechanics: 119, condition: 100 },
        { currentMechanics: 80, condition: 99 },
      ),
    ).toThrow(ConflictException);
    expect(player.currentMechanics).toBe(80);
    applyTestStats(
      player,
      { currentMechanics: 119, condition: 0 },
      { currentMechanics: 80, condition: 90 },
    );
    expect(player.currentMechanics).toBe(119);
    expect(player.condition).toBe(0);
  });
  it('only targets the current season market, never another year', () => {
    expect(() => assertTestTarget('2026-01-01', '2026-11-19')).not.toThrow();
    expect(() => assertTestTarget('2026-01-01', '2027-11-19')).toThrow();
    expect(() => assertTestTarget('2026-01-01', '2026-10-01')).toThrow();
  });
});
