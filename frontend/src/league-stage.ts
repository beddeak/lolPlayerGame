import type { LeagueStage } from "./types";

export const isBracketStage = (format: string) =>
  ["PLAY_IN", "SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "GAUNTLET"].includes(
    format,
  );

export function managedGroup(stage: LeagueStage | null, teamId: number) {
  return stage?.format === "GROUP"
    ? stage.groups?.find(group => group.standings.some(row => row.teamId === teamId))
    : undefined;
}
