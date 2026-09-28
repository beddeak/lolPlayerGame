import {
  parseStage6Options,
  runStage6Regression,
  summarizeMeasurements,
} from '../../../scripts/check-stage6';
import * as engine from './engine';

describe('Stage 6 reproducibility and batch diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('bounds batch workloads and rejects malformed CLI inputs before simulation', () => {
    expect(parseStage6Options([])).toEqual({
      seed: 123,
      minutes: 1,
      batch: 20,
      verifyModes: false,
      verifySamples: 1,
    });
    expect(
      parseStage6Options(['--batch', '100', '--minutes', '60']).batch,
    ).toBe(100);
    for (const args of [
      ['--seed', '-1'],
      ['--seed', '4294967296'],
      ['--seed', '1.5'],
      ['--minutes', '0'],
      ['--minutes', '61'],
      ['--batch', '0'],
      ['--batch', '101'],
      ['--batch', '1e2'],
      ['--minutes'],
      ['--unknown'],
      ['--batch', '1', '--batch', '2'],
      ['--verify-modes', '--verify-modes'],
      ['--verify-samples', '1'],
      ['--batch', '1', '--verify-modes', '--verify-samples', '2'],
    ])
      expect(() => parseStage6Options(args)).toThrow();
  });

  it('reports nearest-rank p50/p95 for small and 100-item sets without mutating samples', () => {
    const values = [30, 10, 20];
    expect(summarizeMeasurements(values)).toEqual({
      min: 10,
      p50: 20,
      p95: 30,
      max: 30,
    });
    expect(values).toEqual([30, 10, 20]);
    expect(
      summarizeMeasurements(
        Array.from({ length: 100 }, (_, index) => index + 1),
      ),
    ).toEqual({ min: 1, p50: 50, p95: 95, max: 100 });
    expect(summarizeMeasurements([])).toBeNull();
    expect(() => summarizeMeasurements([Number.NaN])).toThrow();
  });

  it('compares actual Direct/Quick/Fast and JSON continuation while recording storage and process memory', () => {
    const result = runStage6Regression(
      parseStage6Options([
        '--seed',
        '4294967295',
        '--minutes',
        '1',
        '--batch',
        '2',
        '--verify-modes',
      ]),
    );
    expect(result.samples.map((sample) => sample.seed)).toEqual([
      4294967295, 0,
    ]);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.finished).toBe(0);
    expect(result.unfinished).toBe(2);
    expect(result.verifiedModeSamples).toBe(1);
    expect(result.databaseWrites).toBe(0);
    const [sample, unverified] = result.samples;
    expect(sample.modes!.direct).toEqual(sample.modes!.quick);
    expect(sample.modes!.fast).toEqual(sample.modes!.resumed);
    expect(sample.modes!.direct).toEqual(sample.hashes);
    expect(sample.modes!.checkpointAtMs).toBe(30_000);
    expect(sample.modes!.checkpointJsonBytes).toBeGreaterThan(0);
    expect(sample.rawFrameJsonBytes).toBeGreaterThan(0);
    expect(sample.memory.sampledPeakHeapBytes).toBeGreaterThanOrEqual(
      sample.memory.heapAfterBytes,
    );
    expect(sample.memory.sampledPeakRssBytes).toBeGreaterThanOrEqual(
      sample.memory.rssAfterBytes,
    );
    expect(sample.eventCount).toBeGreaterThan(0);
    expect(sample.ledgerCount).toBeGreaterThan(0);
    expect(sample.winnerTeamId).toBeNull();
    expect(unverified.modes).toBeNull();
  }, 30_000);

  it('preserves seed/time/evidence diagnostics and continues the batch after a simulation failure', () => {
    jest.spyOn(engine, 'runUntil').mockImplementationOnce((state) => {
      state.status = 'ERROR';
      state.error = 'Injected simulation failure';
      throw new Error(state.error);
    });
    const result = runStage6Regression(parseStage6Options(['--batch', '2']));
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.samples[0].failure).toMatchObject({
      phase: 'SIMULATE',
      message: 'Injected simulation failure',
      engineError: 'Injected simulation failure',
      reproduce: 'npm run test:sim:stage6 -- --seed 123 --minutes 1 --batch 1',
    });
    expect(result.samples[0].failure!.inputHash).toEqual(expect.any(String));
    expect(result.samples[0].failure!.lastEvents.length).toBeGreaterThan(0);
    expect(result.samples[1].seed).toBe(124);
    expect(result.samples[1].passed).toBe(true);
  }, 30_000);
});
