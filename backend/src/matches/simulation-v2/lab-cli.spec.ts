import { parseLabOptions, runLab } from '../../../scripts/run-tactical-lab';

describe('tactical laboratory CLI', () => {
  it('uses bounded defaults without starting a simulation while parsing', () => {
    expect(parseLabOptions([])).toEqual({
      seed: 123,
      minutes: 10,
      batch: 1,
      verifyResume: false,
    });
  });

  it('accepts explicit valid boundaries and the resume verification flag', () => {
    expect(
      parseLabOptions([
        '--seed',
        '0',
        '--minutes',
        '1',
        '--batch',
        '100',
        '--verify-resume',
      ]),
    ).toEqual({ seed: 0, minutes: 1, batch: 100, verifyResume: true });
  });

  it.each([
    ['unknown option', ['--bad']],
    ['zero duration', ['--minutes', '0']],
    ['unsupported duration', ['--minutes', '11']],
    ['excessive batch', ['--batch', '101']],
    ['seed above uint32', ['--seed', '4294967296']],
    ['negative seed', ['--seed', '-1']],
    ['fractional duration', ['--minutes', '1.5']],
    ['missing value', ['--seed']],
    ['repeated boolean flag', ['--verify-resume', '--verify-resume']],
    ['repeated scalar flag', ['--seed', '1', '--seed', '2']],
  ])('rejects %s before running engine work', (_name, args) => {
    expect(() => parseLabOptions(args)).toThrow();
  });

  it('runs a one-minute no-commit experiment and verifies JSON checkpoint replay and ledger invariants', () => {
    const result = runLab({
      seed: 123,
      minutes: 1,
      batch: 1,
      verifyResume: true,
    });
    expect(result.mode).toBe('NON_COMMITTING_TACTICAL_LAB');
    expect(result.totals).toMatchObject({ runs: 1, databaseWrites: 0 });
    expect(result.runs).toHaveLength(1);
    const run = result.runs[0];
    expect(run).toMatchObject({
      seed: 123,
      simulatedMinutes: 1,
      status: 'RUNNING',
      winnerTeamId: null,
      invariantsPassed: true,
      resume: { verified: true, midpointMs: 30_000 },
    });
    expect(run.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.ledgerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.players).toHaveLength(10);
    expect(
      run.players.every((player) => player.level >= 1 && player.wallet >= 0),
    ).toBe(true);
    expect(run.eventCount).toBeGreaterThan(0);
    expect(run.ledgerCount).toBeGreaterThan(0);
    expect(run.replayJsonBytes).toBeGreaterThan(0);
    expect(run.resume!.checkpointJsonBytes).toBeGreaterThan(0);
    expect(result.memory.sampleCount).toBeGreaterThan(0);
    expect(result.memory.method).toContain('not allocation peaks');
    expect(result.timings.p50SimulationMs).toBeGreaterThanOrEqual(0);
  });
});
