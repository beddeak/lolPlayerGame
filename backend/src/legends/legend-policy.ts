import { createHash } from 'node:crypto';
import { LEGEND_EVENT_CONFIG } from './config/legend-event.config';
export { LEGEND_EVENT_CONFIG } from './config/legend-event.config';

export interface LegendThemeCandidate {
  themeId: number;
  playerCardIds: number[];
}

export interface LegendSeasonPlan {
  events: Array<LegendThemeCandidate & { revealDate: string }>;
  zeroEventStreak: number;
}

export function createLegendRandom(seed: string): () => number {
  let counter = 0;
  return () => {
    const digest = createHash('sha256').update(`${seed}:${counter++}`).digest();
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  };
}

export function planLegendSeason(
  seed: string,
  year: number,
  zeroEventStreak: number,
  candidates: LegendThemeCandidate[],
): LegendSeasonPlan {
  if (
    !Number.isInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    !Number.isInteger(zeroEventStreak) ||
    zeroEventStreak < 0
  ) {
    throw new Error(
      'Legend planning requires a valid year and nonnegative zero-event streak',
    );
  }
  const themes = new Map<number, Set<number>>();
  for (const candidate of candidates) {
    if (
      !Number.isInteger(candidate.themeId) ||
      candidate.themeId <= 0 ||
      candidate.playerCardIds.some((id) => !Number.isInteger(id) || id <= 0)
    ) {
      throw new Error('Legend candidates require positive integer identifiers');
    }
    const cards = themes.get(candidate.themeId) ?? new Set<number>();
    candidate.playerCardIds.forEach((id) => cards.add(id));
    themes.set(candidate.themeId, cards);
  }
  const eligible = [...themes.entries()]
    .filter(([, cards]) => cards.size > 0)
    .sort(([left], [right]) => left - right)
    .map(([themeId, cards]) => ({
      themeId,
      playerCardIds: [...cards].sort((a, b) => a - b),
    }));
  const random = createLegendRandom(`${seed}:${year}`);
  const probabilities =
    zeroEventStreak > 0
      ? LEGEND_EVENT_CONFIG.probabilities.afterZeroSeason
      : LEGEND_EVENT_CONFIG.probabilities.normal;
  const roll = random();
  let count =
    roll < probabilities[0]
      ? 0
      : roll < probabilities[0] + probabilities[1]
        ? 1
        : 2;
  if (zeroEventStreak >= LEGEND_EVENT_CONFIG.guaranteeAfterZeroSeasons) {
    count = Math.max(1, count);
  }
  count = Math.min(count, LEGEND_EVENT_CONFIG.maxEvents, eligible.length);
  const firstDay = Date.parse(
    `${year}-${LEGEND_EVENT_CONFIG.reveal.earliest}T00:00:00Z`,
  );
  const lastDay = Date.parse(
    `${year}-${LEGEND_EVENT_CONFIG.reveal.latest}T00:00:00Z`,
  );
  const availableDates = Array.from(
    { length: Math.round((lastDay - firstDay) / 86_400_000) + 1 },
    (_, index) =>
      new Date(firstDay + index * 86_400_000).toISOString().slice(0, 10),
  );
  const events: LegendSeasonPlan['events'] = [];
  for (let index = 0; index < count; index += 1) {
    const [theme] = eligible.splice(Math.floor(random() * eligible.length), 1);
    const [revealDate] = availableDates.splice(
      Math.floor(random() * availableDates.length),
      1,
    );
    events.push({ ...theme, revealDate });
  }
  events.sort((left, right) => left.revealDate.localeCompare(right.revealDate));
  return {
    events,
    zeroEventStreak: events.length === 0 ? zeroEventStreak + 1 : 0,
  };
}
