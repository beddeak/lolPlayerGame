import { Position } from '../../players/enums/position.enum';
import { PlayerPersonality } from '../../players/enums/player-personality.enum';
import type { ClubSeedData } from './club-catalog.seed';

export interface DevelopmentSeedData {
  startYear: number;
  managedTeamCode?: string;
  themes: Array<{ code: string; name: string; description: string | null }>;
  playerCards: DevelopmentPlayerCardData[];
  setBonuses: Array<{
    code: string;
    name: string;
    description: string | null;
    requiredPlayerCardKeys: string[];
    chemistryBonus: number;
    laningBonus: number;
    teamFightBonus: number;
    macroBonus: number;
    teamPlayBonus: number;
  }>;
  teams: ClubSeedData[];
}

export interface DevelopmentPlayerCardData {
  key: string;
  nickname: string;
  nationality?: string;
  themeCode: string;
  cardYear: number;
  startingAge?: number;
  mainPosition: Position;
  imageUrl?: string;
  mechanics: number;
  gameSense: number;
  laning: number;
  teamFight: number;
  macro: number;
  teamPlay: number;
  mental: number;
  championPool: number;
  personality?: PlayerPersonality;
  potential?: number;
}

export const DEVELOPMENT_PLAYER_DEFAULTS = {
  nationality: 'UNKNOWN',
  startingAge: 20,
  personality: PlayerPersonality.PROFESSIONAL,
} as const;
