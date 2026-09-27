import { Position } from '../players/enums/position.enum';
import { PlayerInstruction } from '../careers/enums/player-instruction.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { CHAMPIONS, CHAMPIONS_BY_ID } from './champion-catalog';
import { type ChampionLineup } from './champion-balance';
import {
  chooseChampion,
  chooseChampionSelection,
  chooseChampionAssignment,
} from './champion-draft-ai';
import {
  CHAMPION_VARIANTS,
  VARIANTS_BY_ID,
  ChampionVariant,
} from './variant-catalog';

export type DraftSide = 'BLUE' | 'RED';
export type DraftActionKind = 'BAN' | 'PICK';
export interface DraftPlayer {
  id: number;
  nickname: string;
  position: Position;
  instruction: PlayerInstruction | null;
  roleProficiency: number | null;
  typeProficiencies: Record<string, number>;
  abilities?: { mechanics: number; laning: number; teamFight: number };
}
export interface DraftTeam {
  id: number;
  code: string;
  strategy: TeamStrategy;
  players: DraftPlayer[];
}
export interface DraftAction {
  side: DraftSide;
  kind: DraftActionKind;
  variantId: string;
  automatic: boolean;
  championName?: string;
  championImageUrl?: string;
}
export interface DraftState {
  version: 1 | 2 | 3;
  aiSeed?: number;
  championDataVersion?: string;
  balanceVersion?: string;
  assignments?: Record<DraftSide, ChampionLineup>;
  assignmentsConfirmed?: boolean;
  assignmentRevision?: number;
  blue: DraftTeam;
  red: DraftTeam;
  managedTeamId: number;
  gameNumber: number;
  fearless: boolean;
  unavailable: string[];
  actions: DraftAction[];
  deadline: string | null;
  completed: boolean;
  selection?: FirstSelection;
}
export type SelectionChoice = 'BLUE' | 'RED' | 'FIRST_PICK' | 'SECOND_PICK';
export interface FirstSelection {
  firstSelectionTeamId: number;
  policy:
    | 'RANDOM'
    | 'HIGHER_SEED'
    | 'HOME_TEAM'
    | 'LCP_2V2'
    | 'PREVIOUS_LOSER'
    | 'UPPER_BRACKET';
  choices: Array<{
    teamId: number;
    choice: SelectionChoice;
    automatic: boolean;
  }>;
  blueTeamId: number | null;
  redTeamId: number | null;
  firstPickTeamId: number | null;
  secondPickTeamId: number | null;
  showdown?: {
    teamAId: number;
    teamBId: number;
    teamAPlayerIds: number[];
    teamBPlayerIds: number[];
    teamAScore: number;
    teamBScore: number;
  };
}
export function selectionTurn(state: DraftState) {
  const s = state.selection;
  if (!s || s.choices.length === 2) return null;
  const other =
    s.firstSelectionTeamId === state.blue.id ? state.red.id : state.blue.id;
  const options: SelectionChoice[] = !s.choices.length
    ? ['BLUE', 'RED', 'FIRST_PICK', 'SECOND_PICK']
    : s.blueTeamId !== null
      ? ['FIRST_PICK', 'SECOND_PICK']
      : ['BLUE', 'RED'];
  return { teamId: s.choices.length ? other : s.firstSelectionTeamId, options };
}
export function applySelection(
  state: DraftState,
  choice: SelectionChoice,
  automatic: boolean,
  now: number,
): DraftState {
  const turn = selectionTurn(state);
  if (!turn || !turn.options.includes(choice))
    throw new Error('Invalid selection');
  const other = turn.teamId === state.blue.id ? state.red.id : state.blue.id;
  const selection: FirstSelection = {
    ...state.selection!,
    choices: [
      ...state.selection!.choices,
      { teamId: turn.teamId, choice, automatic },
    ],
  };
  if (choice === 'BLUE' || choice === 'RED') {
    selection.blueTeamId = choice === 'BLUE' ? turn.teamId : other;
    selection.redTeamId = choice === 'RED' ? turn.teamId : other;
  } else {
    selection.firstPickTeamId = choice === 'FIRST_PICK' ? turn.teamId : other;
    selection.secondPickTeamId = choice === 'SECOND_PICK' ? turn.teamId : other;
  }
  const teams = [state.blue, state.red];
  return {
    ...state,
    selection,
    blue:
      selection.blueTeamId === null
        ? state.blue
        : teams.find((t) => t.id === selection.blueTeamId)!,
    red:
      selection.redTeamId === null
        ? state.red
        : teams.find((t) => t.id === selection.redTeamId)!,
    deadline: new Date(now + DRAFT_TURN_SECONDS * 1000).toISOString(),
  };
}
export function automaticSelection(state: DraftState): SelectionChoice {
  const turn = selectionTurn(state);
  if (!turn) throw new Error('Selection complete');
  if (state.version === 3)
    return chooseChampionSelection(state, turn.teamId, turn.options);
  // Stable AI: prioritize first pick, otherwise map-side comfort. No random rerolls.
  return turn.options.includes('FIRST_PICK') ? 'FIRST_PICK' : 'BLUE';
}
export const DRAFT_TURN_SECONDS = 30;
const turns = (kind: DraftActionKind, order: string) =>
  [...order].map((side) => ({
    kind,
    side: side === 'B' ? ('BLUE' as const) : ('RED' as const),
  }));
