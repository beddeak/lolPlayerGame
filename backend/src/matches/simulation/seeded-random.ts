const UINT32_RANGE = 0x1_0000_0000;
const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(LCG_MULTIPLIER, state) + LCG_INCREMENT) >>> 0;

    return state / UINT32_RANGE;
  };
}
