import { LeagueStageFormat } from '../leagues/enums/league-stage-format.enum';
import { getTrainingWeek } from '../careers/config/training-week';

export function isRegularStage(format: LeagueStageFormat) {
  return [
    LeagueStageFormat.ROUND_ROBIN,
    LeagueStageFormat.GROUP,
    LeagueStageFormat.SWISS,
  ].includes(format);
}
export function plannedActivity(
  startDate: string,
  date: string,
  pattern: Array<'SCRIM' | 'REST'>,
) {
  const first = getTrainingWeek(startDate).weekStartsAt;
  const current = getTrainingWeek(date).weekStartsAt;
  const weeks = Math.floor(
    (Date.parse(current) - Date.parse(first)) / (7 * 86400000),
  );
  return pattern[Math.max(0, weeks) % pattern.length];
}
