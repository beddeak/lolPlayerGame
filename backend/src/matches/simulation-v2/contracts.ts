import type {
  SimpleMatchPlayerInput,
  SimpleMatchTeamInput,
} from '../simulation/simple-match.types';
import type {
  EnvironmentRules,
  EnvironmentState,
  ObjectiveState,
  StructureState,
} from './environment-types';
import type { VisionRules, VisionState } from './vision';
import type { AbilityRules, CombatState } from './effects';
import type { MetaEnvironment } from './tactics';
import type { RoleQuestRules, RoleQuestState } from './role-quests';

/** Pure, JSON-serializable contracts. No account, repository or wall-clock data. */
export type Side = 'BLUE' | 'RED';
export type Lane = 'TOP' | 'MID' | 'BOT';
export type SimPosition = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT';
export interface Point {
  x: number;
  y: number;
}
export interface MapDefinition {
  version: string;
  width: number;
  height: number;
  bases: Record<Side, Point>;
  lanes: Record<Lane, Point[]>;
  walls: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}
export type Capability = 'SUPPORTED' | 'APPROXIMATE' | 'UNSUPPORTED';
export interface CombatProfile {
  maxHp: number;
  maxMana: number;
  attackDamage: number;
  armor: number;
  attackRange: number;
  attackIntervalMs: number;
  moveSpeed: number;
  visionRange: number;
  hpPerLevel: number;
  attackPerLevel: number;
}
export interface ItemDefinition {
  id: string;
  cost: number;
  attackDamage: number;
  maxHp: number;
  armor: number;
}
export interface UnitTemplate {
  hp: number;
  attackDamage: number;
  armor: number;
  attackRange: number;
  attackIntervalMs: number;
  moveSpeed: number;
  gold: number;
  xp: number;
  cs: number;
}
export interface Ruleset {
  environment?: EnvironmentRules;
  vision?: VisionRules;
  abilities?: AbilityRules;
  roleQuests?: RoleQuestRules;
  version: string;
  sourcePatch: string;
  capabilities: Record<string, Capability>;
  provenance: Record<string, string>;
  stepMs: number;
  decisionIntervalMs: number;
  snapshotIntervalMs: number;
  maxHorizonMs: number;
  recallMs: number;
  fountainRadius: number;
  fountainHpPerSecond: number;
  fountainManaPerSecond: number;
  respawnBaseMs: number;
  respawnPerLevelMs: number;
  respawnPerMinuteMs: number;
  startingGold: number;
  passiveGoldStartMs: number;
  passiveGoldPerSecond: number;
  killGold: number;
  killXp: number;
  assistGold: number;
  assistWindowMs: number;
  xpRadius: number;
  levelXp: number[];
  maxLevel: number;
  waveStartMs: number;
  waveIntervalMs: number;
  minionsPerWave: number;
  minion: UnitTemplate;
  camp: UnitTemplate;
  campSpawnTimesMs: { standard: number; delayed: number };
  campRespawnMs: number;
  campLeashRadius: number;
  items: ItemDefinition[];
  objectives: Array<{
    id: string;
    spawnAtMs: number;
    position: Point;
    capability: Capability;
  }>;
}
export interface ActorInput {
  sourcePlayer?: SimpleMatchPlayerInput;
  actorId: string;
  careerPlayerId: number;
  teamId: number;
  side: Side;
  position: SimPosition;
  championId: string;
  profile: CombatProfile;
  /** Preserve historical player values, separate from champion combat stats. */
  playerStats: {
    mechanics: number;
    gameSense: number;
    laning: number;
    teamFight: number;
    macro: number;
    teamPlay: number;
    mental: number;
    championPool: number;
  };
  form: number;
  condition: number;
  positionProficiency: number;
  roleProficiency: number | null;
  feedback: Record<string, number> | null;
  execution: number;
  aggression: number;
  risk: number;
  teamwork: number;
}
export interface TeamInput {
  sourceTeam?: SimpleMatchTeamInput;
  teamId: number;
  side: Side;
  strategy: string;
  strategyProficiency: number;
  chemistry: number;
}
export interface EngineInput {
  meta?: MetaEnvironment;
  controlMode?: 'AUTO' | 'SCRIPTED';
  context?: { careerId: number; seriesId: number; gameId: number };
  schemaVersion: 1;
  engineVersion: string;
  catalogVersion: string;
  balanceVersion: string;
  seed: number;
  rules: Ruleset;
  map: MapDefinition;
  teams: [TeamInput, TeamInput];
  actors: ActorInput[];
}
export type UnitKind =
  | 'CHAMPION'
  | 'MINION'
  | 'CAMP'
  | 'OBJECTIVE'
  | 'TURRET'
  | 'INHIBITOR'
  | 'NEXUS'
  | 'WARD';
