import { addCalendarDays, calendarDaysBetween } from '../calendar-date';
import { getTransferWindow } from '../../transfers/transfer-window';
import {
  getFullSeasonCalendar,
  isSeasonBoundary,
} from './full-season-calendar';

describe('full season calendar', () => {
  it.each([2026, 2028])(
    'covers every day exactly once, including leap years (%i)',
    (year) => {
      const first = `${year}-01-01`;
      const last = `${year}-12-31`;
      const calendar = getFullSeasonCalendar(first);
      expect(calendar.periods).toHaveLength(14);
      expect(calendar.periods[0].startsAt).toBe(first);
      expect(calendar.periods.at(-1)?.endsAt).toBe(last);
      for (let index = 1; index < calendar.periods.length; index++) {
        expect(calendar.periods[index].startsAt).toBe(
          addCalendarDays(calendar.periods[index - 1].endsAt, 1),
        );
      }
      for (
        let offset = 0;
        offset <= calendarDaysBetween(first, last);
        offset++
      ) {
        const date = addCalendarDays(first, offset);
        const result = getFullSeasonCalendar(date);
        expect(
          result.periods.filter((period) => period.status === 'CURRENT'),
        ).toHaveLength(1);
        expect(
          result.currentPhase.startsAt <= date &&
            result.currentPhase.endsAt >= date,
        ).toBe(true);
        expect(result.nextBoundaryDate! > date).toBe(true);
      }
    },
  );

  it.each([
    ['01-01', 'PRESEASON'],
    ['01-12', 'SPLIT_1'],
    ['03-08', 'SPLIT_1'],
    ['03-09', 'FIRST_STAND_BREAK'],
    ['03-16', 'FIRST_STAND'],
    ['03-22', 'FIRST_STAND'],
    ['03-23', 'SPRING_BREAK'],
    ['03-30', 'SPLIT_2'],
    ['06-21', 'SPLIT_2'],
    ['06-22', 'MSI_BREAK'],
    ['06-28', 'MSI'],
    ['07-12', 'MSI'],
    ['07-13', 'SUMMER_BREAK'],
    ['07-29', 'SPLIT_3'],
    ['10-07', 'SPLIT_3'],
    ['10-08', 'WORLDS_BREAK'],
    ['10-15', 'WORLDS'],
    ['11-14', 'WORLDS'],
    ['11-15', 'SEASON_REVIEW'],
    ['11-18', 'SEASON_REVIEW'],
    ['11-19', 'OFFSEASON'],
    ['12-31', 'OFFSEASON'],
  ])('maps roadmap date %s to %s', (day, code) => {
    expect(getFullSeasonCalendar(`2026-${day}`).currentPhase.code).toBe(code);
  });

  it('connects offseason to next preseason without changing market policy', () => {
    for (const date of ['2026-11-19', '2026-12-31']) {
      const season = getFullSeasonCalendar(date);
      expect(season.nextBoundaryDate).toBe('2027-01-01');
      expect(season.nextPhase?.code).toBe('PRESEASON');
      expect(getTransferWindow(date).nextBoundaryDate).toBe(
        season.nextBoundaryDate,
      );
    }
    expect(isSeasonBoundary('2026-12-31', '2027-01-01')).toBe(true);
    expect(isSeasonBoundary('2026-01-12', '2026-01-12')).toBe(false);
  });

  it('does not generate a five digit year at the supported endpoint', () => {
    expect(getFullSeasonCalendar('9999-12-31').nextPhase).toBeNull();
    expect(getFullSeasonCalendar('9999-12-31').nextBoundaryDate).toBeNull();
  });

  it('rejects invalid dates rather than selecting an arbitrary phase', () => {
    expect(() => getFullSeasonCalendar('2026-02-29')).toThrow();
  });
});
