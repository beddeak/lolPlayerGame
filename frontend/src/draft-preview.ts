import type { Position } from "./types";

export type DraftSide = "BLUE" | "RED";
export interface DraftTurn {
  side: DraftSide;
  kind: "BAN" | "PICK";
}
export interface DraftVariant {
  id: string;
  typeId: string;
  typeName: string;
  position: Position;
  variant: "A" | "B" | "C";
  name: string;
  early: number;
  mid: number;
  late: number;
  lanePower: number;
  teamFight: number;
  scaling: number;
  range: number;
  engage: number;
  frontline: number;
}
export interface DraftCatalog {
  champions?: import('./champion-draft').Champion[];
  championDataVersion?: string;
  championBalanceVersion?: string;
  version: number;
  turnSeconds: number;
  turns: DraftTurn[];
  variants: DraftVariant[];
}
export interface PreviewAction extends DraftTurn {
  variantId: string;
  automatic: boolean;
}
export interface DraftPreviewState {
  actions: PreviewAction[];
  deadline: number;
  unavailable?: string[];
}

export const DRAFT_POSITIONS: Position[] = [
  "TOP",
  "JUNGLE",
  "MID",
  "ADC",
  "SUPPORT",
];
export const POSITION_SHORT: Record<Position, string> = {
  TOP: "TOP",
  JUNGLE: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUP",
};
export function draftPicks(
  state: DraftPreviewState,
  side: DraftSide,
  catalog: DraftCatalog,
) {
  return state.actions
    .filter((action) => action.kind === "PICK" && action.side === side)
    .map((action) =>
      catalog.variants.find((variant) => variant.id === action.variantId)!,
    );
}
export function choiceReason(
  variant: DraftVariant,
  state: DraftPreviewState,
  catalog: DraftCatalog,
): string | null {
  const turn = catalog.turns[state.actions.length];
  if (!turn) return "밴픽 완료";
  if (state.unavailable?.includes(variant.id))
    return "피어리스 제한 · 이전 세트 사용";
  const prior = state.actions.find((action) => action.variantId === variant.id);
  if (prior) return prior.kind === "BAN" ? "밴됨" : "이미 선택됨";
  if (
    turn.kind === "PICK" &&
    draftPicks(state, turn.side, catalog).some(
      (pick) => pick.position === variant.position,
    )
  )
    return "이 포지션 선택 완료";
  if (turn.kind === "BAN") {
    const remaining = catalog.variants.filter(
      (candidate) =>
        candidate.position === variant.position &&
        !state.unavailable?.includes(candidate.id) &&
        !state.actions.some((action) => action.variantId === candidate.id),
    ).length;
    const slotsNeeded = (["BLUE", "RED"] as const).filter(
      (side) =>
        !draftPicks(state, side, catalog).some(
          (pick) => pick.position === variant.position,
        ),
    ).length;
    if (remaining <= slotsNeeded) return "필수 포지션 선택지 보호";
  }
  return null;
}
export function advancePreview(
  state: DraftPreviewState,
  catalog: DraftCatalog,
  variantId: string,
  automatic: boolean,
  now: number,
): DraftPreviewState {
  const variant = catalog.variants.find(
    (candidate) => candidate.id === variantId,
  );
  const turn = catalog.turns[state.actions.length];
  if (!variant || !turn || choiceReason(variant, state, catalog)) return state;
  return {
    actions: [...state.actions, { ...turn, variantId, automatic }],
    deadline: now + catalog.turnSeconds * 1000,
  };
}
/** Preview AI uses public variant profiles only; no fabricated player proficiency. */
export function suggestPreview(
  state: DraftPreviewState,
  catalog: DraftCatalog,
): DraftVariant | undefined {
  const turn = catalog.turns[state.actions.length];
  if (!turn) return undefined;
  const target =
    turn.kind === "PICK" ? turn.side : turn.side === "BLUE" ? "RED" : "BLUE";
  const filled = draftPicks(state, target, catalog).map(
    (pick) => pick.position,
  );
  const score = (variant: DraftVariant) =>
    variant.early * 0.3 +
    variant.mid * 0.4 +
    variant.late * 0.3 +
    variant.teamFight * 0.08 -
    (turn.kind === "BAN" && filled.includes(variant.position) ? 100 : 0);
  return catalog.variants
    .filter((variant) => !choiceReason(variant, state, catalog))
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}
export function restorePreview(
  raw: string | null,
  catalog: DraftCatalog,
  now: number,
): DraftPreviewState {
  const empty = { actions: [], deadline: now + catalog.turnSeconds * 1000 };
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("version" in parsed) ||
      parsed.version !== catalog.version ||
      !("state" in parsed)
    )
      return empty;
    const value = parsed.state as DraftPreviewState;
    if (
      !value ||
      !Array.isArray(value.actions) ||
      value.actions.length > catalog.turns.length ||
      !Number.isFinite(value.deadline)
    )
      return empty;
    let state: DraftPreviewState = empty;
    for (const action of value.actions) {
      const turn = catalog.turns[state.actions.length];
      if (
        !action ||
        typeof action.automatic !== "boolean" ||
        action.kind !== turn.kind ||
        action.side !== turn.side
      )
        return empty;
      const next = advancePreview(
        state,
        catalog,
        action.variantId,
        action.automatic,
        now,
      );
      if (next === state) return empty;
      state = next;
    }
    // A local preview cannot stall forever because of edited or corrupt storage.
    return { ...state, deadline: Math.min(value.deadline, empty.deadline) };
  } catch {
    return empty;
  }
}
