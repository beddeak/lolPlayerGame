export const POSITIONS = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;
export type Position = (typeof POSITIONS)[number];

export const REGIONS = ["LCK", "LPL", "LEC", "LCS"] as const;
export type Region = (typeof REGIONS)[number];

export type TeamStrategy =
  | "BALANCED"
  | "TOP_CARRY"
  | "TOP_JUNGLE"
  | "MID_CARRY"
  | "MID_JUNGLE"
  | "UPPER_SIDE"
  | "BOT_CARRY"
  | "BOT_PRESSURE";

export interface Account {
  id: number;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  account: Account;
}

export interface PlayerCard {
  id: number;
  playerId: number;
  themeId: number;
  cardYear: number;
  startingAge: number;
  imageUrl: string | null;
  mainPosition: Position;
  mechanics: number;
  gameSense: number;
  laning: number;
  teamFight: number;
  macro: number;
  teamPlay: number;
  mental: number;
  championPool: number;
  personality: string;
  player: {
    id: number;
    nickname: string;
    nationality: string;
  };
  theme: {
    id: number;
    code: string;
    name: string;
    description: string | null;
  };
}

export interface CareerSummary {
  id: number;
  startYear: number;
  currentYear: number;
  currentMeta: TeamStrategy;
  managedTeamId: number;
  managedTeamCode: string;
  managedTeamName: string;
}

export interface CareerPlayer {
  id: number;
  playerCardId: number;
  currentTeamId: number | null;
  currentAge: number;
  currentPosition: Position;
  currentMechanics: number;
  currentGameSense: number;
  currentLaning: number;
  currentTeamFight: number;
  currentMacro: number;
  currentTeamPlay: number;
  currentMental: number;
  currentChampionPool: number;
  form: number;
  condition: number;
  personality: string;
  coachTrust: number;
  playerCard: PlayerCard;
  roleProficiencies: Array<{
    position: Position;
    instruction: string;
    proficiency: number;
  }>;
  positionProficiencies: Array<{
    position: Position;
    proficiency: number;
  }>;
}

export interface CareerRoster {
  id: number;
  role: "STARTER" | "BENCH";
  starterPosition: Position | null;
  playerInstruction: string | null;
  championArchetype: string | null;
  careerPlayer: CareerPlayer;
}

export interface SwapStarterResponse {
  careerId: number;
  careerTeamId: number;
  position: Position;
  promotedStarter: {
    rosterId: number;
    careerPlayerId: number;
    role: "STARTER";
    starterPosition: Position;
  };
  demotedBench: {
    rosterId: number;
    careerPlayerId: number;
    role: "BENCH";
    starterPosition: null;
  };
}

export interface CareerTeam {
  id: number;
  code: string;
  name: string;
  region: Region;
  isUserControlled: boolean;
  teamStrategy: TeamStrategy;
  chemistry: number;
  strategyProficiencies: Array<{
    strategy: TeamStrategy;
    proficiency: number;
  }>;
  activeSetBonuses: Array<{
    id?: number;
    code?: string;
    name?: string;
    description?: string | null;
  }>;
  starters: CareerRoster[];
  benches: CareerRoster[];
}

export interface Career {
  id: number;
  startYear: number;
  currentYear: number;
  currentMeta: TeamStrategy;
  teams: CareerTeam[];
}

export interface CreateCareerPayload {
  startYear: number;
  managedTeamCode: string;
  teams: Array<{
    code: string;
    name: string;
    region: Region;
    starters: Array<{
      playerCardId: number;
      position: Position;
    }>;
    benches?: Array<{
      playerCardId: number;
    }>;
  }>;
}
