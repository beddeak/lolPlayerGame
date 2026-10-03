import { canonicalHash } from './simulation-v2/seeded-rng';
import { TACTICAL_JSON_TRANSFORMER } from './tactical-json.transformer';

describe('lossless tactical JSON storage', () => {
  it('preserves nested floating-point state and integrity hashes exactly', () => {
    const value = {
      frames: [{ x: 12.123456789, hp: 0.1 + 0.2, gold: 18324.799999999996 }],
      tiny: 1e-23,
      missing: null,
      text: '선수 · ❤',
    };
    const encoded = TACTICAL_JSON_TRANSFORMER.to(value) as string;
    const decoded: unknown = TACTICAL_JSON_TRANSFORMER.from(encoded);
    expect(decoded).toEqual(value);
    expect(canonicalHash(decoded)).toBe(canonicalHash(value));
    expect(Buffer.byteLength(encoded)).toBe(
      Buffer.byteLength(JSON.stringify(decoded)),
    );
  });

  it('preserves SQL NULL envelopes and refuses corrupt text', () => {
    expect(TACTICAL_JSON_TRANSFORMER.to(null)).toBeNull();
    expect(TACTICAL_JSON_TRANSFORMER.from(null)).toBeNull();
    expect(() => {
      TACTICAL_JSON_TRANSFORMER.from('{bad json');
    }).toThrow();
  });
});
