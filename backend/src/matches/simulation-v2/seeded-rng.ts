import { createHash } from 'node:crypto';

export interface RandomStreams {
  world: number;
  decision: number;
  combat: number;
}

export type RandomStreamKey = keyof RandomStreams;
const STREAM_KEYS: RandomStreamKey[] = ['world', 'decision', 'combat'];

/** JSON-safe uint32 states; algorithm identity belongs in the engine version. */
export function createRandomStreams(seed: number): RandomStreams {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError('Simulation seed must be a safe integer');
  }
  const derive = (key: RandomStreamKey): number => {
    let state = 2166136261;
    for (const character of `${seed}:${key}`) {
      state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
    }
    return state;
  };
  return {
    world: derive('world'),
    decision: derive('decision'),
    combat: derive('combat'),
  };
}

/** Mulberry32: changes only the selected persisted stream; never uses ambient RNG. */
export function nextRandom(
  streams: RandomStreams,
  key: RandomStreamKey,
): number {
  if (!STREAM_KEYS.includes(key)) throw new RangeError('Unknown random stream');
  const prior = streams[key];
  if (!Number.isInteger(prior) || prior < 0 || prior > 0xffffffff) {
    throw new RangeError('Random stream state must be a uint32');
  }
  const state = (prior + 0x6d2b79f5) >>> 0;
  streams[key] = state;
  let value = Math.imul(state ^ (state >>> 15), state | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

/**
 * Canonical JSON data, with sorted object keys and significant array order.
 * Rejects lossy JSON values rather than silently mapping undefined/NaN to null.
 * -0 and 0 are identical under the checkpoint's JSON number representation.
 */
export function canonicalHash(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (part: unknown): string => {
    if (part === null) return 'null';
    if (typeof part === 'boolean' || typeof part === 'string') {
      return JSON.stringify(part);
    }
    if (typeof part === 'number') {
      if (!Number.isFinite(part)) {
        throw new TypeError(
          'Canonical state cannot contain non-finite numbers',
        );
      }
      return JSON.stringify(part);
    }
    if (typeof part !== 'object') {
      throw new TypeError('Canonical state must contain JSON data only');
    }
    if (ancestors.has(part)) {
      throw new TypeError('Canonical state cannot contain cycles');
    }
    if (Object.getOwnPropertySymbols(part).length) {
      throw new TypeError('Canonical state cannot contain symbol keys');
    }
    ancestors.add(part);
    try {
      if (Array.isArray(part)) {
        if (
          Object.keys(part).length !== part.length ||
          Array.from({ length: part.length }, (_, index) => index).some(
            (index) => !Object.hasOwn(part, index),
          )
        ) {
          throw new TypeError(
            'Canonical arrays cannot contain holes or extra keys',
          );
        }
        const entries: string[] = [];
        for (let index = 0; index < part.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(part, index)!;
          if (!('value' in descriptor)) {
            throw new TypeError('Canonical state cannot contain accessors');
          }
          entries.push(encode(descriptor.value));
        }
        return `[${entries.join(',')}]`;
      }
      const prototype: object | null = Object.getPrototypeOf(part) as
        object | null;
      const constructor: unknown =
        prototype === null
          ? null
          : Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      // structuredClone/checkpoint messages can cross a VM/worker realm. Such
      // Object.prototype identities differ but are still ordinary JSON objects.
      const plain =
        prototype === null ||
        (Object.getPrototypeOf(prototype) === null &&
          typeof constructor === 'function' &&
          constructor.prototype === prototype &&
          Function.prototype.toString.call(constructor) ===
            Function.prototype.toString.call(Object));
      if (!plain) {
        throw new TypeError('Canonical state must use plain objects');
      }
      const entries = Object.keys(part)
        .sort()
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(part, key)!;
          if (!('value' in descriptor)) {
            throw new TypeError('Canonical state cannot contain accessors');
          }
          return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
        });
      return `{${entries.join(',')}}`;
    } finally {
      ancestors.delete(part);
    }
  };
  return createHash('sha256').update(encode(value)).digest('hex');
}
