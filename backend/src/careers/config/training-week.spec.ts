import { getTrainingWeek } from './training-week';

describe('weekly training calendar', () => {
  it('resets on Monday, using game dates rather than wall-clock dates', () => {
    expect(getTrainingWeek('2026-01-04').weekStartsAt).toBe('2025-12-29');
    expect(getTrainingWeek('2026-01-05').weekStartsAt).toBe('2026-01-05');
    expect(getTrainingWeek('2026-01-05').weekEndsAt).toBe('2026-01-11');
  });
  it.each([
    '2026-01-01',
    '2026-01-11',
    '2026-03-09',
    '2026-03-15',
    '2026-03-23',
    '2026-06-27',
    '2026-07-28',
    '2026-10-14',
  ])('allows preparation on %s', (date) => {
    expect(getTrainingWeek(date).available).toBe(true);
  });
  it.each([
    '2026-01-12',
    '2026-03-16',
    '2026-06-28',
    '2026-07-29',
    '2026-10-15',
    '2026-11-15',
    '2026-11-19',
  ])('blocks competitive and offseason dates on %s', (date) => {
    expect(getTrainingWeek(date).available).toBe(false);
    expect(getTrainingWeek(date).teamAvailable).toBe(true);
  });
});
