import { addCalendarDays, createDateKey, maxDateKey } from '../calendar-date';

interface SplitCalendarWindow {
  startMonth: number;
  startDay: number;
}

const SPLIT_CALENDAR_WINDOWS: Record<number, SplitCalendarWindow> = {
  1: { startMonth: 1, startDay: 12 },
  2: { startMonth: 3, startDay: 30 },
  3: { startMonth: 7, startDay: 29 },
};

export const LEAGUE_CALENDAR_CONFIG = {
  stageGapDays: 28,
  roundGapDays: 3,
} as const;

export function getLeagueFixtureDate(
  year: number,
  splitNumber: number,
  stageSequence: number,
  roundNumber: number,
  currentDate: string,
  previousScheduledDate?: string,
): string {
  const window = SPLIT_CALENDAR_WINDOWS[splitNumber];

  if (!window) {
    throw new Error(`Unsupported split number: ${splitNumber}`);
  }

  const plannedStageStart = addCalendarDays(
    createDateKey(year, window.startMonth, window.startDay),
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
