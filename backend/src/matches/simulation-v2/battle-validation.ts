import type { EngineInput } from './contracts';
import { isWalkable } from './map-paths';
import { validateEnvironmentRules } from './environment-rules';

/** Reject malformed optional modules before initializing loops, cooldowns or rewards. */
export function validateBattleRules(input: EngineInput): void {
  const rules = input.rules;
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`Invalid simulation input: ${message}`);
  };
  const numericTree = (value: unknown, path: string): void => {
    if (typeof value === 'number')
      check(Number.isFinite(value) && value >= 0 && value <= 1e9, path);
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value))
        numericTree(child, `${path}.${key}`);
  };
  const time = (n: number, name: string, allowZero = false) =>
    check(
      Number.isSafeInteger(n) &&
        n >= (allowZero ? 0 : rules.stepMs) &&
        n <= 3_600_000 &&
        n % rules.stepMs === 0,
      name,
    );
  if (rules.environment) {
    const env = rules.environment;
    numericTree(env, 'environment');
    validateEnvironmentRules(env, input.map, rules.stepMs);
    check(
      rules.capabilities.nexusVictory === 'SUPPORTED',
      'environment requires physical nexus victory',
    );
    check(
      new Set(env.objectives.map((objective) => objective.type)).size ===
        env.objectives.length,
      'duplicate objective definition',
    );
    for (const objective of env.objectives) {
      check(
        ['DRAGON', 'GRUB', 'HERALD', 'BARON', 'ELDER'].includes(objective.type),
        'objective type',
      );
      check(isWalkable(input.map, objective.position), 'objective pit');
      check(
        Number.isSafeInteger(objective.count) &&
          objective.count >= 1 &&
          objective.count <= 3,
        'objective count',
      );
      check(
        objective.template.hp > 0 &&
          objective.template.attackRange > 0 &&
          objective.template.moveSpeed > 0,
        'objective template',
      );
      time(objective.spawnAtMs, 'objective spawn', true);
      time(objective.template.attackIntervalMs, 'objective attack interval');
      if (objective.respawnDelayMs !== null)
        time(objective.respawnDelayMs, 'objective respawn');
      if (objective.despawnAtMs !== null) {
        time(objective.despawnAtMs, 'objective despawn');
        check(
          objective.despawnAtMs > objective.spawnAtMs,
          'objective despawn precedes spawn',
        );
      }
    }
    for (const key of [
      'OUTER',
      'INNER',
      'BASE',
      'INHIBITOR',
      'NEXUS_TURRET',
      'NEXUS',
    ] as const) {
      const structure = env.structures[key];
      check(!!structure && structure.hp > 0, 'structure HP');
      time(structure.attackIntervalMs, 'structure interval');
    }
    check(
      env.plateThresholds.length > 0 &&
        env.plateThresholds.every(
          (n, i, all) => n > 0 && n <= 1 && (i === 0 || n > all[i - 1]),
        ),
      'plate thresholds',
    );
    for (const key of [
      'elderFirstDelayMs',
      'baronBuffMs',
      'elderBuffMs',
      'inhibitorRespawnMs',
      'nexusTurretRespawnMs',
      'outerDecayStepMs',
      'overgrowthCooldownMs',
      'overgrowthRampMs',
    ] as const)
      time(env[key], key);
    check(
      env.nexusTurretRespawnHpFraction > 0 &&
        env.nexusTurretRespawnHpFraction <= 1 &&
        env.backdoorDamageMultiplier <= 1,
      'structure fractions',
    );
  }
  if (rules.vision) {
    const vision = rules.vision;
    numericTree(vision, 'vision');
    for (const key of ['placementRange', 'radius', 'scanRadius'] as const)
      check(Number.isFinite(vision[key]) && vision[key] > 0, `vision.${key}`);
    for (const key of [
      'rechargeMs',
      'placementMs',
      'lifetimeMs',
      'scanDurationMs',
      'scanCooldownMs',
      'memoryMs',
    ] as const)
      time(vision[key], key);
    check(
      Number.isSafeInteger(vision.charges) &&
        vision.charges > 0 &&
        vision.charges <= 10,
      'ward charges',
    );
    check(
      Number.isSafeInteger(vision.maxWardsPerActor) &&
        vision.maxWardsPerActor > 0 &&
        vision.maxWardsPerActor <= 10,
      'ward cap',
    );
  }
  if (rules.abilities) {
    numericTree(rules.abilities, 'abilities');
    check(
      Number.isFinite(rules.abilities.manaRegenPerSecond) &&
        rules.abilities.manaRegenPerSecond >= 0,
      'abilities.manaRegenPerSecond',
    );
    check(
      Number.isFinite(rules.abilities.damageMultiplier) &&
        rules.abilities.damageMultiplier >= 0,
      'abilities.damageMultiplier',
    );
    check(
      typeof rules.abilities.enabled === 'boolean' &&
        rules.abilities.modelVersion === 'CLASS_ACTION_SLOTS_V1',
      'ability model',
    );
    check(rules.abilities.damageMultiplier <= 3, 'ability multiplier');
  }
  if (rules.roleQuests) {
    numericTree(rules.roleQuests, 'roleQuests');
    for (const role of ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const)
      check(
        Number.isSafeInteger(rules.roleQuests.targets[role]) &&
          rules.roleQuests.targets[role] > 0 &&
          Number.isFinite(rules.roleQuests.completionGold[role]) &&
          Number.isFinite(rules.roleQuests.completionXp[role]),
        'role quest definition',
      );
    time(rules.roleQuests.midRecallMs, 'empowered recall');
  }
}
