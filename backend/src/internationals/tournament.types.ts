/** Competition rules use all six regions independently of catalog completeness. */
export const INTERNATIONAL_REGIONS = [
  'LCK',
  'LPL',
  'LEC',
  'LCS',
  'LCP',
  'CBLOL',
] as const;
export type InternationalRegion = (typeof INTERNATIONAL_REGIONS)[number];
export enum InternationalKind {
  FIRST_STAND = 'FIRST_STAND',
  MSI = 'MSI',
  WORLDS = 'WORLDS',
}
export interface Entrant {
  teamId: number;
  region: InternationalRegion;
  regionalSeed: number;
  entry: 'MAIN' | 'PLAY_IN';
}
export type Slot =
  { teamId: number } | { match: string; result: 'WINNER' | 'LOSER' };
export interface TournamentGame {
  key: string;
  stage: string;
  round: number;
  day: string;
  bestOf: 1 | 3 | 5;
  a: Slot;
  b: Slot;
  winner: number | null;
}
export interface TournamentState {
  version: 1;
  kind: InternationalKind;
  year: number;
  entrants: Entrant[];
  games: TournamentGame[];
  champion: number | null;
}
