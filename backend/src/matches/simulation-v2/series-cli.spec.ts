import {
  parseTacticalSeriesOptions,
  runTacticalSeriesLab,
} from '../../../scripts/run-tactical-series-lab';

describe('full tactical series laboratory CLI', () => {
  it('defaults to bounded BO5, without starting a game during parsing', () => {
    expect(parseTacticalSeriesOptions([])).toEqual({
      seed: 123,
      minutes: 40,
      bestOf: 5,
      verifyResume: false,
    });
    expect(
      parseTacticalSeriesOptions([
        '--seed',
        '0',
        '--minutes',
        '60',
        '--best-of',
        '1',
        '--verify-resume',
      ]),
    ).toEqual({
      seed: 0,
      minutes: 60,
      bestOf: 1,
      verifyResume: true,
    });
  });

  it.each([
    ['--seed', '-1'],
    ['--seed', '4294967296'],
    ['--minutes', '0'],
    ['--minutes', '61'],
    ['--minutes', '1.5'],
    ['--best-of', '2'],
    ['--seed'],
    ['--bad'],
    ['--seed', '1', '--seed', '2'],
    ['--verify-resume', '--verify-resume'],
  ])(
    'rejects malformed arguments %j before doing simulation work',
    (...args: string[]) => {
      expect(() => parseTacticalSeriesOptions(args)).toThrow();
    },
  );

  it('runs a one-minute actual-engine draft but never turns an unfinished set into a result', () => {
    const report = runTacticalSeriesLab({
      seed: 123,
      minutes: 1,
      bestOf: 5,
      verifyResume: true,
    });
    expect(report.status).toBe('INCOMPLETE');
    expect(report.completedSets).toBe(0);
    expect(report.winnerTeamId).toBeNull();
    expect(report.score).toEqual({ '1': 0, '2': 0 });
    expect(report.games).toHaveLength(1);
    expect(report.games[0].durationMs).toBe(60_000);
    expect(report.games[0].picks).toHaveLength(10);
    expect(report.games[0].bans).toHaveLength(10);
    expect(report.games[0].resumeVerified).toBe(true);
    expect(report.fearlessUsedPickCount).toBe(0);
    expect(report.databaseWrites).toBe(0);
    expect(report.stopped?.gameNumber).toBe(1);
  });
});
