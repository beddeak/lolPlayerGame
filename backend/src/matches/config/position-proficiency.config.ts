export const POSITION_PROFICIENCY_MATCH_CONFIG = {
  neutral: 100,
  min: 0,
  max: 100,
  maxPenalty: -40,
} as const;

export function positionProficiencyModifier(proficiency: number): number {
  const config = POSITION_PROFICIENCY_MATCH_CONFIG;
  const normalized = Math.max(config.min, Math.min(config.max, proficiency));
  return (
    ((config.neutral - normalized) / (config.neutral - config.min)) *
    config.maxPenalty
  );
}
