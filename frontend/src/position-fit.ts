import type { CareerPlayer, Position } from "./types";

// Keep aligned with POSITION_PROFICIENCY_MATCH_CONFIG (covered by UI tests).
export const POSITION_MAX_PENALTY = 40;
export const POSITION_DISPLAY_STATS = [
  "currentMechanics",
  "currentGameSense",
  "currentLaning",
  "currentTeamFight",
  "currentMacro",
  "currentTeamPlay",
  "currentMental",
  "currentChampionPool",
] as const;
export function positionFit(player: CareerPlayer, position: Position) {
  const proficiency = Math.max(
    0,
    Math.min(
      100,
      player.positionProficiencies?.find((item) => item.position === position)
        ?.proficiency ?? (player.currentPosition === position ? 100 : 20),
    ),
  );
  return {
    proficiency,
    penalty: ((100 - proficiency) / 100) * POSITION_MAX_PENALTY,
  };
}

// Display-only snapshot. Never pass this to training or persist it as career state.
export function playerForPositionDisplay(
  player: CareerPlayer,
  position?: Position | null,
): CareerPlayer {
  if (!position) return player;
  const { penalty } = positionFit(player, position);
  if (penalty === 0) return player;
  const display = { ...player };
  for (const field of POSITION_DISPLAY_STATS) {
    display[field] = Math.max(
      0,
      Math.min(119, Math.round(player[field] - penalty)),
    );
  }
  return display;
}

export function positionDisplayOverall(player: CareerPlayer) {
  return Math.round(
    POSITION_DISPLAY_STATS.reduce((sum, field) => sum + player[field], 0) /
      POSITION_DISPLAY_STATS.length,
  );
}
