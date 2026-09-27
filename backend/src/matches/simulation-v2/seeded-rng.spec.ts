import { runInNewContext } from 'node:vm';
import {
  canonicalHash,
  createRandomStreams,
  nextRandom,
  type RandomStreams,
} from './seeded-rng';

describe('simulation-v2 deterministic random streams', () => {
  it('repeats a sequence from the same seed and gives separate stream states', () => {
    const a = createRandomStreams(2026);
    const b = createRandomStreams(2026);
    expect(new Set(Object.values(a)).size).toBe(3);
    expect(createRandomStreams(2027)).not.toEqual(a);
    for (let i = 0; i < 100; i++) {
      expect(nextRandom(a, 'decision')).toBe(nextRandom(b, 'decision'));
      expect(a).toEqual(b);
    }
  });

  it('keeps world/decision draws from consuming the combat sequence', () => {
    const a = createRandomStreams(71);
    const b = createRandomStreams(71);
    for (let i = 0; i < 100; i++) {
      nextRandom(a, 'world');
      nextRandom(a, 'decision');
    }
    expect(a.combat).toBe(b.combat);
    for (let i = 0; i < 20; i++) {
      expect(nextRandom(a, 'combat')).toBe(nextRandom(b, 'combat'));
    }
  });

  it('resumes from a JSON checkpoint with the same values and final hash', () => {
    const a = createRandomStreams(-17);
    for (let i = 0; i < 31; i++) nextRandom(a, 'decision');
    const checkpoint = JSON.stringify(a);
    const b = JSON.parse(checkpoint) as RandomStreams;
    for (let i = 0; i < 500; i++) {
      const key = (['world', 'decision', 'combat'] as const)[i % 3];
      expect(nextRandom(a, key)).toBe(nextRandom(b, key));
    }
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('keeps outputs in [0,1) and states in unsigned 32-bit range', () => {
    const streams = createRandomStreams(Number.MAX_SAFE_INTEGER);
    for (let i = 0; i < 10000; i++) {
      const value = nextRandom(streams, 'world');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Number.isInteger(streams.world)).toBe(true);
      expect(streams.world).toBeGreaterThanOrEqual(0);
      expect(streams.world).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('rejects invalid seeds and corrupted persisted RNG states', () => {
    for (const value of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createRandomStreams(value)).toThrow(RangeError);
    }
    for (const value of [-1, 0.1, NaN, Infinity, 0x100000000]) {
      expect(() =>
        nextRandom({ world: value, decision: 0, combat: 0 }, 'world'),
      ).toThrow(RangeError);
    }
    expect(
      nextRandom({ world: 0, decision: 0, combat: 0 }, 'world'),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('simulation-v2 canonical state hashes', () => {
  it('accepts plain objects from structuredClone/another realm but rejects class instances', () => {
    const local = { nested: [{ hp: 50 }], time: 100 };
    const remote: unknown = runInNewContext('({nested:[{hp:50}],time:100})');
    expect(canonicalHash(remote)).toBe(canonicalHash(local));
    expect(canonicalHash(structuredClone(local))).toBe(canonicalHash(local));
    const instance: unknown = runInNewContext(
      'new (class State { hp = 50; })()',
    );
    expect(() => canonicalHash(instance)).toThrow(/plain objects/);
  });
  it('sorts object keys recursively, preserves arrays and does not mutate', () => {
    const a = { z: [{ b: 2, a: 1 }], a: null, n: true, s: '한글' };
    const before = JSON.stringify(a);
    expect(canonicalHash(a)).toBe(
      canonicalHash({ s: '한글', n: true, a: null, z: [{ a: 1, b: 2 }] }),
    );
    expect(canonicalHash(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    expect(canonicalHash({ n: 1 })).not.toBe(canonicalHash({ n: '1' }));
    expect(canonicalHash(-0)).toBe(canonicalHash(0));
    expect(JSON.stringify(a)).toBe(before);
  });

  it('matches after JSON checkpoint serialization', () => {
    const value = {
      clocks: [0, 100, 200],
      rng: createRandomStreams(44),
      hp: 12.125,
    };
    expect(canonicalHash(value)).toBe(
      canonicalHash(JSON.parse(JSON.stringify(value))),
    );
    const shared = { x: 1 };
    expect(canonicalHash([shared, shared])).toBe(
      canonicalHash([{ x: 1 }, { x: 1 }]),
    );
  });

  it('rejects undefined/nonfinite/lossy values at any depth', () => {
    const values: unknown[] = [
      undefined,
      NaN,
      Infinity,
      -Infinity,
      1n,
      Symbol('state'),
      () => 1,
      { nested: { bad: undefined } },
      [0, NaN],
      new Date(),
      new Set([1]),
      new Map(),
      new Array(2),
    ];
    for (const value of values)
      expect(() => canonicalHash(value)).toThrow(TypeError);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalHash(cyclic)).toThrow(/cycles/);
  });

  it('does not execute getters or silently ignore symbol/array extension keys', () => {
    let calls = 0;
    const accessor = {
      get value() {
        calls++;
        return 1;
      },
    };
    expect(() => canonicalHash(accessor)).toThrow(/accessors/);
    expect(calls).toBe(0);
    expect(() => canonicalHash({ [Symbol('hidden')]: 1 })).toThrow(/symbol/);
    const extra: number[] & { extra?: number } = [1];
    extra.extra = 2;
    expect(() => canonicalHash(extra)).toThrow(/extra keys/);
  });
});
