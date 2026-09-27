import type { PlayerCard } from "./types";

// A layout is attached to a complete artwork, never to ordinary portrait images.
export function hasCardArtwork(card: PlayerCard) {
  return (
    card.imageUrl === "/player-cards/2021viperEDG.png"
  );
}
