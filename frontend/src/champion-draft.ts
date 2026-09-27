import type { DraftVariant } from "./draft-preview";
import type { Position } from "./types";

export interface Champion extends DraftVariant {
  championKey: string;
  title: string;
  imageUrl: string;
  tags: string[];
  recommendedPositions: Position[];
  roleRatings: Record<Position, number>;
  magicShare: number;
  protection: number;
  difficulty: number;
  damage: number;
  waveClear: number;
  objectiveDamage: number;
}
export type ChampionLineup = Record<Position, string>;
export function swapChampion(
  lineup: ChampionLineup,
  target: Position,
  championId: string,
): ChampionLineup {
  const previous = (Object.keys(lineup) as Position[]).find(
    (p) => lineup[p] === championId,
  );
  if (!previous || previous === target) return lineup;
  return { ...lineup, [target]: championId, [previous]: lineup[target] };
}
