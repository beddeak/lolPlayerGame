import {
  addCalendarDays,
  calendarDaysBetween,
  createDateKey,
  getCalendarYear,
  maxDateKey,
} from './calendar-date';

describe('calendar date helpers', () => {
  it('advances across leap days and year boundaries in UTC', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-12-31', 1)).toBe('2029-01-01');
    expect(getCalendarYear('2029-01-01')).toBe(2029);
  });

  it('calculates exact day distances and latest dates', () => {
    expect(calendarDaysBetween('2026-01-01', '2026-01-12')).toBe(11);
    expect(maxDateKey('2026-01-01', '2026-03-30', '2026-01-12')).toBe(
      '2026-03-30',
    );
  });

  it('rejects impossible dates', () => {
    expect(() => createDateKey(2026, 2, 30)).toThrow('Invalid calendar date');
    expect(() => addCalendarDays('2026-13-01', 1)).toThrow(
      'Invalid calendar date key',
    );
  });
});
