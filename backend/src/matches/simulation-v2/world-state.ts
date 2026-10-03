import {
  ENGINE_VERSION,
  type EngineInput,
  type EngineState,
  type ActorState,
  type CombatProfile,
  type UnitTemplate,
  type MapDefinition,
  type Point,
} from './contracts';
import { canonicalHash, createRandomStreams } from './seeded-rng';
import { hasLineOfSight, isWalkable } from './map-paths';
import { validateBattleRules } from './battle-validation';
import { validateMeta } from './tactics';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { getActionSlots } from './effects';

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid simulation input: ${message}`);
}
const integer = (value: number, min: number, max: number) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const nonnegative = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const PROFILE_FIELDS = [
  'maxHp',
  'maxMana',
  'attackDamage',
  'armor',
  'attackRange',
  'attackIntervalMs',
  'moveSpeed',
  'visionRange',
  'hpPerLevel',
  'attackPerLevel',
] as const satisfies readonly (keyof CombatProfile)[];
const TEMPLATE_FIELDS = [
  'hp',
  'attackDamage',
  'armor',
  'attackRange',
  'attackIntervalMs',
  'moveSpeed',
  'gold',
  'xp',
  'cs',
] as const satisfies readonly (keyof UnitTemplate)[];

function validateMap(map: MapDefinition): void {
  requireValue(
    !!map && typeof map.version === 'string' && map.version.length > 0,
    'map version',
  );
  requireValue(
    nonnegative(map.width) &&
      map.width > 0 &&
      nonnegative(map.height) &&
      map.height > 0,
    'map bounds',
  );
  requireValue(Array.isArray(map.walls), 'map walls');
  for (const wall of map.walls) {
    requireValue(
      !!wall &&
        [wall.x1, wall.y1, wall.x2, wall.y2].every(nonnegative) &&
        wall.x1 < wall.x2 &&
        wall.y1 < wall.y2 &&
        wall.x2 <= map.width &&
        wall.y2 <= map.height,
      'wall bounds/order',
    );
  }
  const walkable = (point: Point) =>
    !!point &&
    nonnegative(point.x) &&
    nonnegative(point.y) &&
    isWalkable(map, point);
  requireValue(
    !!map.bases && walkable(map.bases.BLUE) && walkable(map.bases.RED),
    'base must be walkable',
  );
  const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  requireValue(
    !samePoint(map.bases.BLUE, map.bases.RED),
    'bases must be distinct',
  );
  requireValue(!!map.lanes, 'map lanes');
  for (const lane of ['TOP', 'MID', 'BOT'] as const) {
    const route = map.lanes[lane];
    requireValue(
      Array.isArray(route) && route.length >= 2,
      `${lane} lane route`,
    );
    requireValue(route.every(walkable), `${lane} lane must be walkable`);
    requireValue(
      samePoint(route[0], map.bases.BLUE) &&
        samePoint(route[route.length - 1], map.bases.RED),
      `${lane} lane must connect blue to red base`,
    );
    for (let index = 1; index < route.length; index++) {
      requireValue(
        !samePoint(route[index - 1], route[index]) &&
          hasLineOfSight(map, route[index - 1], route[index]),
        `${lane} lane segment crosses a wall or has no length`,
      );
    }
  }
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

/** This accepts small developer scenarios; the career adapter additionally requires 5v5. */
export function validateEngineInput(input: EngineInput): void {
  canonicalHash(input); // Reject non-JSON, NaN, Infinity and cyclic data before mutation.
  requireValue(
    input.schemaVersion === 1 && input.engineVersion === ENGINE_VERSION,
    'unsupported engine version',
  );
  requireValue(integer(input.seed, 0, 0xffffffff), 'seed');
  validateMap(input.map);
  const rules = input.rules;
  requireValue(
    rules.macroAi === undefined ||
      (['COORDINATED_V1', 'COORDINATED_V2'].includes(rules.macroAi) &&
        !!rules.environment),
    'unsupported macro AI policy',
  );
  requireValue(integer(rules.stepMs, 10, 1000), 'step duration');
  for (const value of [
    rules.decisionIntervalMs,
    rules.snapshotIntervalMs,
    rules.maxHorizonMs,
    rules.recallMs,
    rules.waveIntervalMs,
  ]) {
    requireValue(
      integer(value, rules.stepMs, 3_600_000) && value % rules.stepMs === 0,
      'aligned time interval',
    );
  }
  requireValue(
    rules.maxHorizonMs <= (rules.environment ? 3_600_000 : 600_000),
    'lab horizon is at most ten minutes',
  );
  requireValue(
    !!rules.environment || rules.capabilities.nexusVictory === 'UNSUPPORTED',
    'this lab cannot commit a winner',
  );
  validateBattleRules(input);
  if (input.meta) validateMeta(input.meta);
  for (const value of [
    rules.recallMs,
    rules.respawnBaseMs,
    rules.respawnPerLevelMs,
    rules.respawnPerMinuteMs,
    rules.waveStartMs,
    rules.campSpawnTimesMs.standard,
    rules.campSpawnTimesMs.delayed,
    rules.campRespawnMs,
    rules.passiveGoldStartMs,
  ]) {
    requireValue(
      integer(value, 0, 3_600_000) && value % rules.stepMs === 0,
      'aligned lifecycle timing',
    );
  }
  requireValue(
    1000 % rules.stepMs === 0,
    'step must divide passive income seconds',
  );
  requireValue(
    [
      rules.fountainRadius,
      rules.fountainHpPerSecond,
      rules.fountainManaPerSecond,
      rules.startingGold,
      rules.passiveGoldPerSecond,
      rules.killGold,
      rules.killXp,
      rules.assistGold,
      rules.assistWindowMs,
      rules.xpRadius,
      rules.campLeashRadius,
    ].every(nonnegative),
    'economy/recovery values',
  );
  requireValue(
    integer(rules.minionsPerWave, 1, 12) && integer(rules.maxLevel, 1, 30),
    'resource/level limits',
  );
  requireValue(
    rules.levelXp.length === rules.maxLevel &&
      rules.levelXp[0] === 0 &&
      rules.levelXp.every(
        (value, index) =>
          nonnegative(value) &&
          (index === 0 || value > rules.levelXp[index - 1]),
      ),
    'XP curve',
  );
  for (const template of [rules.minion, rules.camp]) {
    requireValue(
      TEMPLATE_FIELDS.every((key) => nonnegative(template?.[key])) &&
        template.hp > 0 &&
        template.moveSpeed > 0 &&
        template.attackRange > 0 &&
        integer(template.attackIntervalMs, rules.stepMs, 3_600_000) &&
        template.attackIntervalMs % rules.stepMs === 0 &&
        integer(template.cs, 0, 100),
      'resource template',
    );
  }
  requireValue(
    new Set(rules.items.map((item) => item.id)).size === rules.items.length &&
      rules.items.every(
        (item) =>
          !!item.id &&
          [item.cost, item.attackDamage, item.maxHp, item.armor].every(
            nonnegative,
          ),
      ),
    'item definitions',
  );
  requireValue(
    input.teams.length === 2 &&
      new Set(input.teams.map((t) => t.side)).size === 2 &&
      new Set(input.teams.map((t) => t.teamId)).size === 2,
    'two distinct sides/teams required',
  );
  requireValue(
    input.teams.every((t) => t.side === 'BLUE' || t.side === 'RED'),
    'side',
  );
  requireValue(
    input.teams.every(
      (team) =>
        integer(team.teamId, 1, Number.MAX_SAFE_INTEGER) &&
        [team.strategyProficiency, team.chemistry].every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 100,
        ) &&
        Object.values(TeamStrategy).includes(team.strategy as TeamStrategy),
    ),
    'team identity/strategy/proficiency',
  );
  requireValue(
    input.actors.length >= 2 && input.actors.length <= 10,
    'actor count',
  );
  requireValue(
    new Set(input.actors.map((a) => a.actorId)).size === input.actors.length,
    'duplicate actor',
  );
  requireValue(
    new Set(input.actors.map((a) => a.careerPlayerId)).size ===
      input.actors.length,
    'duplicate career player',
  );
  for (const side of ['BLUE', 'RED'] as const) {
    requireValue(
      input.actors.some((a) => a.side === side),
      'each team needs a participant',
    );
  }
  for (const actor of input.actors) {
    requireValue(
      /^[a-zA-Z0-9:_-]{1,160}$/.test(actor.actorId) &&
        !['__proto__', 'prototype', 'constructor'].includes(actor.actorId) &&
        !!actor.championId,
      'actor identity',
    );
    requireValue(
      input.teams.some(
        (t) => t.side === actor.side && t.teamId === actor.teamId,
      ),
      'actor team',
    );
    requireValue(
      ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'].includes(actor.position),
      'position',
    );
    requireValue(
      (
        [
          'mechanics',
          'gameSense',
          'laning',
          'teamFight',
          'macro',
          'teamPlay',
          'mental',
          'championPool',
        ] as const
      ).every((key) => {
        const n = actor.playerStats[key];
        return Number.isFinite(n) && n >= 0 && n <= 119;
      }),
      'player stats',
    );
    requireValue(
      [actor.form, actor.condition, actor.positionProficiency].every(
        (n) => Number.isFinite(n) && n >= 0 && n <= 100,
      ),
      'player state',
    );
    requireValue(
      actor.roleProficiency === null || integer(actor.roleProficiency, 0, 100),
      'role proficiency',
    );
    requireValue(
      actor.execution >= 0 &&
        actor.execution <= 1.19 &&
        actor.aggression >= 0 &&
        actor.aggression <= 1 &&
        actor.risk >= 0 &&
        actor.risk <= 1 &&
        actor.teamwork >= 0 &&
        actor.teamwork <= 1,
      'execution model',
    );
    if (rules.abilities?.enabled) getActionSlots(actor.championId);
    requireValue(
      PROFILE_FIELDS.every((key) => nonnegative(actor.profile?.[key])),
      'combat profile',
    );
    requireValue(
      actor.profile.maxHp > 0 &&
        actor.profile.moveSpeed > 0 &&
        actor.profile.attackRange > 0 &&
        integer(actor.profile.attackIntervalMs, rules.stepMs, 3_600_000) &&
        actor.profile.attackIntervalMs % rules.stepMs === 0,
      'combat limits',
    );
  }
}

export function createWorldState(input: EngineInput): EngineState {
  validateEngineInput(input);
  const frozenInput: EngineInput = freezeTree(structuredClone(input));
  const actors: ActorState[] = frozenInput.actors.map((actor) => ({
    id: actor.actorId,
    kind: 'CHAMPION',
    side: actor.side,
    input: actor,
    position: { ...frozenInput.map.bases[actor.side] },
    origin: { ...frozenInput.map.bases[actor.side] },
    lane: null,
    hp: actor.profile.maxHp,
    maxHp: actor.profile.maxHp,
    armor: actor.profile.armor,
    attackDamage: actor.profile.attackDamage,
    attackRange: actor.profile.attackRange,
    attackIntervalMs: actor.profile.attackIntervalMs,
    moveSpeed: actor.profile.moveSpeed,
    nextAttackAtMs: 0,
    path: [],
    active: true,
    spawnAtMs: 0,
    respawnAtMs: null,
    generation: 0,
    reward: { gold: 0, xp: 0, cs: 0 },
    mana: actor.profile.maxMana,
    maxMana: actor.profile.maxMana,
    action: { kind: 'IDLE' },
    plan: null,
    level: 1,
    xp: 0,
    gold: 0,
    items: [],
    stats: {
      kills: 0,
      deaths: 0,
      assists: 0,
      cs: 0,
      damageToChampions: 0,
      damageTaken: 0,
      goldEarned: 0,
      goldSpent: 0,
      xpEarned: 0,
    },
    lastDamagedAtMs: null,
  }));
  return {
    schemaVersion: 1,
    input: frozenInput,
    inputHash: canonicalHash(frozenInput),
    simTimeMs: 0,
    started: false,
    status: 'RUNNING',
    winnerTeamId: null,
    error: null,
    rng: createRandomStreams(input.seed),
    actors,
    units: [],
    events: [],
    ledger: [],
    rewardKeys: {},
    observations: { BLUE: {}, RED: {} },
    damageContributors: {},
    commands: [],
    commandIds: {},
    nextWaveAtMs: input.rules.waveStartMs,
    waveNumber: 0,
    nextDecisionAtMs: 0,
    nextSnapshotAtMs: 0,
    nextPassiveGoldAtMs: input.rules.passiveGoldStartMs,
    objectivesAnnounced: {},
    frames: [],
    at15: null,
  };
}

export interface SimulationCheckpoint {
  checkpointVersion: 1;
  hash: string;
  state: EngineState;
}

export function checkpoint(state: EngineState): SimulationCheckpoint {
  const snapshot = structuredClone(state);
  return {
    checkpointVersion: 1,
    hash: canonicalHash(snapshot),
    state: snapshot,
  };
}

/** Synchronous serialization needs no detached object graph: the caller cannot
 * advance the engine before this returns. Keep the v1 canonical integrity hash
 * and JSON format, but avoid copying all historical events/frames first. */
export function serializeCheckpoint(state: EngineState): string {
  return JSON.stringify({
    checkpointVersion: 1,
    hash: canonicalHash(state),
    state,
  } satisfies SimulationCheckpoint);
}

export function restoreCheckpoint(saved: SimulationCheckpoint): EngineState {
  if (
    saved.checkpointVersion !== 1 ||
    canonicalHash(saved.state) !== saved.hash
  ) {
    throw new Error('Corrupt or unsupported simulation checkpoint');
  }
  validateEngineInput(saved.state.input);
  if (
    canonicalHash(saved.state.input) !== saved.state.inputHash ||
    saved.state.schemaVersion !== 1
  ) {
    throw new Error('Checkpoint input does not match its pinned environment');
  }
  if (
    !integer(saved.state.simTimeMs, 0, saved.state.input.rules.maxHorizonMs) ||
    saved.state.simTimeMs % saved.state.input.rules.stepMs !== 0
  ) {
    throw new Error('Invalid checkpoint time');
  }
  const restored = structuredClone(saved.state);
  freezeTree(restored.input);
  restored.actors.forEach((actor) => freezeTree(actor.input));
  return restored;
}