// Tournament snake draft, 5 bans and 5 picks per team, in two phases.
export const DRAFT_TURNS = [
  ...turns('BAN', 'BRBRBR'),
  ...turns('PICK', 'BRRBBR'),
  ...turns('BAN', 'RBRB'),
  ...turns('PICK', 'RBBR'),
];
export const teamOnSide = (state: DraftState, side: DraftSide) =>
  side === 'BLUE' ? state.blue : state.red;
export const draftTurns = (state: DraftState) =>
  DRAFT_TURNS.map((turn) => ({
    ...turn,
    side:
      state.selection?.firstPickTeamId === state.red.id
        ? turn.side === 'BLUE'
          ? ('RED' as const)
          : ('BLUE' as const)
        : turn.side,
  }));
export const currentTurn = (state: DraftState) =>
  selectionTurn(state)
    ? null
    : (draftTurns(state)[state.actions.length] ?? null);
export function selectedVariants(state: DraftState, side: DraftSide) {
  return state.actions
    .filter((action) => action.side === side && action.kind === 'PICK')
    .map((action) =>
      (state.version === 3 ? CHAMPIONS_BY_ID : VARIANTS_BY_ID).get(
        action.variantId,
      )!,
    );
}
export function availableVariants(state: DraftState): ChampionVariant[] {
  const turn = currentTurn(state);
  if (!turn || state.completed) return [];
  const blocked = new Set([
    ...state.unavailable,
    ...state.actions.map((action) => action.variantId),
  ]);
  const remaining = (
    state.version === 3 ? CHAMPIONS : CHAMPION_VARIANTS
  ).filter((variant) => !blocked.has(variant.id));
  if (state.version === 3) return remaining;
  const selected = selectedVariants(state, turn.side);
  if (turn.kind === 'PICK')
    return remaining.filter(
      (variant) => !selected.some((pick) => pick.position === variant.position),
    );
  // With a smaller virtual pool, bans must leave one choice per unfilled lane
  // on BOTH sides. This prevents a fifth-set Fearless draft deadlock.
  return remaining.filter((variant) => {
    const slotsNeeded = (['BLUE', 'RED'] as const).filter(
      (side) =>
        !selectedVariants(state, side).some(
          (pick) => pick.position === variant.position,
        ),
    ).length;
    return (
      remaining.filter((candidate) => candidate.position === variant.position)
        .length > slotsNeeded
    );
  });
}

