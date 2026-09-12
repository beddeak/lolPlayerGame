import {
  getLeagueFixtureDate,
  getLeagueSplitWindow,
} from './season-calendar.config';

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

  it('reserves playoff rounds inside the domestic window instead of adding 28 days per stage', () => {
    const budgets = [6, 18, 1, 15];
    let previous: string | undefined;

    budgets.forEach((rounds, stageIndex) => {
      for (let round = 1; round <= rounds; round += 1) {
        const next = getLeagueFixtureDate(
          2026,
          2,
          stageIndex + 1,
          round,
          previous ?? '2026-01-01',
          previous,
          budgets,
        );
        expect(next > (previous ?? '2026-01-01')).toBe(true);
        expect(next <= '2026-06-21').toBe(true);
        previous = next;
      }
    });
  });

  it('compresses preferred rest gaps before sacrificing a domestic deadline', () => {
    expect(
      getLeagueFixtureDate(2026, 1, 2, 1, '2026-03-05', '2026-03-05', [5, 3]),
    ).toBe('2026-03-06');
  });

  it('never backdates a late legacy save or schedules dependent rounds on one day', () => {
    expect(
      getLeagueFixtureDate(2026, 1, 2, 1, '2026-04-10', '2026-04-10', [5, 3]),
    ).toBe('2026-04-11');
    expect(
      getLeagueFixtureDate(2026, 1, 2, 2, '2026-04-10', '2026-04-11', [5, 3]),
    ).toBe('2026-04-12');
  });

  it('rejects invalid or physically impossible format plans', () => {
    expect(() =>
      getLeagueFixtureDate(2026, 1, 0, 1, '2026-01-01', undefined, [5]),
    ).toThrow('Invalid league stage round budget');
    expect(() =>
      getLeagueFixtureDate(2026, 1, 1, 6, '2026-01-01', undefined, [5]),
    ).toThrow('Invalid league stage round budget');
    expect(() =>
      getLeagueFixtureDate(2026, 1, 1, 1, '2026-01-01', undefined, [60]),
    ).toThrow('League format exceeds its domestic calendar window');
  });

  it('exports annual windows including leap years and the pre-Worlds break', () => {
    expect(getLeagueSplitWindow(2028, 1)).toEqual({
      startsAt: '2028-01-12',
      endsAt: '2028-03-08',
    });
    expect(getLeagueSplitWindow(2026, 3)).toEqual({
      startsAt: '2026-07-29',
      endsAt: '2026-10-07',
    });
    expect(() => getLeagueSplitWindow(2026, 4)).toThrow(
      'Unsupported split number',
    );
  });
});
