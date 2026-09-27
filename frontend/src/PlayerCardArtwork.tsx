import type { CareerPlayer, PlayerCard } from "./types";
import { hasCardArtwork } from "./card-artwork";
import "./PlayerCardArtwork.css";

// Matches the supplied Worlds 2021 shield. No changes to the source image.
const LEGEND_FRAME =
  "M47 148 C173 124 296 35 400 25 C422 79 485 62 515 14 " +
  "C551 63 608 77 623 26 C730 30 868 126 985 148 " +
  "L985 274 L1005 291 L1005 768 L1015 782 L1015 1147 " +
  "L995 1169 L995 1238 Q996 1302 930 1318 " +
  "C801 1350 617 1337 515 1410 C414 1338 220 1350 98 1315 " +
  "Q38 1295 38 1237 L38 1168 L19 1148 L19 781 L28 767 " +
  "L28 291 L47 274 Z";

function LegendEffects() {
  return (
    <span className="artwork-legend-effects" aria-hidden="true">
      <span className="legend-foil" />
      <svg
        className="legend-frame"
        viewBox="0 0 1086 1448"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path className="legend-frame-base" d={LEGEND_FRAME} />
        <path
          className="legend-frame-light"
          d={LEGEND_FRAME}
          pathLength={100}
        />
        <path className="legend-frame-gold" d={LEGEND_FRAME} pathLength={100} />
      </svg>
      <span className="legend-sparkles">
        {[0, 1, 2, 3, 4, 5].map((spark) => (
          <span className="legend-spark" key={spark} />
        ))}
      </span>
    </span>
  );
}

const STATS = [
  ["MECH", "mechanics", "currentMechanics"],
  ["SENSE", "gameSense", "currentGameSense"],
  ["LANE", "laning", "currentLaning"],
  ["FIGHT", "teamFight", "currentTeamFight"],
  ["MACRO", "macro", "currentMacro"],
  ["TEAM", "teamPlay", "currentTeamPlay"],
  ["MENTAL", "mental", "currentMental"],
  ["POOL", "championPool", "currentChampionPool"],
] as const;

export default function PlayerCardArtwork({
  card,
  player,
}: {
  card: PlayerCard;
  player?: CareerPlayer;
}) {
  const stats = STATS.map(([label, base, current]) => ({
    label,
    value: player?.[current] ?? card[base],
  }));
  const overall = Math.round(
    stats.reduce((sum, stat) => sum + stat.value, 0) / stats.length,
  );
  const legend = hasCardArtwork(card);
  return (
    <span
      className={`player-card-artwork${legend ? " player-card-artwork--legend" : ""}`}
    >
      <img
        draggable={false}
        src={card.imageUrl!}
        alt={`${card.player.nickname} · ${card.cardYear} 선수 카드`}
      />
      {legend && <LegendEffects />}
      <span
        className={`artwork-overall ${overall >= 100 ? "three-digits" : ""}`}
        aria-label={`OVR ${overall}`}
      >
        {overall}
      </span>
      <span className="artwork-stats">
        {stats.map(({ label, value }) => (
          <span key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </span>
        ))}
      </span>
    </span>
  );
}
