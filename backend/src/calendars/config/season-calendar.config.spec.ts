import { getLeagueFixtureDate } from './season-calendar.config';

describe('season calendar configuration', () => {
  it('starts each regional split in its configured season window', () => {
    expect(getLeagueFixtureDate(2026, 1, 1, 1, '2026-01-01')).toBe(
      '2026-01-12',
    );
    expect(getLeagueFixtureDate(2026, 2, 1, 1, '2026-01-01')).toBe(
      '2026-03-30',
    );
    expect(getLeagueFixtureDate(2026, 3, 1, 1, '2026-01-01')).toBe(
      '2026-07-29',
    );
  });

  it('keeps dynamically-created rounds after both today and prior fixtures', () => {
    expect(
      getLeagueFixtureDate(2026, 1, 1, 2, '2026-04-10', '2026-04-10'),
    ).toBe('2026-04-13');
  });
});
