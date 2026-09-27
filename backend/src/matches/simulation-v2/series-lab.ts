import { Position } from '../../players/enums/position.enum';
import { RIOT_DATA_VERSION } from '../../drafts/data/riot-champions';
import { CHAMPION_BALANCE_VERSION } from '../../drafts/champion-catalog';
import {
  applyDraftAction,
  applySelection,
  autoCompleteDraft,
  confirmChampionLineup,
  currentTurn,
  selectionTurn,
  type DraftState,
  type DraftTeam,
  type FirstSelection,
  type SelectionChoice,
} from '../../drafts/draft-state';
import type { SimpleMatchTeamInput } from '../simulation/simple-match.types';
import type { EngineInput, EngineState, Side } from './contracts';
import { createEngineInput } from './input-adapter';
import { canonicalHash } from './seeded-rng';
import { validateEngineInput } from './world-state';
import {
  createNeutralMeta,
  type MetaEnvironment,
  validateMeta,
} from './tactics';

export interface SeriesEnvironment {
  engineVersion: string;
  catalogVersion: string;
  balanceVersion: string;
  rules: EngineInput['rules'];
  map: EngineInput['map'];
  meta: MetaEnvironment;
}

export interface SeriesGameReceipt {
  gameNumber: number;
  winnerTeamId: number;
  loserTeamId: number;
  input: EngineInput;
  inputHash: string;
  eventsHash: string;
  durationMs: number;
  picks: string[];
  bans: string[];
}

export interface SeriesLabState {
  version: 1;
  seed: number;
  bestOf: 1 | 3 | 5;
  fearless: boolean;
  teamIds: [number, number];
  firstSelection: FirstSelection;
  environment: SeriesEnvironment;
  environmentHash: string;
  context: { careerId: number; seriesId: number };
  games: SeriesGameReceipt[];
  active: {
    teams: [SimpleMatchTeamInput, SimpleMatchTeamInput];
    draft: DraftState;
    /** Frozen selection/ban/pick/assignment transcript, alongside the engine input. */
    draftHash: string | null;
    input: EngineInput | null;
    inputHash: string | null;
  } | null;
  winnerTeamId: number | null;
}

const clone = <T>(value: T): T => structuredClone(value);
const sameIds = (values: number[], expected: number[]) =>
  values.length === expected.length &&
  new Set(values).size === expected.length &&
  values.every((value) => expected.includes(value));

function assertEnvironment(state: SeriesLabState): void {
  if (canonicalHash(state.environment) !== state.environmentHash)
    throw new Error('Series environment changed after creation');
  validateMeta(state.environment.meta);
}

function validateSelection(selection: FirstSelection, teamIds: number[]): void {
  if (
    !teamIds.includes(selection.firstSelectionTeamId) ||
    selection.choices.length !== 0 ||
    selection.blueTeamId !== null ||
    selection.redTeamId !== null ||
    selection.firstPickTeamId !== null ||
    selection.secondPickTeamId !== null ||
    !['RANDOM', 'HIGHER_SEED', 'UPPER_BRACKET', 'LCP_2V2'].includes(
      selection.policy,
    )
  )
    throw new Error('Invalid resolved first-game selection policy');
  if (selection.policy === 'LCP_2V2') {
    const showdown = selection.showdown;
    if (
      !showdown ||
      !sameIds([showdown.teamAId, showdown.teamBId], teamIds) ||
      !Number.isFinite(showdown.teamAScore) ||
      !Number.isFinite(showdown.teamBScore) ||
      showdown.teamAPlayerIds.length !== 2 ||
      showdown.teamBPlayerIds.length !== 2 ||
      new Set([...showdown.teamAPlayerIds, ...showdown.teamBPlayerIds]).size !==
        4 ||
      [...showdown.teamAPlayerIds, ...showdown.teamBPlayerIds].some(
        (id) => !Number.isSafeInteger(id) || id <= 0,
      ) ||
      (showdown.teamAScore !== showdown.teamBScore &&
        selection.firstSelectionTeamId !==
          (showdown.teamAScore > showdown.teamBScore
            ? showdown.teamAId
            : showdown.teamBId))
    )
      throw new Error('Invalid resolved LCP showdown');
  }
}

/**
 * The caller resolves competition policy with the existing First Selection
 * service. This lab neither queries TypeORM nor substitutes random playoff seeds.
 */
