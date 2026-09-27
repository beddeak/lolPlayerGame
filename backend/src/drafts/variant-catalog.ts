import { Position } from '../players/enums/position.enum';

export interface VariantProfile {
  early: number;
  mid: number;
  late: number;
  lanePower: number;
  teamFight: number;
  scaling: number;
  range: number;
  engage: number;
  frontline: number;
}
export interface ChampionVariant extends VariantProfile {
  id: string;
  typeId: string;
  typeName: string;
  position: Position;
  variant: 'A' | 'B' | 'C';
  name: string;
}

// Versioned game-balance profiles, not real champion ratings. Role instructions
// are intentionally NOT champion types. IDs are stable across save versions.
type TypeProfile = [
  position: Position,
  code: string,
  name: string,
  early: number,
  mid: number,
  late: number,
  lanePower: number,
  teamFight: number,
  scaling: number,
  range: number,
  engage: number,
  frontline: number,
];
const TYPES: TypeProfile[] = [
  [Position.TOP, 'TANK', 'Tank', 68, 86, 90, 65, 94, 87, 25, 80, 100],
  [Position.TOP, 'BRUISER', 'Bruiser', 86, 89, 77, 88, 84, 73, 25, 65, 72],
  [Position.TOP, 'CARRY', 'Carry', 80, 88, 96, 86, 82, 97, 35, 35, 43],
  [Position.TOP, 'RANGED', 'Ranged_TOP', 95, 85, 72, 97, 75, 68, 90, 20, 20],
  [Position.TOP, 'AP', 'AP_TOP', 80, 92, 88, 81, 94, 87, 65, 60, 42],
  [Position.JUNGLE, 'CARRY', 'Carry', 69, 91, 95, 69, 88, 96, 45, 40, 40],
  [Position.JUNGLE, 'TANK', 'Tank', 70, 87, 91, 60, 92, 83, 25, 85, 96],
  [Position.JUNGLE, 'BRUISER', 'Bruiser', 90, 89, 77, 89, 86, 74, 25, 75, 73],
  [Position.JUNGLE, 'AP', 'AP_Jungle', 73, 90, 95, 73, 90, 95, 70, 40, 30],
  [Position.JUNGLE, 'UTILITY', 'Utility', 79, 86, 88, 63, 91, 82, 65, 63, 60],
  [
    Position.JUNGLE,
    'EARLY_GAME',
    'EarlyGame',
    98,
    83,
    57,
    94,
    74,
    48,
    35,
    80,
    55,
  ],
  [
    Position.MID,
    'CONTROL_MAGE',
    'ControlMage',
    78,
    91,
    94,
    85,
    95,
    94,
    88,
    50,
    25,
  ],
  [
    Position.MID,
    'STANDING_MAGE',
    'StandingMage',
    85,
    91,
    90,
    89,
    96,
    91,
    77,
    25,
    30,
  ],
  [Position.MID, 'ASSASSIN', 'Assassin', 91, 94, 69, 86, 73, 63, 20, 95, 25],
  [Position.MID, 'MELEE', 'MeleeMID', 79, 91, 90, 82, 89, 91, 20, 75, 60],
  [Position.MID, 'AD', 'AD_MID', 91, 86, 82, 92, 77, 81, 48, 55, 40],
  [Position.MID, 'UTILITY', 'Utility', 78, 86, 91, 74, 94, 88, 70, 62, 55],
  [
    Position.MID,
    'SCALING_MAGE',
    'ScalingMage',
    62,
    86,
    100,
    67,
    95,
    100,
    85,
    30,
    25,
  ],
  [
    Position.ADC,
    'CRIT_MARKSMAN',
    'CritMarksman',
    76,
    90,
    93,
    79,
    94,
    94,
    77,
    20,
    15,
  ],
  [
    Position.ADC,
    'HYPER_CARRY',
    'HyperCarry',
    59,
    85,
    99,
    63,
    99,
    100,
    81,
    10,
    15,
  ],
  [Position.ADC, 'LANE_BULLY', 'LaneBully', 93, 88, 72, 94, 82, 72, 78, 22, 18],
  [Position.ADC, 'UTILITY', 'UtilityADC', 85, 86, 80, 86, 89, 78, 90, 70, 20],
  [Position.ADC, 'AP', 'AP_Bot', 82, 90, 92, 84, 93, 90, 83, 42, 22],
  [
    Position.ADC,
    'SHORT_RANGE',
    'ShortRangeADC',
    89,
    92,
    81,
    87,
    95,
    83,
    35,
    86,
    30,
  ],
  [
    Position.ADC,
    'LONG_RANGE',
    'LongRangeADC',
    91,
    84,
    85,
    96,
    85,
    86,
    100,
    10,
    12,
  ],
  [Position.SUPPORT, 'ENGAGE', 'Engage', 86, 94, 83, 78, 95, 75, 20, 100, 85],
  [
    Position.SUPPORT,
    'ENCHANTER',
    'Enchanter',
    76,
    87,
    97,
    82,
    94,
    97,
    82,
    20,
    22,
  ],
  [Position.SUPPORT, 'TANK', 'Tank', 79, 88, 88, 71, 90, 82, 20, 78, 100],
  [Position.SUPPORT, 'POKE', 'Poke', 95, 86, 70, 98, 73, 65, 100, 20, 18],
  [Position.SUPPORT, 'MAGE', 'MageSupport', 91, 90, 81, 91, 87, 81, 86, 45, 20],
  [
    Position.SUPPORT,
    'UNORTHODOX',
    'Unorthodox',
    85,
    92,
    77,
    78,
    86,
    72,
    62,
    83,
    45,
  ],
];
const clamp = (n: number) => Math.max(0, Math.min(100, n));
export const CHAMPION_VARIANTS: readonly ChampionVariant[] = TYPES.flatMap(
  ([
    position,
    code,
    typeName,
    early,
    mid,
    late,
    lanePower,
    teamFight,
    scaling,
    range,
    engage,
    frontline,
  ]) => {
    const letters: readonly ChampionVariant['variant'][] =
      position === Position.JUNGLE || position === Position.SUPPORT
        ? (['A', 'B'] as const)
        : (['A', 'B', 'C'] as const);
    return letters.map((variant) => {
      const delta =
        variant === 'A'
          ? [6, -4, -8, 7, -6, -8]
          : variant === 'C'
            ? [-7, 4, 8, -6, 6, 8]
            : [0, 0, 0, 0, 0, 0];
      const profile = [early, mid, late, lanePower, teamFight, scaling].map(
        (value, i) => clamp(value + delta[i]),
      );
      // The user's LaneBully examples are the baseline for this archetype.
      if (position === Position.ADC && code === 'LANE_BULLY') {
        profile.splice(
          0,
          6,
          ...{
            A: [100, 82, 48, 100, 65, 45],
            B: [93, 88, 72, 94, 82, 72],
            C: [87, 91, 84, 88, 91, 84],
          }[variant],
        );
      }
      const typeId = `${position}_${code}`;
      return {
        id: `${typeId}_${variant}`,
        typeId,
        typeName,
        position,
        variant,
        name: `${typeName} ${variant}`,
        early: profile[0],
        mid: profile[1],
        late: profile[2],
        lanePower: profile[3],
        teamFight: profile[4],
        scaling: profile[5],
        range,
        engage,
        frontline,
      };
    });
  },
);
export const VARIANTS_BY_ID = new Map(
  CHAMPION_VARIANTS.map((value) => [value.id, value]),
);
export const CHAMPION_TYPES = [
  ...new Map(
    CHAMPION_VARIANTS.map((value) => [
      value.typeId,
      { id: value.typeId, name: value.typeName, position: value.position },
    ]),
  ).values(),
];

export function validTypeProficiencies(
  value: unknown,
): value is Record<string, number> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, proficiency]) =>
        CHAMPION_TYPES.some((type) => type.id === key) &&
        Number.isInteger(proficiency) &&
        Number(proficiency) >= 0 &&
        Number(proficiency) <= 100,
    )
  );
}

export function initialTypeProficiencies(
  pool: number,
  overrides: Record<string, number> | null | undefined,
) {
  return Object.fromEntries(
    CHAMPION_TYPES.map((type) => [
      type.id,
      overrides?.[type.id] ?? clamp(pool),
    ]),
  );
}
