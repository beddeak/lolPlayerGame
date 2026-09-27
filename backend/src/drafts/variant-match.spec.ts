import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { CHAMPION_VARIANTS, VARIANTS_BY_ID } from './variant-catalog';
import { variantMatchModifier } from './variant-match';

describe('draft variant match contribution', () => {
  it('changes contribution when the selected curve changes', () => {
    const a = VARIANTS_BY_ID.get('ADC_LANE_BULLY_A')!;
    const c = VARIANTS_BY_ID.get('ADC_LANE_BULLY_C')!;
    expect(variantMatchModifier(a, a, TeamStrategy.BALANCED)).not.toBe(
      variantMatchModifier(c, a, TeamStrategy.BALANCED),
    );
    expect(variantMatchModifier(c, a, TeamStrategy.BOT_CARRY)).toBeGreaterThan(
      variantMatchModifier(a, a, TeamStrategy.BOT_CARRY),
    );
  });
  it('keeps every matchup bounded and deterministic without altering profiles', () => {
    const original = JSON.stringify(CHAMPION_VARIANTS);
    for (const pick of CHAMPION_VARIANTS)
      for (const opponent of CHAMPION_VARIANTS.filter(
        (v) => v.position === pick.position,
      )) {
        const result = variantMatchModifier(
          pick,
          opponent,
          TeamStrategy.BALANCED,
        );
        expect(result).toBeGreaterThanOrEqual(-5);
        expect(result).toBeLessThanOrEqual(5);
        expect(result).toBe(
          variantMatchModifier(pick, opponent, TeamStrategy.BALANCED),
        );
      }
    expect(JSON.stringify(CHAMPION_VARIANTS)).toBe(original);
  });
});
