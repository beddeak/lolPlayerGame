import type { Point, Side, UnitTemplate } from './contracts';

export type ObjectiveType = 'DRAGON' | 'GRUB' | 'HERALD' | 'BARON' | 'ELDER';
export type StructureType =
  'OUTER' | 'INNER' | 'BASE' | 'INHIBITOR' | 'NEXUS_TURRET' | 'NEXUS';

export interface ObjectiveDefinition {
  type: ObjectiveType;
  pit: 'VOID' | 'DRAGON';
  position: Point;
  spawnAtMs: number;
  despawnAtMs: number | null;
  respawnDelayMs: number | null;
  count: number;
  template: UnitTemplate;
  teamGold: number;
  teamXp: number;
}

export interface EnvironmentRules {
  objectives: ObjectiveDefinition[];
  objectiveLeashRadius: number;
  dragonSoulStacks: number;
  elderFirstDelayMs: number;
  baronBuffMs: number;
  elderBuffMs: number;
  objectiveBuffDamagePerDragon: number;
  soulDamageMultiplier: number;
  elderDamageMultiplier: number;
  baronMinionDamageMultiplier: number;
  baronEmpowerRadius: number;
  grubStructureDamagePerStack: number;
  heraldChargeDamage: number;
  heraldChargeRange: number;
  structures: Record<
    StructureType,
    {
      hp: number;
      armor: number;
      attackDamage: number;
      attackRange: number;
      attackIntervalMs: number;
      globalGold: number;
    }
  >;
  towerVision: number;
  backdoorRadius: number;
  backdoorDamageMultiplier: number;
  turretMinionDamageMultiplier: number;
  meleeTurretDamageMultiplier: number;
  plateThresholds: number[];
  plateGold: number;
  plateShareRadius: number;
  firstTurretGold: number;
  inhibitorRespawnMs: number;
  nexusTurretRespawnMs: number;
  nexusTurretRespawnHpFraction: number;
  outerDecayStartMs: number;
  outerDecayStepMs: number;
  outerArmorDecay: number;
  outerMaxArmorDecay: number;
  outerGoldDecay: number;
  outerMaxGoldDecay: number;
  overgrowthCooldownMs: number;
  overgrowthRampDelayMs: number;
  overgrowthRampMs: number;
}

export interface ObjectiveState {
  type: ObjectiveType;
  pit: 'VOID' | 'DRAGON';
  definitionIndex: number;
  despawnAtMs: number | null;
  respawnDelayMs: number | null;
}

export interface StructureState {
  type: StructureType;
  prerequisiteIds: string[];
  platesClaimed: number;
  overgrowthStartedAtMs: number | null;
  overgrowthActive: boolean;
}

export interface TeamEnvironmentState {
  dragons: number;
  grubs: number;
  heraldCharges: number;
  baronUntilMs: number;
  elderUntilMs: number;
  /** Buff disappears on each recipient's death; team expiry alone never restores it. */
  baronRecipients: string[];
  elderRecipients: string[];
}

export interface EnvironmentState {
  teams: Record<Side, TeamEnvironmentState>;
  firstTurretClaimed: boolean;
  soulSide: Side | null;
  elderAvailableAtMs: number | null;
}