export function createSeriesLab(options: {
  seed: number;
  bestOf: 1 | 3 | 5;
  fearless?: boolean;
  template: EngineInput;
  firstSelection: FirstSelection;
  meta?: MetaEnvironment;
}): SeriesLabState {
  if (
    !Number.isSafeInteger(options.seed) ||
    options.seed < 0 ||
    options.seed > 0xffff_ffff ||
    ![1, 3, 5].includes(options.bestOf)
  )
    throw new Error('Invalid tactical series settings');
  const input = options.template;
  validateEngineInput(input);
  const teamIds = input.teams.map((team) => team.teamId) as [number, number];
  if (
    teamIds.length !== 2 ||
    new Set(teamIds).size !== 2 ||
    teamIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error('Series requires two distinct teams');
  if (
    input.actors.length !== 10 ||
    teamIds.some(
      (teamId) =>
        input.actors.filter((actor) => actor.teamId === teamId).length !== 5,
    )
  )
    throw new Error('Tactical series requires a complete 5v5 template');
  validateSelection(options.firstSelection, teamIds);
  const environment: SeriesEnvironment = {
    engineVersion: input.engineVersion,
    catalogVersion: input.catalogVersion,
    balanceVersion: input.balanceVersion,
    rules: clone(input.rules),
    map: clone(input.map),
    meta: clone(options.meta ?? input.meta ?? createNeutralMeta()),
  };
  validateMeta(environment.meta);
  return {
    version: 1,
    seed: options.seed,
    bestOf: options.bestOf,
    fearless: options.fearless ?? options.bestOf > 1,
    teamIds,
    firstSelection: clone(options.firstSelection),
    environment,
    environmentHash: canonicalHash(environment),
    context: {
      careerId: input.context?.careerId ?? 0,
      seriesId: input.context?.seriesId ?? 0,
    },
    games: [],
    active: null,
    winnerTeamId: null,
  };
}

function draftTeam(team: SimpleMatchTeamInput): DraftTeam {
  return {
    id: team.teamId,
    code: team.teamCode,
    strategy: team.teamStrategy,
    players: team.players.map((player) => ({
      id: player.careerPlayerId,
      nickname: `Player ${player.careerPlayerId}`,
      position: player.position,
      instruction: player.playerInstruction,
      roleProficiency: player.roleProficiency,
      // Source has no exact champion mastery. Missing is not invented as 100.
      typeProficiencies: {},
      abilities: {
        mechanics: player.mechanics,
        laning: player.laning,
        teamFight: player.teamFight,
      },
    })),
  };
}

export function beginSeriesDraft(
  state: SeriesLabState,
  teams: [SimpleMatchTeamInput, SimpleMatchTeamInput],
): SeriesLabState {
  assertEnvironment(state);
  if (state.active || state.winnerTeamId !== null)
    throw new Error('Series already has an active set or a winner');
  if (
    !sameIds(
      teams.map((team) => team.teamId),
      state.teamIds,
    )
  )
    throw new Error('Cannot change clubs during a series');
  for (const team of teams) {
    if (
      team.players.length !== 5 ||
      new Set(team.players.map((player) => player.position)).size !== 5 ||
      team.players.some(
        (player) => !Object.values(Position).includes(player.position),
      )
    )
      throw new Error('Five valid starter positions required');
  }
  const allPlayers = teams.flatMap((team) => team.players);
  if (new Set(allPlayers.map((player) => player.careerPlayerId)).size !== 10)
    throw new Error('Duplicate series starter');
  const last = state.games.at(-1);
  const selection: FirstSelection = last
    ? {
        firstSelectionTeamId: last.loserTeamId,
        policy: 'PREVIOUS_LOSER',
        choices: [],
        blueTeamId: null,
        redTeamId: null,
        firstPickTeamId: null,
        secondPickTeamId: null,
      }
    : clone(state.firstSelection);
  const result = clone(state);
  const ordered = state.teamIds.map((id) =>
    teams.find((team) => team.teamId === id)!,
  );
  result.active = {
    teams: clone(ordered as [SimpleMatchTeamInput, SimpleMatchTeamInput]),
    draft: {
      version: 3,
      aiSeed: state.seed,
      championDataVersion: RIOT_DATA_VERSION,
      balanceVersion: CHAMPION_BALANCE_VERSION,
      blue: draftTeam(ordered[0]),
      red: draftTeam(ordered[1]),
      managedTeamId: 0,
      gameNumber: state.games.length + 1,
      fearless: state.fearless,
      unavailable: state.fearless
        ? state.games.flatMap((game) => game.picks)
        : [],
      actions: [],
      deadline: null,
      completed: false,
      selection,
    },
    input: null,
    inputHash: null,
    draftHash: null,
  };
  return result;
}

function updateDraft(
  state: SeriesLabState,
  operation: (draft: DraftState) => DraftState,
): SeriesLabState {
  assertEnvironment(state);
  if (!state.active || state.active.input)
    throw new Error('No editable series draft');
  const result = clone(state);
  result.active!.draft = operation(result.active!.draft);
  return result;
}

export function selectForSeries(
  state: SeriesLabState,
  choice: SelectionChoice,
): SeriesLabState {
  return updateDraft(state, (draft) => applySelection(draft, choice, false, 0));
}

export function draftForSeries(
  state: SeriesLabState,
  championId: string,
): SeriesLabState {
  return updateDraft(state, (draft) =>
    applyDraftAction(draft, championId, false, 0),
  );
}

export function autoDraftSeries(state: SeriesLabState): SeriesLabState {
  return updateDraft(state, (draft) => autoCompleteDraft(draft, 0));
}

export function assignForSeries(
  state: SeriesLabState,
  side: Side,
  entries: Array<{ position: Position; championId: string }>,
): SeriesLabState {
  return updateDraft(state, (draft) =>
    confirmChampionLineup(
      { ...draft, assignmentsConfirmed: false },
      side,
      entries,
      draft.assignmentRevision ?? 0,
    ),
  );
}

/** Each set creates fresh physics state; only eligible between-set snapshots carry. */
export function prepareSeriesGame(state: SeriesLabState): SeriesLabState {
  assertEnvironment(state);
  const current = state.active;
  if (!current || current.input) throw new Error('No unstarted tactical set');
  const draft = current.draft;
  if (
    draft.gameNumber !== state.games.length + 1 ||
    !draft.completed ||
    !draft.assignments ||
    !draft.assignmentsConfirmed
  )
    throw new Error('Complete draft and confirm champion assignments first');
  // Re-check the serialized command history, not just a caller-controlled
  // "completed" flag. This also catches stale/foreign picks after a reload.
  let replay = beginSeriesDraft({ ...state, active: null }, current.teams)
    .active!.draft;
  for (const choice of draft.selection?.choices ?? []) {
    if (selectionTurn(replay)?.teamId !== choice.teamId)
      throw new Error('Invalid first-selection command history');
    replay = applySelection(replay, choice.choice, choice.automatic, 0);
  }
  for (const action of draft.actions) {
    const turn = currentTurn(replay);
    if (!turn || turn.side !== action.side || turn.kind !== action.kind)
      throw new Error('Invalid draft command history');
    replay = applyDraftAction(replay, action.variantId, action.automatic, 0);
  }
  if (
    !replay.completed ||
    replay.blue.id !== draft.blue.id ||
    replay.red.id !== draft.red.id ||
    canonicalHash(replay.selection) !== canonicalHash(draft.selection)
  )
    throw new Error('Draft state does not match its command history');
  for (const side of ['BLUE', 'RED'] as const) {
    const chosen = replay.actions
      .filter((action) => action.side === side && action.kind === 'PICK')
      .map((action) => action.variantId);
    const assigned = Object.values(draft.assignments[side]);
    if (
      assigned.length !== 5 ||
      new Set(assigned).size !== 5 ||
      assigned.some((champion) => !chosen.includes(champion))
    )
      throw new Error('Assigned champion was not picked by this team');
  }
  const picks = (['BLUE', 'RED'] as const).flatMap((side) =>
    Object.values(Position).map((position) => ({
      teamId: side === 'BLUE' ? draft.blue.id : draft.red.id,
      position,
      championId: draft.assignments![side][position],
    })),
  );
  const seed = Number.parseInt(
    canonicalHash({ seed: state.seed, set: draft.gameNumber }).slice(0, 8),
    16,
  );
  const input = clone(
    createEngineInput({
      battle: !!state.environment.rules.environment,
      ...state.context,
      gameId: draft.gameNumber,
      seed,
      blueTeamId: draft.blue.id,
      teams: current.teams,
      picks,
      map: state.environment.map,
    }),
  );
  if (
    input.engineVersion !== state.environment.engineVersion ||
    input.catalogVersion !== state.environment.catalogVersion ||
    input.balanceVersion !== state.environment.balanceVersion
  )
    throw new Error('Pinned series environment is no longer supported');
  input.rules = clone(state.environment.rules);
  input.meta = clone(state.environment.meta);
  const result = clone(state);
  result.active!.input = input;
  result.active!.inputHash = canonicalHash(input);
  result.active!.draftHash = canonicalHash(draft);
  return result;
}

/**
 * A finished physical game is evidence, not a request to roll its winner again.
 * No timeout/partial/error run can advance the series or consume Fearless picks.
 * This updates lab JSON only; career transaction integration is a later boundary.
 */
export function completeSeriesGame(
  series: SeriesLabState,
  game: EngineState,
): SeriesLabState {
  assertEnvironment(series);
  const active = series.active;
  if (!active?.input || !active.inputHash)
    throw new Error('No active tactical set result expected');
  if (!active.draftHash || canonicalHash(active.draft) !== active.draftHash)
    throw new Error('Set draft transcript changed after input was frozen');
  if (
    canonicalHash(active.input) !== active.inputHash ||
    game.inputHash !== active.inputHash ||
    canonicalHash(game.input) !== active.inputHash
  )
    throw new Error('Set result does not match the pinned input');
  if (
    canonicalHash({
      engineVersion: game.input.engineVersion,
      catalogVersion: game.input.catalogVersion,
      balanceVersion: game.input.balanceVersion,
      rules: game.input.rules,
      map: game.input.map,
      meta: game.input.meta ?? createNeutralMeta(),
    }) !== series.environmentHash
  )
    throw new Error('Set result changed the fixed series environment');
  if (
    game.status !== 'FINISHED' ||
    !game.input.rules.environment ||
    game.input.rules.capabilities.nexusVictory !== 'SUPPORTED' ||
    game.error !== null ||
    game.winnerTeamId === null ||
    !series.teamIds.includes(game.winnerTeamId) ||
    !Number.isFinite(game.simTimeMs) ||
    game.simTimeMs <= 0 ||
    game.simTimeMs > game.input.rules.maxHorizonMs
  )
    throw new Error('Only a finished nexus result can advance the series');
  const winner = game.input.teams.find(
    (team) => team.teamId === game.winnerTeamId,
  )!;
  const loser = game.input.teams.find((team) => team.teamId !== winner.teamId)!;
  const nexus = game.units.filter((unit) => unit.kind === 'NEXUS');
  const destroyed = nexus.filter(
    (unit) => unit.side === loser.side && !unit.active && unit.hp === 0,
  );
  const ownAlive = nexus.filter(
    (unit) => unit.side === winner.side && unit.active && unit.hp > 0,
  );
  if (
    destroyed.length !== 1 ||
    ownAlive.length !== 1 ||
    !game.events.some(
      (event) =>
        event.kind === 'NEXUS_DESTROYED' &&
        event.targetId === destroyed[0].id &&
        event.atMs === game.simTimeMs,
    ) ||
    !game.events.some(
      (event) =>
        event.kind === 'DAMAGE' &&
        event.targetId === destroyed[0].id &&
        (event.amount ?? 0) > 0 &&
        event.atMs === game.simTimeMs &&
        [...game.actors, ...game.units].some(
          (unit) => unit.id === event.actorId && unit.side === winner.side,
        ),
    )
  )
    throw new Error('Missing unambiguous physical nexus destruction evidence');
  const result = clone(series);
  result.games.push({
    gameNumber: active.draft.gameNumber,
    winnerTeamId: winner.teamId,
    loserTeamId: loser.teamId,
    input: clone(active.input),
    inputHash: active.inputHash,
    eventsHash: canonicalHash(game.events),
    durationMs: game.simTimeMs,
    // The actual frozen combat participants are authoritative for Fearless.
    // The separately checked transcript preserves bans and selection history.
    picks: active.input.actors.map((actor) => actor.championId),
    bans: active.draft.actions
      .filter((action) => action.kind === 'BAN')
      .map((action) => action.variantId),
  });
  const wins = result.games.filter(
    (receipt) => receipt.winnerTeamId === winner.teamId,
  ).length;
  result.winnerTeamId =
    wins >= Math.floor(result.bestOf / 2) + 1 ? winner.teamId : null;
  result.active = null;
  return result;
}
