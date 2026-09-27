import type {
  EnvironmentRules,
  ObjectiveDefinition,
  ObjectiveType,
} from './environment-types';
import type { MapDefinition } from './contracts';
import { isWalkable } from './map-paths';

export function validateEnvironmentRules(
  rules: EnvironmentRules,
  map: MapDefinition,
  stepMs: number,
): void {
  const requiredNumber = (value: unknown, name: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new RangeError(`Invalid required environment number: ${name}`);
  };
  const template = createEnvironmentRules();
  for (const [key, value] of Object.entries(template))
    if (typeof value === 'number')
      requiredNumber((rules as unknown as Record<string, unknown>)[key], key);
  for (const type of Object.keys(template.structures) as Array<
    keyof EnvironmentRules['structures']
  >)
    for (const key of Object.keys(template.structures[type]) as Array<
      keyof EnvironmentRules['structures']['OUTER']
    >)
      requiredNumber(rules.structures?.[type]?.[key], `${type}.${key}`);
  const inspect = (value: unknown, name: string): void => {
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    )
      throw new RangeError(`Invalid environment number: ${name}`);
    if (
      typeof value === 'number' &&
      name.endsWith('Ms') &&
      (!Number.isSafeInteger(value) || value % stepMs !== 0)
    )
      throw new RangeError(`Unaligned environment time: ${name}`);
    if (value && typeof value === 'object')
      Object.entries(value).forEach(([key, entry]) =>
        inspect(entry, `${name}.${key}`),
      );
  };
  inspect(rules, 'environment');
  // Local shared pools use integer quotient/remainder distribution. Fractional
  // pools (or fractional plate decay) would mint rounded-up gold for recipients.
  for (const key of [
    'plateGold',
    'firstTurretGold',
    'outerGoldDecay',
    'outerMaxGoldDecay',
  ] as const)
    if (!Number.isSafeInteger(rules[key]))
      throw new RangeError(`Invalid integer environment gold: ${key}`);
  if (
    !rules.objectives?.length ||
    rules.objectives.length > 5 ||
    new Set(rules.objectives.map((entry) => entry.type)).size !==
      rules.objectives.length
  )
    throw new RangeError('Invalid objective definitions');
  for (const definition of rules.objectives) {
    for (const key of Object.keys(template.objectives[0].template) as Array<
      keyof ObjectiveDefinition['template']
    >)
      requiredNumber(definition.template?.[key], `${definition.type}.${key}`);
    for (const key of ['teamGold', 'teamXp', 'spawnAtMs'] as const)
      requiredNumber(definition[key], `${definition.type}.${key}`);
    if (
      !['DRAGON', 'GRUB', 'HERALD', 'BARON', 'ELDER'].includes(
        definition.type,
      ) ||
      !['VOID', 'DRAGON'].includes(definition.pit) ||
      !isWalkable(map, definition.position)
    )
      throw new RangeError('Invalid objective identity/site');
    if (
      !Number.isSafeInteger(definition.count) ||
      definition.count < 1 ||
      definition.count > 3 ||
      (definition.type !== 'GRUB' && definition.count !== 1)
    )
      throw new RangeError('Invalid objective count');
    if (
      (definition.type === 'GRUB' || definition.type === 'HERALD') &&
      definition.respawnDelayMs !== null
    )
      throw new RangeError('Pinned GRUB/HERALD definitions cannot respawn');
    if (
      !definition.template ||
      definition.template.hp <= 0 ||
      definition.template.attackIntervalMs <= 0 ||
      definition.template.cs !== 0 ||
      (definition.despawnAtMs !== null &&
        definition.despawnAtMs <= definition.spawnAtMs) ||
      (definition.respawnDelayMs !== null && definition.respawnDelayMs <= 0)
    )
      throw new RangeError('Invalid objective template/lifecycle');
  }
  for (const type of [
    'OUTER',
    'INNER',
    'BASE',
    'INHIBITOR',
    'NEXUS_TURRET',
    'NEXUS',
  ] as const) {
    const definition = rules.structures?.[type];
    if (
      !definition ||
      !(definition.hp > 0) ||
      !(definition.attackIntervalMs > 0)
    )
      throw new RangeError('Invalid structure definition');
  }
  if (
    !Array.isArray(rules.plateThresholds) ||
    rules.plateThresholds.length !== 5 ||
    rules.plateThresholds[4] !== 1 ||
    rules.plateThresholds.some(
      (value, index) =>
        value <= 0 ||
        value > 1 ||
        (index > 0 && value <= rules.plateThresholds[index - 1]),
    )
  )
    throw new RangeError('Invalid plate thresholds');
  if (
    !(rules.outerDecayStepMs > 0) ||
    !(rules.overgrowthRampMs > 0) ||
    !(rules.objectiveLeashRadius > 0) ||
    rules.backdoorDamageMultiplier > 1 ||
    rules.nexusTurretRespawnHpFraction <= 0 ||
    rules.nexusTurretRespawnHpFraction > 1 ||
    !Number.isSafeInteger(rules.dragonSoulStacks) ||
    rules.dragonSoulStacks < 1 ||
    rules.dragonSoulStacks > 10
  )
    throw new RangeError('Invalid environment bounds');
}

