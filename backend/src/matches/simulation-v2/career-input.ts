import {
  applyDraftAction,
  applySelection,
  autoCompleteDraft,
  currentTurn,
  selectionTurn,
  type DraftState,
  type DraftTeam,
} from '../../drafts/draft-state';
import { CHAMPION_BALANCE_VERSION } from '../../drafts/champion-catalog';
import { RIOT_DATA_VERSION } from '../../drafts/data/riot-champions';
import { Position } from '../../players/enums/position.enum';
import type { SimpleMatchTeamInput } from '../simulation/simple-match.types';
import {
  CURRENT_MACRO_AI,
  type EngineInput,
  type MacroAiPolicy,
} from './contracts';
import { createEngineInput } from './input-adapter';

/** Keep already-started series on their pinned decisions. Old inputs omit the
 * optional policy, so neither a server restart nor a retry upgrades them. */
export function careerMacroAi(previous: EngineInput[]): MacroAiPolicy {
  if (!previous.length) return CURRENT_MACRO_AI;
  const policies = previous.map((input) => input.rules.macroAi ?? 'LEGACY');
  if (
    policies.some(
      (policy) =>
        !['LEGACY', 'COORDINATED_V1', CURRENT_MACRO_AI].includes(policy) ||
        policy !== policies[0],
    )
  )
    throw new Error('Series has incompatible macro AI policies');
  return policies[0];
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
      typeProficiencies: {},
      abilities: {
        mechanics: player.mechanics,
        laning: player.laning,
        teamFight: player.teamFight,
      },
    })),
  };
}

/** Every mode uses a real champion draft. Series callers supply the persisted
 * draft (and hence the competition's selection policy and fearless history).
 * Standalone matches delegate a fresh deterministic BO1 draft to the same AI.
 */
export function buildCareerEngineInput(options: {
  teams: [SimpleMatchTeamInput, SimpleMatchTeamInput];
  seed: number;
  careerId: number;
  seriesId?: number;
  gameId: number;
  draft?: DraftState;
  macroAi?: MacroAiPolicy;
}): { input: EngineInput; draft: DraftState } {
  const { teams } = options;
  if (options.seriesId && !options.draft)
    throw new Error(
      'Series games require a persisted draft and fearless history',
    );
  const draft =
    options.draft ??
    autoCompleteDraft(
      {
        version: 3,
        aiSeed: options.seed,
        championDataVersion: RIOT_DATA_VERSION,
        balanceVersion: CHAMPION_BALANCE_VERSION,
        blue: draftTeam(teams[0]),
        red: draftTeam(teams[1]),
        managedTeamId: 0,
        gameNumber: 1,
        fearless: false,
        unavailable: [],
        actions: [],
        deadline: null,
        completed: false,
        selection: {
          firstSelectionTeamId: teams[options.seed % 2].teamId,
          policy: 'RANDOM',
          choices: [],
          blueTeamId: null,
          redTeamId: null,
          firstPickTeamId: null,
          secondPickTeamId: null,
        },
      },
      0,
    );
  if (draft.version !== 3)
    throw new Error(
      'This unfinished draft uses an unsupported legacy champion catalog',
    );
  if (!draft.completed || !draft.assignmentsConfirmed || !draft.assignments)
    throw new Error(
      'Complete the draft and confirm champion assignments first',
    );
  if (
    draft.championDataVersion !== RIOT_DATA_VERSION ||
    draft.balanceVersion !== CHAMPION_BALANCE_VERSION
  )
    throw new Error('Draft catalog version is not supported by this engine');
  const teamIds = teams.map((team) => team.teamId);
  if (
    draft.blue.id === draft.red.id ||
    ![draft.blue.id, draft.red.id].every((id) => teamIds.includes(id))
  )
    throw new Error('Draft teams do not match game participants');
  for (const team of teams) {
    const snapshot = draft.blue.id === team.teamId ? draft.blue : draft.red;
    if (
      snapshot.players.length !== 5 ||
      team.players.length !== 5 ||
      snapshot.players.some(
        (player) =>
          !team.players.some(
            (current) =>
              current.careerPlayerId === player.id &&
              current.position === player.position,
          ),
      )
    )
      throw new Error('Draft starter identities or positions changed');
  }
  let replay: DraftState = {
    ...structuredClone(draft),
    actions: [],
    completed: false,
    deadline: null,
    assignments: undefined,
    assignmentsConfirmed: false,
    ...(draft.selection
      ? {
          selection: {
            ...structuredClone(draft.selection),
            choices: [],
            blueTeamId: null,
            redTeamId: null,
            firstPickTeamId: null,
            secondPickTeamId: null,
          },
        }
      : {}),
  };
  for (const choice of draft.selection?.choices ?? []) {
    if (selectionTurn(replay)?.teamId !== choice.teamId)
      throw new Error('Invalid first selection history');
    replay = applySelection(replay, choice.choice, choice.automatic, 0);
  }
  for (const action of draft.actions) {
    const turn = currentTurn(replay);
    if (!turn || action.kind !== turn.kind || action.side !== turn.side)
      throw new Error('Invalid draft action history');
    replay = applyDraftAction(replay, action.variantId, action.automatic, 0);
  }
  if (
    !replay.completed ||
    replay.blue.id !== draft.blue.id ||
    replay.red.id !== draft.red.id
  )
    throw new Error('Draft history does not match the completed game');
  const picks = (['BLUE', 'RED'] as const).flatMap((side) => {
    const chosen = draft.actions
      .filter((action) => action.side === side && action.kind === 'PICK')
      .map((action) => action.variantId);
    const assigned = Object.values(draft.assignments![side]);
    if (
      assigned.length !== 5 ||
      new Set(assigned).size !== 5 ||
      assigned.some((id) => !chosen.includes(id))
    )
      throw new Error('Assigned champion was not legally picked by this team');
    return Object.values(Position).map((position) => ({
      teamId: side === 'BLUE' ? draft.blue.id : draft.red.id,
      position,
      championId: draft.assignments![side][position],
    }));
  });
  return {
    input: createEngineInput({
      battle: true,
      macroAi: options.macroAi ?? CURRENT_MACRO_AI,
      seed: options.seed,
      careerId: options.careerId,
      seriesId: options.seriesId ?? 0,
      gameId: options.gameId,
      teams,
      blueTeamId: draft.blue.id,
      picks,
    }),
    draft: structuredClone(draft),
  };
}
