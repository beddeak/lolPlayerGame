const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export function createDateKey(
  year: number,
  month: number,
  day: number,
): string {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${year}-${month}-${day}`);
  }

  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round(
    (parseDateKey(to).getTime() - parseDateKey(from).getTime()) /
      MILLISECONDS_PER_DAY,
  );
}

export function getCalendarYear(dateKey: string): number {
  return parseDateKey(dateKey).getUTCFullYear();
}

export function maxDateKey(...dateKeys: string[]): string {
  dateKeys.forEach(parseDateKey);
  return [...dateKeys].sort().at(-1)!;
}

function parseDateKey(dateKey: string): Date {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    throw new Error(`Invalid calendar date key: ${dateKey}`);
  }

  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.toISOString().slice(0, 10) !== dateKey) {
    throw new Error(`Invalid calendar date key: ${dateKey}`);
  }

  return date;
}