export interface UnitState {
  turretAggro?: { targetId: string; untilMs: number };
  structure?: StructureState;
  objective?: ObjectiveState;
  id: string;
  kind: UnitKind;
  side: Side | null;
  position: Point;
  origin: Point;
  lane: Lane | null;
  hp: number;
  maxHp: number;
  armor: number;
  attackDamage: number;
  attackRange: number;
  attackIntervalMs: number;
  moveSpeed: number;
  nextAttackAtMs: number;
  path: Point[];
  active: boolean;
  spawnAtMs: number;
  respawnAtMs: number | null;
  generation: number;
  reward: { gold: number; xp: number; cs: number };
}
export type ActorAction =
  | { kind: 'IDLE' }
  | { kind: 'MOVE'; goal: Point }
  | { kind: 'ATTACK'; targetId: string }
  | { kind: 'RECALL'; completesAtMs: number }
  | { kind: 'DEAD'; respawnsAtMs: number };
export interface ActorStats {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damageToChampions: number;
  damageTaken: number;
  goldEarned: number;
  goldSpent: number;
  xpEarned: number;
}
export interface ActorPlan {
  kind:
    | 'LANE'
    | 'JUNGLE'
    | 'GANK'
    | 'RETREAT'
    | 'RECOVER'
    | 'COVER'
    | 'OBJECTIVE'
    | 'SETUP'
    | 'TRADE'
    | 'SIEGE'
    | 'DEFEND';
  point: Point;
  targetId: string | null;
  reason: string;
  createdAtMs: number;
  expiresAtMs: number;
  /** Bounded own-team intent memory; survives a short local fight, never overrides danger. */
  siegeLane?: {
    lane: Lane;
    targetId: string;
    createdAtMs: number;
    expiresAtMs: number;
  };
  objectiveBackoff?: { id: string; untilMs: number };
}
export interface ActorState extends UnitState {
  kind: 'CHAMPION';
  side: Side;
  input: ActorInput;
  mana: number;
  maxMana: number;
  action: ActorAction;
  plan: ActorPlan | null;
  level: number;
  xp: number;
  gold: number;
  items: string[];
  stats: ActorStats;
  lastDamagedAtMs: number | null;
}
export interface UnitView {
  id: string;
  kind: UnitKind;
  side: Side | null;
  position: Point;
  hp: number;
  maxHp: number;
  active: boolean;
  attackRange: number;
}
export interface Observation {
  friendlyWards?: UnitView[];
  friendlyStructures?: UnitView[];
  estimates?: Array<{
    unitId: string;
    lastPosition: Point;
    lastSeenAtMs: number;
    source: 'CURRENT_VISION' | 'LAST_SEEN';
    confidence: number;
    uncertaintyRadius: number;
  }>;
  atMs: number;
  side: Side;
  allies: ActorState[];
  /** Publicly known allied wave positions; never a proxy for hidden enemies. */
  friendlyMinions?: UnitView[];
  visible: UnitView[];
  remembered: Array<{ atMs: number; unit: UnitView }>;
}
export type Intent =
  | { kind: 'WARD'; actorId: string; point: Point; reason: string }
  | { kind: 'SWEEP'; actorId: string; reason: string }
  | {
      kind: 'CAST';
      actorId: string;
      slotId: string;
      targetId?: string;
      point?: Point;
      reason: string;
    }
  | { kind: 'MOVE'; actorId: string; point: Point; reason: string }
  | { kind: 'ATTACK'; actorId: string; targetId: string; reason: string }
  | { kind: 'RECALL'; actorId: string; reason: string }
  | { kind: 'HOLD'; actorId: string; reason: string };
