import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LeagueStageFormat as F } from '../leagues/enums/league-stage-format.enum';
import { SeasonSkipDto } from './season-skip.dto';
import { isRegularStage, plannedActivity } from './season-skip.policy';
describe('Season skip policy', () => {
  it.each([F.ROUND_ROBIN, F.GROUP, F.SWISS])(
    'automates regular format %s',
    (format) => expect(isRegularStage(format)).toBe(true),
  );
  it.each([F.PLAY_IN, F.SINGLE_ELIMINATION, F.DOUBLE_ELIMINATION, F.GAUNTLET])(
    'stops before %s',
    (format) => expect(isRegularStage(format)).toBe(false),
  );
  it('alternates on calendar weeks, not requests, with arbitrary repeat patterns', () => {
    expect(plannedActivity('2026-01-01', '2026-01-04', ['SCRIM', 'REST'])).toBe(
      'SCRIM',
    );
    expect(plannedActivity('2026-01-01', '2026-01-05', ['SCRIM', 'REST'])).toBe(
      'REST',
    );
    expect(plannedActivity('2026-01-01', '2026-01-12', ['SCRIM', 'REST'])).toBe(
      'SCRIM',
    );
    expect(
      plannedActivity('2026-01-01', '2026-01-19', ['REST', 'SCRIM', 'SCRIM']),
    ).toBe('REST');
  });
  const good = {
    splitId: 1,
    startDate: '2026-01-01',
    cursor: 'x',
    strategy: 'BALANCED',
    pattern: ['SCRIM', 'REST'],
    individuals: [{ careerPlayerId: 1, type: 'MECHANICS' }],
  };
  it('validates a complete activity plan', () =>
    expect(validateSync(plainToInstance(SeasonSkipDto, good))).toHaveLength(0));
  it.each([
    { pattern: [] },
    { pattern: Array(9).fill('REST') },
    { pattern: ['HACK'] },
    { strategy: 'HACK' },
    { individuals: [{ careerPlayerId: 1, type: 'POSITION' }] },
    { individuals: [{ careerPlayerId: 0, type: 'MECHANICS' }] },
  ])('rejects invalid configuration %j', (patch) =>
    expect(
      validateSync(plainToInstance(SeasonSkipDto, { ...good, ...patch })),
    ).not.toHaveLength(0),
  );
});
