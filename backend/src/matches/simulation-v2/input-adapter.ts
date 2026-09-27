import { Position } from '../../players/enums/position.enum';
import {
  PLAYER_CARD_BASE_STAT_FIELDS,
  PLAYER_CARD_STAT_MAX,
} from '../../players/constants/player-card.constants';
import {
  RIOT_CHAMPIONS,
  RIOT_DATA_SOURCE,
  RIOT_DATA_VERSION,
} from '../../drafts/data/riot-champions';
import { CHAMPION_BALANCE_VERSION } from '../../drafts/champion-catalog';
import type {
  SimpleMatchPlayerInput,
  SimpleMatchTeamInput,
} from '../simulation/simple-match.types';
import type { NextSetFeedback } from '../../match-series/next-set-feedback';
import {
  ENGINE_VERSION,
  type ActorInput,
  type CombatProfile,
  type EngineInput,
  type MapDefinition,
  type Side,
} from './contracts';
import { createMap } from './map-paths';
import { createRuleset } from './ruleset';
import { createBattleRuleset } from './battle-rules';
import { createNeutralMeta } from './tactics';

export interface EnginePick {
  teamId: number;
  position: Position;
  championId: string;
}

export interface EngineInputOptions {
  battle?: boolean;
  careerId?: number;
  seriesId?: number;
  gameId?: number;
  seed: number;
  blueTeamId: number;
  teams: [SimpleMatchTeamInput, SimpleMatchTeamInput];
  picks: EnginePick[];
  map?: MapDefinition;
}

const champions = new Map(
  RIOT_CHAMPIONS.map((champion) => [champion.id, champion]),
);
const positions = Object.values(Position);
const feedbackKeys: Array<keyof NextSetFeedback> = [
  'mental',
  'form',
  'confidence',
  'motivation',
  'pressure',
  'aggression',
  'riskTaking',
  'carryBonus',
];
const bound = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function numeric(value: number, name: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(
      `Invalid simulation input: ${name} must be in ${min}..${max}`,
    );
}

function identifier(value: number, name: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new Error(
      `Invalid simulation input: ${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`,
    );
}

/** Undefined optional object properties are omitted, never coerced to stats or mastery. */
function jsonSnapshot<T>(value: T, path = 'snapshot'): T {
  const visit = (entry: unknown, entryPath: string): unknown => {
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean'
    )
      return entry;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry))
        throw new Error(`Invalid simulation input: ${entryPath} is not finite`);
      return entry;
    }
    if (Array.isArray(entry))
      return entry.map((child, i) => visit(child, `${entryPath}[${i}]`));
    if (typeof entry === 'object') {
      // structuredClone may create plain objects in another VM realm (e.g. Jest).
      const prototype = Object.getPrototypeOf(entry) as object | null;
      if (prototype === null || Object.getPrototypeOf(prototype) === null) {
        return Object.fromEntries(
          Object.entries(entry)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, visit(child, `${entryPath}.${key}`)]),
        );
      }
    }
    throw new Error(`Invalid simulation input: ${entryPath} is not JSON data`);
  };
  return visit(value, path) as T;
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach((child: unknown) => freezeTree(child));
    Object.freeze(value);
  }
  return value;
}

/** Real base fields from the pinned catalog; other combat behavior is explicitly approximate. */
export function createCombatProfile(championId: string): CombatProfile {
  const champion = champions.get(championId);
  if (!champion)
    throw new Error(`Unsupported champion in tactical model: ${championId}`);
  return {
    maxHp: champion.health,
    maxMana: 300,
    attackDamage: champion.attack,
    armor: champion.armor,
    attackRange: champion.range,
    attackIntervalMs: 1000,
    moveSpeed: 320,
    visionRange: 1350,
    hpPerLevel: 90,
    attackPerLevel: 3,
  };
}