export interface ScheduledCommand {
  id: string;
  atMs: number;
  intent: Intent;
}
export interface SimEvent {
  seq: number;
  atMs: number;
  kind:
    | 'SPAWN'
    | 'MOVE'
    | 'ARRIVE'
    | 'ATTACK'
    | 'DAMAGE'
    | 'DEATH'
    | 'RESPAWN'
    | 'RECALL_START'
    | 'RECALL_CANCEL'
    | 'RECALL_COMPLETE'
    | 'REWARD'
    | 'PURCHASE'
    | 'LEVEL_UP'
    | 'PLAN'
    | 'REJECTED'
    | 'OBJECTIVE_AVAILABLE'
    | 'CAMP_RESET'
    | 'OBJECTIVE_RESET'
    | 'OBJECTIVE_CAPTURED'
    | 'OBJECTIVE_DESPAWN'
    | 'PLATE'
    | 'STRUCTURE_DESTROYED'
    | 'NEXUS_DESTROYED'
    | 'BUFF'
    | 'BUFF_EXPIRE'
    | 'WARD_START'
    | 'WARD_CANCEL'
    | 'WARD_PLACED'
    | 'WARD_EXPIRE'
    | 'SWEEP'
    | 'CAST_START'
    | 'CAST_CANCEL'
    | 'CAST_RELEASE'
    | 'SHIELD'
    | 'SHIELD_ABSORB'
    | 'HEAL'
    | 'CONTROL'
    | 'EFFECT_EXPIRE'
    | 'REPOSITION'
    | 'CAST_COMPLETE'
    | 'CAST_MISS'
    | 'EFFECT_APPLIED'
    | 'EFFECT_EXPIRED'
    | 'SHIELD_ABSORBED'
    | 'CAST_PROJECTILE'
    | 'OVERGROWTH'
    | 'HERALD_CHARGE'
    | 'QUEST_PROGRESS'
    | 'QUEST_COMPLETE';
  actorId?: string;
  targetId?: string;
  amount?: number;
  reason?: string;
  position?: Point;
  sourceId?: string;
}
export interface LedgerEntry {
  key: string;
  seq: number;
  atMs: number;
  actorId: string;
  sourceId: string;
  gold: number;
  xp: number;
  cs: number;
  kind:
    | 'STARTING'
    | 'KILL'
    | 'ASSIST'
    | 'MINION'
    | 'CAMP'
    | 'PASSIVE'
    | 'PURCHASE'
    | 'OBJECTIVE'
    | 'STRUCTURE'
    | 'PLATE'
    | 'QUEST';
}
export interface ReplayFrame {
  atMs: number;
  actors: Array<{
    id: string;
    position: Point;
    hp: number;
    maxHp: number;
    level: number;
    gold: number;
    cs: number;
    active: boolean;
    action: ActorAction['kind'];
    path: Point[];
    moveSpeed: number;
  }>;
  units: Array<{
    id: string;
    kind: UnitKind;
    side: Side | null;
    position: Point;
    hp: number;
    maxHp: number;
    path: Point[];
    moveSpeed: number;
  }>;
}
export interface EngineState {
  environment?: EnvironmentState;
  vision?: VisionState;
  combat?: CombatState;
  roleQuests?: RoleQuestState;
  schemaVersion: 1;
  input: EngineInput;
  inputHash: string;
  simTimeMs: number;
  started: boolean;
  status: 'RUNNING' | 'HORIZON_REACHED' | 'ERROR' | 'FINISHED';
  winnerTeamId: number | null;
  error: string | null;
  rng: { world: number; decision: number; combat: number };
  actors: ActorState[];
  units: UnitState[];
  events: SimEvent[];
  ledger: LedgerEntry[];
  rewardKeys: Record<string, true>;
  observations: Record<Side, Record<string, { atMs: number; unit: UnitView }>>;
  damageContributors: Record<string, Record<string, number>>;
  commands: ScheduledCommand[];
  commandIds: Record<string, true>;
  nextWaveAtMs: number;
  waveNumber: number;
  nextDecisionAtMs: number;
  nextSnapshotAtMs: number;
  nextPassiveGoldAtMs: number;
  objectivesAnnounced: Record<string, true>;
  frames: ReplayFrame[];
  at15: Record<string, { goldEarned: number; cs: number }> | null;
}

export const ENGINE_VERSION = 'tactical-core-3';
export const opposite = (side: Side): Side =>
  side === 'BLUE' ? 'RED' : 'BLUE';
export const actorLane = (position: SimPosition): Lane =>
  position === 'TOP' ? 'TOP' : position === 'MID' ? 'MID' : 'BOT';
export function emit(
  state: EngineState,
  event: Omit<SimEvent, 'seq' | 'atMs'>,
): SimEvent {
  const value = {
    ...event,
    seq: state.events.length + 1,
    atMs: state.simTimeMs,
  };
  state.events.push(value);
  return value;
}

/** Death checks are local to this resolution window, not a scan of a whole match. */
export function hasCurrentDeathEvent(
  state: EngineState,
  targetId: string,
): boolean {
  for (let index = state.events.length - 1; index >= 0; index--) {
    const event = state.events[index];
    if (event.atMs < state.simTimeMs) return false;
    if (event.kind === 'DEATH' && event.targetId === targetId) return true;
  }
  return false;
}
