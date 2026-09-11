import { assertTransferWindow, getTransferWindow } from './transfer-window';

describe('Offseason transfer window', () => {
  it.each([
    ['2026-11-18', false, '2026-11-19'],
    ['2026-11-19', true, '2027-01-01'],
    ['2026-12-31', true, '2027-01-01'],
    ['2027-01-01', false, '2027-11-19'],
    ['2028-02-29', false, '2028-11-19'],
  ])('resolves %s boundaries', (date, isOpen, nextBoundaryDate) => {
    expect(getTransferWindow(date)).toEqual(
      expect.objectContaining({ isOpen, nextBoundaryDate }),
    );
  });

  it('rejects closed, previous-season and future offers', () => {
    expect(() => assertTransferWindow('2027-01-01', '2026-12-31')).toThrow();
    expect(() => assertTransferWindow('2027-11-19', '2026-11-19')).toThrow();
    expect(() => assertTransferWindow('2026-11-19', '2026-11-20')).toThrow();
    expect(() =>
      assertTransferWindow('2026-12-31', '2026-11-19'),
    ).not.toThrow();
  });
});
