import type { Ruleset } from './contracts';
import { createRuleset } from './ruleset';
import { createEnvironmentRules } from './environment-rules';
import { MODEL_VISION_RULES } from './vision';
import { MODEL_ABILITY_RULES } from './effects';
import { createRoleQuestRules } from './role-quests';

/** Opt-in full-map developer simulation. Never replaces a persisted legacy match. */
export function createBattleRuleset(): Ruleset {
  const rules = createRuleset();
  rules.version = 'CLASSIC_SR_26_1_BATTLE_APPROX_V2';
  rules.maxHorizonMs = 3_600_000;
  rules.environment = createEnvironmentRules();
  rules.vision = structuredClone(MODEL_VISION_RULES);
  rules.abilities = structuredClone(MODEL_ABILITY_RULES);
  rules.roleQuests = createRoleQuestRules();
  // Real objective bodies replace the early-game marker-only schedule.
  rules.objectives = [];
  Object.assign(rules.capabilities, {
    visionResources: 'APPROXIMATE',
    inference: 'APPROXIMATE',
    championAbilities: 'APPROXIMATE',
    summonerSpells: 'APPROXIMATE',
    roleQuests: 'APPROXIMATE',
    turretPlates: 'APPROXIMATE',
    crystallineOvergrowth: 'APPROXIMATE',
    objectiveCombat: 'APPROXIMATE',
    structures: 'APPROXIMATE',
    nexus: 'SUPPORTED',
    nexusVictory: 'SUPPORTED',
    strategyDecisions: 'APPROXIMATE',
    neutralMeta: 'SUPPORTED',
  });
  Object.assign(rules.provenance, {
    modelRevision:
      'tactical-full-map-model-2; opt-in, non-committing; no complete Riot ability or item replica.',
    simulation:
      'MODEL: 100ms simultaneous resolver, 1s decisions, 2s playback frames; 60min horizon is INCOMPLETE, never a winner.',
    objectiveTimes:
      '26.1/25.09 referenced Grubs 8min, Herald 15min, Baron 20min. Dragon 5min/5min respawn and Elder 6min after soul are pinned MODEL timings; see environment-rules.ts.',
    unresolvedObjectives:
      'Dragon/Elder damage, HP, rewards, reset, soul/buffs are bounded MODEL values, not an audited live patch replica. Nexus plates remain unsupported.',
    recovery:
      'MODEL: existing level/time death timer; fountain only HP recovery. No kill-to-heal. Only model skills consume/regenerate generic mana.',
    recallMs:
      'Ordinary 8s recall; operational MID quest completion gives 5.5s recall, canceled by damage or control.',
    waves:
      'MODEL: six units per wave with time-scaled HP/AD; one super minion while opposing lane inhibitor is down. No cannon composition/real minion scaling.',
    visionResources:
      'MODEL: finite regenerating ward charges; placement time/range/LOS, expiring 3-hit wards, scanner detection. Enemy locations are last-seen estimates, never current hidden coordinates.',
    championAbilities:
      'MODEL: class-derived strike/control/guard/reposition slots from the real catalog. Not named champion Q/W/E/R. Range, mana, cooldown, wind-up and projectile lifecycle use shared resolver.',
    summonerSpells:
      'MODEL: jungle Smite only. No Flash or Teleport in this ruleset.',
    roleQuests:
      'MODEL partial: event/ledger CS, kills, assists, plates, wards progress; one-time XP/gold or empowered recall. No extra max level, boots, support income item, or full live scoring table.',
    items:
      'MODEL: six unique inventory items bought at fountain; later items provide actual AD/HP/armor. No wallet-to-power conversion or real build tree.',
    meta: 'Only NEUTRAL_TACTICAL_V1 accepted. Strategy/mastery affect observation-based decisions/arrival tolerance once; no hidden damage or win-rate buff.',
  });
  rules.items.push(
    { id: 'MODEL_WEAPON', cost: 1800, attackDamage: 65, maxHp: 0, armor: 0 },
    { id: 'MODEL_ARMOR', cost: 1500, attackDamage: 0, maxHp: 450, armor: 35 },
    {
      id: 'MODEL_CAPSTONE',
      cost: 2600,
      attackDamage: 90,
      maxHp: 200,
      armor: 0,
    },
  );
  return rules;
}
