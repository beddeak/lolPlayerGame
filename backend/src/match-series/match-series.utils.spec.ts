import { deriveSeriesGameSeed } from './match-series.utils';

describe('deriveSeriesGameSeed', () => {
  it('derives deterministic consecutive seeds for a BO3', () => {
    expect(deriveSeriesGameSeed(100, 1)).toBe(100);
    expect(deriveSeriesGameSeed(100, 2)).toBe(101);
    expect(deriveSeriesGameSeed(100, 3)).toBe(102);
  });

  it('wraps the seed inside the uint32 range', () => {
    expect(deriveSeriesGameSeed(0xffff_ffff, 2)).toBe(0);
  });

  it('rejects a game number outside BO3', () => {
    expect(() => deriveSeriesGameSeed(1, 0)).toThrow(RangeError);
    expect(() => deriveSeriesGameSeed(1, 4)).toThrow(RangeError);
  });

  it('supports Game 4 and Game 5 for a BO5', () => {
    expect(deriveSeriesGameSeed(100, 4, 5)).toBe(103);
    expect(deriveSeriesGameSeed(100, 5, 5)).toBe(104);
    expect(() => deriveSeriesGameSeed(100, 6, 5)).toThrow(RangeError);
  });
});
