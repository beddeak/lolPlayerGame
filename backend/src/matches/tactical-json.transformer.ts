import type { ValueTransformer } from 'typeorm';

/** Keep exact JS JSON number representations. Native MySQL JSON can normalize
 * floating-point values and invalidate pinned input/replay integrity hashes.
 * The checkpoint is already a binary blob; these envelopes use lossless text.
 */
export const TACTICAL_JSON_TRANSFORMER: ValueTransformer = {
  to(value: unknown): string | null {
    return value === null || value === undefined ? null : JSON.stringify(value);
  },
  from(value: string | null): unknown {
    return value === null ? null : (JSON.parse(value) as unknown);
  },
};
