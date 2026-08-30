const UINT32_RANGE = 0x1_0000_0000;
const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;

export function createTrainingRandom(key: string): () => number {
  let state = FNV_OFFSET_BASIS;

  for (let index = 0; index < key.length; index += 1) {
    state ^= key.charCodeAt(index);
    state = Math.imul(state, FNV_PRIME) >>> 0;
  }

  return () => {
    state = (Math.imul(LCG_MULTIPLIER, state) + LCG_INCREMENT) >>> 0;

    return state / UINT32_RANGE;
  };
}
