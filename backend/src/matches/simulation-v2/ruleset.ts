import type { Ruleset } from './contracts';

const PATCH_26_1 =
  'https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/';
const PATCH_25_09 =
  'https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-09-notes/';

/**
 * This is a development model, not a complete or current Riot ruleset.
 * The capability/provenance records are part of every frozen game input.
 */
export const CLASSIC_SR_26_1_APPROX_V1: Ruleset = {
  version: 'CLASSIC_SR_26_1_APPROX_V1',
  sourcePatch: '26.1',
  capabilities: {
    pathMovement: 'APPROXIMATE',
    observation: 'APPROXIMATE',
    basicAttacks: 'APPROXIMATE',
    recall: 'APPROXIMATE',
    waves: 'APPROXIMATE',
    jungleCamps: 'APPROXIMATE',
    economy: 'APPROXIMATE',
    items: 'APPROXIMATE',
    championAbilities: 'UNSUPPORTED',
    championResourceTypes: 'UNSUPPORTED',
    summonerSpells: 'UNSUPPORTED',
    roleQuests: 'UNSUPPORTED',
    turretPlates: 'UNSUPPORTED',
    nexusTurretPlates: 'UNSUPPORTED',
    crystallineOvergrowth: 'UNSUPPORTED',
    faelights: 'UNSUPPORTED',
    objectiveCombat: 'UNSUPPORTED',
    structures: 'UNSUPPORTED',
    nexus: 'UNSUPPORTED',
    nexusVictory: 'UNSUPPORTED',
    setBonusCombatEffects: 'UNSUPPORTED',
    championMastery: 'UNSUPPORTED',
  },
  provenance: {
    gameMode:
      'Classic Summoner Rift; not Swiftplay, ARAM or a full live patch replica.',
    modelRevision:
      'tactical-early-game-model-1; explicit development approximations.',
    timings:
      `${PATCH_26_1} Game Start Time: wave 30000ms; wolves/blue/red/raptors 55000ms; ` +
      'krugs/gromp 67000ms; scuttle 175000ms; Baron 1200000ms; passive gold starts 65000ms.',
    recallMs: `${PATCH_26_1} Mid Lane: ordinary recall 8000ms. Empowered recall is unsupported.`,
    objectiveTimes:
      `${PATCH_25_09} Void Epic Monsters: grubs 480000ms without respawn, Herald 900000ms. ` +
      `${PATCH_26_1} retains other epic timings. Intervening patch chain is not fully audited. ` +
      'Spawn markers only; no damage, reward or objective capture in this model.',
    unresolvedObjectives:
      'Dragon/Elder lifecycle is not verified here: omitted rather than invented. ' +
      'Nexus turret plate statements conflict within 26.1 and are unsupported.',
    simulation:
      'MODEL: 100ms resolution, 1000ms decisions, 2000ms playback samples, 600000ms horizon. ' +
      'Horizon never awards a winner. Map coordinates are game world units, not CSS pixels.',
    recovery:
      'MODEL: fountain radius 280, recovery 180 HP/s and 120 generic resource/s. ' +
      'Respawn = 6000ms + level*2000ms + elapsedMinutes*500ms; not the Riot death timer table.',
    economy:
      'MODEL: initial wallet 500, passive 2 gold/s, kill 300 gold/180 XP, ' +
      'assist gold pool 100 and 10000ms contribution window; no bounty system. ' +
      'XP radius 1400 and cumulative level thresholds below are explicit approximations.',
    waves:
      'MODEL: every 30000ms, six identical units worth 20 gold/55 XP/1 CS. ' +
      'No cannon/super composition or support sharing; all template stats are approximations. ' +
      'The 10 minute development horizon excludes the 14/30 minute cadence changes.',
    camps:
      'MODEL: one aggregate unit per camp, 500 HP/100 gold/120 XP/4 CS, ' +
      '135000ms respawn and 650 leash radius for every camp. Not species-specific Riot values.',
    items:
      'MODEL: generic blade/vest/vitality purchases below. Not actual champion item builds; ' +
      'only bought inventory grants effects, unused wallet gold does not.',
    championCatalog:
      'Existing 16.19.1 local champion data is pinned independently of 26.1 map timing. ' +
      'Health/attack/armor/range are reused; resource, growth, cadence, speed and vision are game approximations.',
    execution:
      'MODEL: mechanics/gameSense/laning weights .5/.3/.2 divided by 100; ' +
      'condition multiplier .75 + condition*.0025; form delta /1000; ' +
      'feedback confidence*.12 + motivation*.1 - pressure*.2 + carryBonus, divided by 100. ' +
      'Position proficiency multiplies execution by .6 + .4*proficiency/100; ' +
      'known role proficiency by .94 + .06*proficiency/100 (null stays neutral, never invented). ' +
      'Final execution bounded 0..1.19. Raw 0..119 stats remain unchanged.',
    personality:
      'MODEL: aggression .42 + (mechanics-gameSense)/500 + feedback.aggression/100; ' +
      'risk .3 + (100-effectiveMental)/300 + feedback.riskTaking/100 + feedback.pressure/200; ' +
      'teamwork teamPlay/119*.7 + chemistry/100*.3. All are bounded 0..1; these are not personality identities.',
  },
  stepMs: 100,
  decisionIntervalMs: 1000,
  snapshotIntervalMs: 2000,
  maxHorizonMs: 600_000,
  recallMs: 8000,
  fountainRadius: 280,
  fountainHpPerSecond: 180,
  fountainManaPerSecond: 120,
  respawnBaseMs: 6000,
  respawnPerLevelMs: 2000,
  respawnPerMinuteMs: 500,
  startingGold: 500,
  passiveGoldStartMs: 65_000,
  passiveGoldPerSecond: 2,
  killGold: 300,
  killXp: 180,
  assistGold: 100,
  assistWindowMs: 10_000,
  xpRadius: 1400,
  // Cumulative thresholds; this is an explicit development progression curve.
  levelXp: [
    0, 280, 660, 1140, 1720, 2400, 3180, 4060, 5040, 6120, 7300, 8580, 9960,
    11440, 13020, 14700, 16480, 18360,
  ],
  maxLevel: 18,
  waveStartMs: 30_000,
  waveIntervalMs: 30_000,
  minionsPerWave: 6,
  minion: {
    hp: 280,
    attackDamage: 12,
    armor: 0,
    attackRange: 220,
    attackIntervalMs: 1500,
    moveSpeed: 220,
    gold: 20,
    xp: 55,
    cs: 1,
  },
  camp: {
    hp: 500,
    attackDamage: 18,
    armor: 10,
    attackRange: 240,
    attackIntervalMs: 1500,
    moveSpeed: 160,
    gold: 100,
    xp: 120,
    cs: 4,
  },
  campRespawnMs: 135_000,
  campSpawnTimesMs: { standard: 55_000, delayed: 67_000 },
  campLeashRadius: 650,
  items: [
    { id: 'MODEL_BLADE', cost: 350, attackDamage: 12, maxHp: 0, armor: 0 },
    { id: 'MODEL_VEST', cost: 350, attackDamage: 0, maxHp: 0, armor: 15 },
    { id: 'MODEL_VITALITY', cost: 400, attackDamage: 0, maxHp: 150, armor: 0 },
  ],
  objectives: [
    {
      id: 'VOID_GRUBS',
      spawnAtMs: 480_000,
      position: { x: 3700, y: 3700 },
      capability: 'UNSUPPORTED',
    },
    {
      id: 'RIFT_HERALD',
      spawnAtMs: 900_000,
      position: { x: 3700, y: 3700 },
      capability: 'UNSUPPORTED',
    },
    {
      id: 'BARON',
      spawnAtMs: 1_200_000,
      position: { x: 3700, y: 3700 },
      capability: 'UNSUPPORTED',
    },
  ],
};

function freezeTemplate(value: object): void {
  Object.values(value).forEach((entry: unknown) => {
    if (entry !== null && typeof entry === 'object') freezeTemplate(entry);
  });
  Object.freeze(value);
}
freezeTemplate(CLASSIC_SR_26_1_APPROX_V1);

/** Return detached rules so neither callers nor a running game mutate the template. */
export function createRuleset(): Ruleset {
  return structuredClone(CLASSIC_SR_26_1_APPROX_V1);
}
