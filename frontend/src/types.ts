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
  currentDate: string;
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
  currentDate: string;
  currentMeta: TeamStrategy;
  teams: CareerTeam[];
}

export type CalendarAdvanceMode =
  | "ONE_DAY"
  | "THREE_DAYS"
  | "NEXT_MATCH"
  | "NEXT_EVENT";

export type CalendarStopReason =
  | "TARGET_REACHED"
  | "MATCH_DAY"
  | "BLOCKING_EVENT";

export type CalendarEventStatus = "SCHEDULED" | "READY" | "COMPLETED";

export type CalendarEventType =
  | "SCHEDULED_GAME"
  | "CONTRACT_RESPONSE"
  | "LEGEND_REVEAL"
  | "PLAYER_MEETING"
  | "INTERNATIONAL_ROSTER_REGISTRATION"
  | "SEASON_REVIEW"
  | "TRANSFER_WINDOW_OPEN";

export interface CalendarEvent {
  id: number;
  careerId: number;
  scheduledDate: string;
  type: CalendarEventType;
  status: CalendarEventStatus;
  requiresUserAction: boolean;
  payload: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

export interface FixtureTeam {
  id: number;
  code: string;
  name: string;
}

export interface CalendarFixture {
  id: number;
  scheduledDate: string;
  leagueSplitId: number;
  leagueStageId: number;
  year: number;
  region: Region;
  splitNumber: number;
  stageCode: string;
  roundNumber: number;
  bestOf: number;
  teamA: FixtureTeam;
  teamB: FixtureTeam;
}

export interface CalendarResponse {
  careerId: number;
  currentDate: string;
  currentYear: number;
  nextMatch: CalendarFixture | null;
  dueMatches: CalendarFixture[];
  blockingEvents: CalendarEvent[];
}

export interface CalendarAdvanceResponse extends CalendarResponse {
  mode: CalendarAdvanceMode;
  previousDate: string;
  advancedDays: number;
  stopReason: CalendarStopReason;
  processedEvents: CalendarEvent[];
}

export type LeagueFixtureStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";
export type LeagueSplitStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";
export type LeagueStageStatus = "PLANNED" | "ACTIVE" | "COMPLETED";

export interface LeagueFixture {
  id: number;
  leagueStageId: number;
  fixtureNumber: number;
  stageFixtureNumber: number;
  roundNumber: number;
  scheduledDate: string;
  bestOf: number;
  seed: number;
  status: LeagueFixtureStatus;
  seriesId: number | null;
  teamA: FixtureTeam;
  teamB: FixtureTeam;
  teamAWins: number;
  teamBWins: number;
  winnerTeamId: number | null;
}

export interface LeagueStanding {
  rank: number;
  teamId: number;
  teamCode: string;
  teamName: string;
  played: number;
  seriesWins: number;
  seriesLosses: number;
  gameWins: number;
  gameLosses: number;
  gameDifference: number;
}

export interface LeagueStage {
  id: number;
  sequence: number;
  code: string;
  name: string;
  format: string;
  status: LeagueStageStatus;
  bestOf: number;
  currentRound: number;
  settings: Record<string, unknown>;
  participants: Array<{
    teamId: number;
    teamCode: string;
    teamName: string;
    initialSeed: number;
    groupCode: string | null;
  }>;
  fixtures: LeagueFixture[];
  standings: LeagueStanding[];
}

export interface LeagueSplit {
  id: number;
  careerId: number;
  year: number;
  region: Region;
  splitNumber: number;
  name: string;
  expectedTeamCount: number;
  status: LeagueSplitStatus;
  activeStageCode: string | null;
  stages: LeagueStage[];
  fixtures: LeagueFixture[];
  standings: LeagueStanding[];
}

export interface MatchPlayerStat {
  careerPlayerId: number;
  position: Position;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  dpm: number;
  damageShare: number;
  gold: number;
  goldShare: number;
  gdAt15: number;
  csdAt15: number;
  kp: number;
  rating: number;
}

export interface MatchSimulation {
  matchId: number;
  seriesGameNumber: number | null;
  durationMinutes: number;
  winnerTeamId: number;
  winnerTeamCode: string;
  teams: Array<{
    teamId: number;
    teamCode: string;
    teamStrategy: TeamStrategy;
    performance: number;
    teamKills: number;
    playerStats: MatchPlayerStat[];
  }>;
}

export interface MatchSeries {
  seriesId: number;
  careerId: number;
  bestOf: number;
  winsRequired: number;
  status: "IN_PROGRESS" | "COMPLETED";
  winnerTeamId: number | null;
  nextGameNumber: number | null;
  seed: number;
  teams: Array<{
    teamId: number;
    teamCode: string;
    wins: number;
  }>;
  games: MatchSimulation[];
}

export interface QuickSimResponse {
  mode: "QUICK";
  fixtureId: number;
  gamesSimulated: number;
  series: MatchSeries;
  split: LeagueSplit;
}

export type FastSimStopReason =
  | "TARGET_REACHED"
  | "MANAGED_MATCH"
  | "BLOCKING_EVENT"
  | "FIXTURE_LIMIT";

export interface FastSimResponse {
  mode: "FAST";
  careerId: number;
  previousDate: string;
  currentDate: string;
  targetDate: string;
  advancedDays: number;
  stopReason: FastSimStopReason;
  fixtureLimit: number;
  simulatedFixtures: Array<{
    fixtureId: number;
    leagueSplitId: number;
    scheduledDate: string;
    seriesId: number;
    bestOf: number;
    gamesSimulated: number;
    teamAId: number;
    teamBId: number;
    teamAWins: number;
    teamBWins: number;
    winnerTeamId: number;
  }>;
  blockingEvents: CalendarEvent[];
  calendar: CalendarResponse;
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