function validatePlayer(player: SimpleMatchPlayerInput): void {
  identifier(player.careerPlayerId, 'careerPlayerId');
  if (!positions.includes(player.position))
    throw new Error('Invalid simulation input: position');
  for (const field of PLAYER_CARD_BASE_STAT_FIELDS)
    numeric(player[field], field, 0, PLAYER_CARD_STAT_MAX);
  numeric(player.form, 'form', 0, 100);
  numeric(player.condition, 'condition', 0, 100);
  numeric(player.positionProficiency, 'positionProficiency', 0, 100);
  if (player.roleProficiency !== null) {
    numeric(player.roleProficiency, 'roleProficiency', 0, 100);
    if (!Number.isInteger(player.roleProficiency))
      throw new Error(
        'Invalid simulation input: integer roleProficiency required',
      );
  }
  if (player.feedback !== undefined && player.feedback !== null) {
    if (
      Object.keys(player.feedback).some(
        (key) => !feedbackKeys.includes(key as keyof NextSetFeedback),
      )
    )
      throw new Error('Invalid simulation input: unsupported feedback field');
    for (const key of feedbackKeys) {
      const limit = key === 'carryBonus' ? 4 : 20;
      numeric(player.feedback[key], `feedback.${key}`, -limit, limit);
    }
  }
}

