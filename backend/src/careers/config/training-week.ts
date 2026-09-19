import { addCalendarDays } from '../../calendars/calendar-date';
import { getFullSeasonCalendar } from '../../calendars/config/full-season-calendar';

export function getTrainingWeek(date: string) {
  const phase = getFullSeasonCalendar(date).currentPhase;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekStartsAt = addCalendarDays(date, -((weekday + 6) % 7));
  const available = phase.kind === 'PRESEASON' || phase.kind === 'BREAK';
  return {
    weekStartsAt,
    weekEndsAt: addCalendarDays(weekStartsAt, 6),
    available,
    teamAvailable: true,
    unavailableReason: available
      ? null
      : '개인 능력치 훈련은 프리시즌과 준비 기간에만 가능합니다. 팀 스크림·휴식은 매주 선택할 수 있습니다.',
    phaseLabel: phase.label,
  };
}