export function variantScore(
  variant: ChampionVariant,
  player: DraftPlayer,
  strategy: TeamStrategy,
) {
  const proficiency = player.typeProficiencies[variant.typeId] ?? 50;
  const early = /PRESSURE|UPPER|TOP_CARRY/.test(strategy);
  const late = strategy === TeamStrategy.BOT_CARRY;
  return (
    proficiency * 0.6 +
    variant.early * (early ? 0.22 : 0.12) +
    variant.mid * 0.14 +
    variant.late * (late ? 0.22 : 0.14)
  );
}
export function automaticVariant(state: DraftState): ChampionVariant {
  const turn = currentTurn(state);
  if (!turn) throw new Error('Draft is complete');
  if (state.version === 3)
    return chooseChampion(
      state,
      turn.side,
      turn.kind,
      availableVariants(state).map((c) => CHAMPIONS_BY_ID.get(c.id)!),
    );
  const targetSide =
    turn.kind === 'PICK' ? turn.side : turn.side === 'BLUE' ? 'RED' : 'BLUE';
  const team = teamOnSide(state, targetSide);
  const picked = selectedVariants(state, targetSide);
  const candidates = availableVariants(state);
  const score = (variant: ChampionVariant) => {
    const player = team.players.find(
      (candidate) => candidate.position === variant.position,
    );
    return (
      (player ? variantScore(variant, player, team.strategy) : 0) -
      (turn.kind === 'BAN' &&
      picked.some((pick) => pick.position === variant.position)
        ? 1000
        : 0)
    );
  };
  const choice = candidates.sort(
    (a, b) => score(b) - score(a) || a.id.localeCompare(b.id),
  )[0];
  if (!choice) throw new Error('No legal draft choice remains');
  return choice;
}
export function applyDraftAction(
  state: DraftState,
  variantId: string,
  automatic: boolean,
  now: number,
): DraftState {
  const turn = currentTurn(state);
  if (
    !turn ||
    !availableVariants(state).some((variant) => variant.id === variantId)
  )
    throw new Error('Variant is not available for this turn');
  const champion =
    state.version === 3 ? CHAMPIONS_BY_ID.get(variantId) : undefined;
  const actions = [
    ...state.actions,
    {
      ...turn,
      variantId,
      automatic,
      ...(champion
        ? { championName: champion.name, championImageUrl: champion.imageUrl }
        : {}),
    },
  ];
  const completed = actions.length === DRAFT_TURNS.length;
  const next: DraftState = {
    ...state,
    actions,
    completed,
    deadline:
      completed && state.version !== 3
        ? null
        : new Date(now + DRAFT_TURN_SECONDS * 1000).toISOString(),
  };
  if (completed && state.version === 3) {
    next.assignments = {
      BLUE: chooseChampionAssignment(next, 'BLUE') as ChampionLineup,
      RED: chooseChampionAssignment(next, 'RED') as ChampionLineup,
    };
    next.assignmentRevision = 0;
    next.assignmentsConfirmed = false;
  }
  return next;
}

export function confirmChampionLineup(
  state: DraftState,
  side: DraftSide,
  entries: Array<{ position: Position; championId: string }>,
  expectedRevision: number,
): DraftState {
  if (
    state.version !== 3 ||
    !state.completed ||
    !state.assignments ||
    state.assignmentsConfirmed
  )
    throw new Error('챔피언 배치 단계가 아닙니다.');
  if (expectedRevision !== (state.assignmentRevision ?? 0))
    throw new Error('이미 처리된 배치입니다. 다시 불러와 주세요.');
  const ids = selectedVariants(state, side).map((c) => c.id);
  if (
    entries.length !== 5 ||
    new Set(entries.map((e) => e.position)).size !== 5 ||
    new Set(entries.map((e) => e.championId)).size !== 5 ||
    entries.some(
      (e) =>
        !Object.values(Position).includes(e.position) ||
        !ids.includes(e.championId),
    )
  )
    throw new Error('선택한 챔피언 5명을 각 포지션에 한 명씩 배치해 주세요.');
  return {
    ...state,
    assignments: {
      ...state.assignments,
      [side]: Object.fromEntries(
        entries.map((e) => [e.position, e.championId]),
      ) as ChampionLineup,
    },
    assignmentRevision: expectedRevision + 1,
    assignmentsConfirmed: true,
    deadline: null,
  };
}
export function autoCompleteDraft(state: DraftState, now: number): DraftState {
  let result = state;
  while (selectionTurn(result))
    result = applySelection(result, automaticSelection(result), true, now);
  while (!result.completed)
    result = applyDraftAction(result, automaticVariant(result).id, true, now);
  return result.version === 3
    ? { ...result, assignmentsConfirmed: true, deadline: null }
    : result;
}