export function createEngineInput(options: EngineInputOptions): EngineInput {
  identifier(options.seed, 'seed', true);
  numeric(options.seed, 'seed', 0, 0xffff_ffff);
  const context = {
    careerId: options.careerId === undefined ? 0 : options.careerId,
    seriesId: options.seriesId === undefined ? 0 : options.seriesId,
    gameId: options.gameId === undefined ? 0 : options.gameId,
  };
  Object.entries(context).forEach(([key, value]) =>
    identifier(value, key, true),
  );
  if (!Array.isArray(options.teams) || options.teams.length !== 2)
    throw new Error('Invalid simulation input: exactly two teams required');
  const teamIds = new Set(options.teams.map((team) => team.teamId));
  if (teamIds.size !== 2 || !teamIds.has(options.blueTeamId))
    throw new Error(
      'Invalid simulation input: distinct teams and a valid blue team required',
    );
  if (!Array.isArray(options.picks) || options.picks.length !== 10)
    throw new Error(
      'Invalid simulation input: exactly ten assigned champion picks required',
    );
  const picks = new Map<string, EnginePick>();
  const pickedChampions = new Set<string>();
  for (const pick of options.picks) {
    const key = `${pick.teamId}:${pick.position}`;
    if (
      !teamIds.has(pick.teamId) ||
      !positions.includes(pick.position) ||
      picks.has(key)
    )
      throw new Error(
        'Invalid simulation input: duplicate or foreign pick position',
      );
    if (!champions.has(pick.championId))
      throw new Error(
        `Unsupported champion in tactical model: ${pick.championId}`,
      );
    if (pickedChampions.has(pick.championId))
      throw new Error('Invalid simulation input: duplicate champion pick');
    picks.set(key, pick);
    pickedChampions.add(pick.championId);
  }
  const actors: ActorInput[] = [];
  const playerIds = new Set<number>();
  // Canonical side/position ordering: caller arrays do not become first-action priority.
  const orderedTeams = [...options.teams].sort((a) =>
    a.teamId === options.blueTeamId ? -1 : 1,
  );
  const teams = orderedTeams.map((team) => {
    identifier(team.teamId, 'teamId');
    numeric(team.chemistry, 'chemistry', 0, 100);
    numeric(team.strategyProficiency, 'strategyProficiency', 0, 100);
    if (
      !Array.isArray(team.players) ||
      team.players.length !== 5 ||
      new Set(team.players.map((player) => player.position)).size !== 5
    )
      throw new Error(
        'Invalid simulation input: exactly five unique starter positions required',
      );
    const side: Side = team.teamId === options.blueTeamId ? 'BLUE' : 'RED';
    for (const position of positions) {
      const player = team.players.find(
        (candidate) => candidate.position === position,
      );
      if (!player)
        throw new Error(
          `Invalid simulation input: missing starter ${position}`,
        );
      validatePlayer(player);
      if (playerIds.has(player.careerPlayerId))
        throw new Error('Invalid simulation input: duplicate career player');
      playerIds.add(player.careerPlayerId);
      const pick = picks.get(`${team.teamId}:${position}`);
      if (!pick)
        throw new Error(
          `Invalid simulation input: missing champion assignment ${position}`,
        );
      const feedback = player.feedback ? { ...player.feedback } : null;
      const effectiveForm = bound(player.form + (feedback?.form ?? 0), 0, 100);
      const effectiveMental = bound(
        player.mental + (feedback?.mental ?? 0),
        0,
        PLAYER_CARD_STAT_MAX,
      );
      const rawExecution =
        ((player.mechanics * 0.5 +
          player.gameSense * 0.3 +
          player.laning * 0.2) /
          100) *
          (0.75 + player.condition * 0.0025) +
        (effectiveForm - 50) / 1000 +
        ((feedback?.confidence ?? 0) * 0.12 +
          (feedback?.motivation ?? 0) * 0.1 -
          (feedback?.pressure ?? 0) * 0.2 +
          (feedback?.carryBonus ?? 0)) /
          100;
      const execution =
        rawExecution *
        (0.6 + (0.4 * player.positionProficiency) / 100) *
        (player.roleProficiency === null
          ? 1
          : 0.94 + (0.06 * player.roleProficiency) / 100);
      actors.push({
        actorId: `game:${context.gameId}:team:${team.teamId}:player:${player.careerPlayerId}`,
        careerPlayerId: player.careerPlayerId,
        teamId: team.teamId,
        side,
        position,
        championId: pick.championId,
        profile: createCombatProfile(pick.championId),
        playerStats: Object.fromEntries(
          PLAYER_CARD_BASE_STAT_FIELDS.map((key) => [key, player[key]]),
        ) as ActorInput['playerStats'],
        form: player.form,
        condition: player.condition,
        positionProficiency: player.positionProficiency,
        roleProficiency: player.roleProficiency,
        feedback,
        execution: rounded(bound(execution, 0, 1.19)),
        aggression: rounded(
          bound(
            0.42 +
              (player.mechanics - player.gameSense) / 500 +
              (feedback?.aggression ?? 0) / 100,
            0,
            1,
          ),
        ),
        risk: rounded(
          bound(
            0.3 +
              (100 - effectiveMental) / 300 +
              (feedback?.riskTaking ?? 0) / 100 +
              (feedback?.pressure ?? 0) / 200,
            0,
            1,
          ),
        ),
        teamwork: rounded(
          bound(
            (player.teamPlay / PLAYER_CARD_STAT_MAX) * 0.7 +
              (team.chemistry / 100) * 0.3,
            0,
            1,
          ),
        ),
        sourcePlayer: jsonSnapshot(player),
      });
    }
    return {
      teamId: team.teamId,
      side,
      strategy: team.teamStrategy,
      chemistry: team.chemistry,
      strategyProficiency: team.strategyProficiency,
      sourceTeam: jsonSnapshot(team),
    };
  }) as EngineInput['teams'];
  const rules = options.battle ? createBattleRuleset() : createRuleset();
  rules.provenance.championCatalog +=
    ` Source: ${RIOT_DATA_SOURCE}. ` +
    'Generic resource 300; attack interval 1000ms; speed 320; vision 1350; HP growth 90/level and AD growth 3/level are MODEL values.';
  return freezeTree(
    jsonSnapshot<EngineInput>({
      schemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      catalogVersion: RIOT_DATA_VERSION,
      balanceVersion: `${CHAMPION_BALANCE_VERSION}:tactical-profile-1`,
      seed: options.seed,
      ...(options.battle ? { meta: createNeutralMeta() } : {}),
      context,
      rules,
      map: options.map ?? createMap(),
      teams,
      actors,
    }),
  );
}