/** Pinned development model; only explicitly documented fields are official reference values. */
export function createEnvironmentRules(): EnvironmentRules {
  const objective = (
    type: ObjectiveType,
    spawnAtMs: number,
    hp: number,
    attackDamage: number,
    gold: number,
    xp: number,
    extra: Partial<ObjectiveDefinition> = {},
  ): ObjectiveDefinition => ({
    type,
    pit: type === 'DRAGON' || type === 'ELDER' ? 'DRAGON' : 'VOID',
    position:
      type === 'DRAGON' || type === 'ELDER'
        ? { x: 6300, y: 6300 }
        : { x: 3700, y: 3700 },
    spawnAtMs,
    despawnAtMs: null,
    respawnDelayMs: null,
    count: 1,
    template: {
      hp,
      attackDamage,
      armor: 35,
      attackRange: 360,
      attackIntervalMs: 1600,
      moveSpeed: 130,
      gold,
      xp,
      cs: 0,
    },
    teamGold: 0,
    teamXp: 0,
    ...extra,
  });
  return {
    // HP/damage/reward totals below are MODEL approximations, not Riot monster scaling.
    objectives: [
      objective('DRAGON', 300_000, 4200, 35, 75, 200, {
        respawnDelayMs: 300_000,
      }),
      objective('GRUB', 480_000, 1800, 22, 30, 65, {
        count: 3,
        despawnAtMs: 885_000,
      }),
      objective('HERALD', 900_000, 6500, 45, 100, 300, {
        despawnAtMs: 1_185_000,
      }),
      objective('BARON', 1_200_000, 11_000, 95, 100, 0, {
        respawnDelayMs: 360_000,
        teamGold: 100,
        teamXp: 500,
      }),
      objective('ELDER', 0, 12_500, 95, 100, 0, {
        respawnDelayMs: 360_000,
        teamGold: 150,
        teamXp: 650,
      }),
    ],
    objectiveLeashRadius: 850,
    dragonSoulStacks: 4,
    elderFirstDelayMs: 360_000,
    baronBuffMs: 180_000,
    elderBuffMs: 150_000,
    objectiveBuffDamagePerDragon: 0.025,
    soulDamageMultiplier: 1.08,
    elderDamageMultiplier: 1.15,
    baronMinionDamageMultiplier: 1.8,
    baronEmpowerRadius: 1200,
    grubStructureDamagePerStack: 0.04,
    heraldChargeDamage: 1800,
    heraldChargeRange: 600,
    structures: {
      OUTER: {
        hp: 9000,
        armor: 60,
        attackDamage: 145,
        attackRange: 900,
        attackIntervalMs: 1200,
        globalGold: 50,
      },
      INNER: {
        hp: 5000,
        armor: 60,
        attackDamage: 160,
        attackRange: 900,
        attackIntervalMs: 1200,
        globalGold: 50,
      },
      BASE: {
        hp: 4750,
        armor: 60,
        attackDamage: 175,
        attackRange: 900,
        attackIntervalMs: 1200,
        globalGold: 50,
      },
      INHIBITOR: {
        hp: 4000,
        armor: 20,
        attackDamage: 0,
        attackRange: 0,
        attackIntervalMs: 1000,
        globalGold: 0,
      },
      NEXUS_TURRET: {
        hp: 3500,
        armor: 60,
        attackDamage: 180,
        attackRange: 900,
        attackIntervalMs: 1200,
        globalGold: 0,
      },
      NEXUS: {
        hp: 5500,
        armor: 20,
        attackDamage: 0,
        attackRange: 0,
        attackIntervalMs: 1000,
        globalGold: 0,
      },
    },
    towerVision: 1100,
    backdoorRadius: 1100,
    backdoorDamageMultiplier: 0.15,
    turretMinionDamageMultiplier: 0.6,
    meleeTurretDamageMultiplier: 1.2,
    plateThresholds: [0.1, 0.25, 0.45, 0.7, 1],
    plateGold: 120,
    plateShareRadius: 1200,
    firstTurretGold: 300,
    inhibitorRespawnMs: 300_000,
    nexusTurretRespawnMs: 180_000,
    nexusTurretRespawnHpFraction: 0.4,
    outerDecayStartMs: 660_000,
    outerDecayStepMs: 60_000,
    outerArmorDecay: 15,
    outerMaxArmorDecay: 60,
    outerGoldDecay: 10,
    outerMaxGoldDecay: 40,
    overgrowthCooldownMs: 90_000,
    overgrowthRampDelayMs: 60_000,
    overgrowthRampMs: 240_000,
  };
}
