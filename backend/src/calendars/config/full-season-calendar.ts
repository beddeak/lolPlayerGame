import { createDateKey, getCalendarYear } from '../calendar-date';
import { getLeagueSplitWindow } from './season-calendar.config';

export type SeasonPeriodKind =
  'PRESEASON' | 'REGIONAL' | 'INTERNATIONAL' | 'BREAK' | 'REVIEW' | 'OFFSEASON';

export interface SeasonPeriod {
  code: string;
  label: string;
  kind: SeasonPeriodKind;
  startsAt: string;
  endsAt: string;
  splitNumber: number | null;
  status: 'UPCOMING' | 'CURRENT' | 'COMPLETED';
  activities: string[];
}

export interface FullSeasonCalendar {
  year: number;
  currentPhase: SeasonPeriod;
  nextPhase: SeasonPeriod | null;
  nextBoundaryDate: string | null;
  periods: SeasonPeriod[];
}

/** Game calendar, not a claim about the real-world schedule in later years. */
export function getFullSeasonCalendar(date: string): FullSeasonCalendar {
  const year = getCalendarYear(date);
  const day = (month: number, value: number) =>
    createDateKey(year, month, value);
  const periods: SeasonPeriod[] = [];
  const add = (
    code: string,
    label: string,
    kind: SeasonPeriodKind,
    startsAt: string,
    endsAt: string,
    activities: string[],
    splitNumber: number | null = null,
  ) => {
    periods.push({
      code,
      label,
      kind,
      startsAt,
      endsAt,
      splitNumber,
      status:
        date < startsAt ? 'UPCOMING' : date > endsAt ? 'COMPLETED' : 'CURRENT',
      activities,
    });
  };
  const addSplit = (number: number) => {
    const window = getLeagueSplitWindow(year, number);
    add(
      `SPLIT_${number}`,
      `지역 리그 Split ${number}`,
      'REGIONAL',
      window.startsAt,
      window.endsAt,
      ['지역 리그', '플레이인 · 플레이오프'],
      number,
    );
  };
  const preparation = ['훈련', '전략 준비', '팀 합 준비'];
  const international = [
    '지역 예선 진출팀 · 로스터 등록',
    '국제대회 경기 · 대진 진행 (참가 데이터 충족 시)',
  ];
  add('PRESEASON', '프리시즌', 'PRESEASON', day(1, 1), day(1, 11), preparation);
  addSplit(1);
  add(
    'FIRST_STAND_BREAK',
    'First Stand 준비 기간',
    'BREAK',
    day(3, 9),
    day(3, 15),
    preparation,
  );
  add(
    'FIRST_STAND',
    'First Stand',
    'INTERNATIONAL',
    day(3, 16),
    day(3, 22),
    international,
  );
  add(
    'SPRING_BREAK',
    'Split 2 준비 기간',
    'BREAK',
    day(3, 23),
    day(3, 29),
    preparation,
  );
  addSplit(2);
  add(
    'MSI_BREAK',
    'MSI 준비 기간',
    'BREAK',
    day(6, 22),
    day(6, 27),
    preparation,
  );
  add('MSI', 'MSI', 'INTERNATIONAL', day(6, 28), day(7, 12), international);
  add(
    'SUMMER_BREAK',
    'Split 3 준비 기간',
    'BREAK',
    day(7, 13),
    day(7, 28),
    preparation,
  );
  addSplit(3);
  add(
    'WORLDS_BREAK',
    'Worlds 준비 기간',
    'BREAK',
    day(10, 8),
    day(10, 14),
    preparation,
  );
  add(
    'WORLDS',
    'Worlds',
    'INTERNATIONAL',
    day(10, 15),
    day(11, 14),
    international,
  );
  add('SEASON_REVIEW', '시즌 리뷰', 'REVIEW', day(11, 15), day(11, 18), [
    '올해 리그 성적 확인',
    '다음 시즌 선수단 검토',
  ]);
  add('OFFSEASON', '스토브리그', 'OFFSEASON', day(11, 19), day(12, 31), [
    'FA · 이적 · 재계약',
    '계약 만료',
    '레전드 이벤트',
    '선수단 재구성',
  ]);
  const index = periods.findIndex((period) => period.status === 'CURRENT');
  const currentPhase = periods[index];
  const nextPhase =
    periods[index + 1] ??
    (year < 9999
      ? {
          ...periods[0],
          startsAt: createDateKey(year + 1, 1, 1),
          endsAt: createDateKey(year + 1, 1, 11),
          status: 'UPCOMING' as const,
        }
      : null);
  return {
    year,
    currentPhase,
    nextPhase,
    nextBoundaryDate: nextPhase?.startsAt ?? null,
    periods,
  };
}

export function isSeasonBoundary(previousDate: string, date: string): boolean {
  return (
    previousDate !== date &&
    getFullSeasonCalendar(previousDate).nextBoundaryDate === date
  );
}
