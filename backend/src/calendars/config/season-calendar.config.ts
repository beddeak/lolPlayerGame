import {
  addCalendarDays,
  calendarDaysBetween,
  createDateKey,
  maxDateKey,
} from '../calendar-date';

interface SplitCalendarWindow {
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
}

const SPLIT_CALENDAR_WINDOWS: Record<number, SplitCalendarWindow> = {
  1: { startMonth: 1, startDay: 12, endMonth: 3, endDay: 8 },
  2: { startMonth: 3, startDay: 30, endMonth: 6, endDay: 21 },
  3: { startMonth: 7, startDay: 29, endMonth: 10, endDay: 7 },
};

export const LEAGUE_CALENDAR_CONFIG = {
  stageGapDays: 28,
  roundGapDays: 3,
} as const;

export function getLeagueSplitWindow(
  year: number,
  splitNumber: number,
): { startsAt: string; endsAt: string } {
  const window = SPLIT_CALENDAR_WINDOWS[splitNumber];

  if (!window) {
    throw new Error(`Unsupported split number: ${splitNumber}`);
  }

  return {
    startsAt: createDateKey(year, window.startMonth, window.startDay),
    endsAt: createDateKey(year, window.endMonth, window.endDay),
  };
}

export function getLeagueFixtureDate(
  year: number,
  splitNumber: number,
  stageSequence: number,
  roundNumber: number,
  currentDate: string,
  previousScheduledDate?: string,
  stageRoundCounts?: readonly number[],
): string {
  const window = getLeagueSplitWindow(year, splitNumber);

  if (stageRoundCounts) {
    return getWindowedFixtureDate(
      window,
      stageSequence,
      roundNumber,
      currentDate,
      previousScheduledDate,
      stageRoundCounts,
    );
  }

  // Compatibility for callers without a format plan. New league fixtures always
  // supply the plan; persisted fixtures are never rescheduled by this function.
  const plannedStageStart = addCalendarDays(
    window.startsAt,
    (stageSequence - 1) * LEAGUE_CALENDAR_CONFIG.stageGapDays,
  );
  const plannedRoundDate = addCalendarDays(
    plannedStageStart,
    (roundNumber - 1) * LEAGUE_CALENDAR_CONFIG.roundGapDays,
  );
  const earliestFutureDate = addCalendarDays(currentDate, 1);

  return maxDateKey(
    plannedRoundDate,
    earliestFutureDate,
    ...(previousScheduledDate
      ? [
          addCalendarDays(
            previousScheduledDate,
            LEAGUE_CALENDAR_CONFIG.roundGapDays,
          ),
        ]
      : []),
  );
}

function getWindowedFixtureDate(
  window: { startsAt: string; endsAt: string },
  stageSequence: number,
  roundNumber: number,
  currentDate: string,
  previousScheduledDate: string | undefined,
  stageRoundCounts: readonly number[],
): string {
  if (
    !Number.isInteger(stageSequence) ||
    stageSequence < 1 ||
    stageSequence > stageRoundCounts.length ||
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    stageRoundCounts.some((count) => !Number.isInteger(count) || count < 1) ||
    roundNumber > stageRoundCounts[stageSequence - 1]
  ) {
    throw new RangeError('Invalid league stage round budget');
  }

  const totalRounds = stageRoundCounts.reduce((sum, count) => sum + count, 0);
  const daySpan = calendarDaysBetween(window.startsAt, window.endsAt);

  if (totalRounds > daySpan + 1) {
    throw new RangeError('League format exceeds its domestic calendar window');
  }

  const roundIndex =
    stageRoundCounts
      .slice(0, stageSequence - 1)
      .reduce((sum, count) => sum + count, 0) +
    roundNumber -
    1;
  const roundGap = Math.min(
    LEAGUE_CALENDAR_CONFIG.roundGapDays,
    Math.max(1, Math.floor(daySpan / Math.max(1, totalRounds - 1))),
  );
  const plannedDate = addCalendarDays(window.startsAt, roundIndex * roundGap);
  const earliestDate = maxDateKey(
    addCalendarDays(currentDate, 1),
    window.startsAt,
    ...(previousScheduledDate
      ? [addCalendarDays(previousScheduledDate, 1)]
      : []),
  );
  const preferredDate = maxDateKey(
    plannedDate,
    earliestDate,
    ...(previousScheduledDate
      ? [addCalendarDays(previousScheduledDate, roundGap)]
      : []),
  );
  const latestDate = addCalendarDays(
    window.endsAt,
    -(totalRounds - roundIndex - 1),
  );

  // Compress gaps when a season starts late. If an old save is already past the
  // window, preserving time/order wins over backdating; the calendar reports the
  // overdue split instead of silently changing any existing result or fixture.
  return preferredDate <= latestDate
    ? preferredDate
    : maxDateKey(earliestDate, latestDate);
}
