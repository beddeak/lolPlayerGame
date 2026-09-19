export const POSITIONS = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;
export type Position = (typeof POSITIONS)[number];

export const REGIONS = ["LCK", "LPL", "LEC", "LCS", "LCP", "CBLOL"] as const;
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
  } | null;
}

export interface CareerTeam {
  id: number;
  code: string;
  clubCode?: string | null;
  logoUrl?: string | null;
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

export type ContractRole = "CORE" | "STARTER" | "ROTATION" | "PROSPECT";
export type ContractPromiseType =
  "STARTER_GUARANTEE" | "CARRY_ROLE" | "STRENGTHEN_TEAM" | "SIGN_POSITION";

export interface ContractPromise {
  type: ContractPromiseType;
  position?: Position;
}

export interface ContractTerms {
  annualSalary: number;
  years: number;
  starterGuarantee: boolean;
  expectedRole: ContractRole;
  promises: ContractPromise[];
}

export type ContractOfferStatus =
  | "WAITING_PLAYER_RESPONSE"
  | "PLAYER_ACCEPTED"
  | "COUNTER_OFFERED"
  | "REJECTED"
  | "WITHDRAWN"
  | "SIGNED";

export type ContractOfferAction =
  "ACCEPT" | "COUNTER" | "KEEP" | "WITHDRAW" | "REQUEST_TIME";

export interface ContractOffer {
  id: number;
  careerId: number;
  careerTeamId: number;
  careerPlayerId: number;
  offerType: "RENEWAL" | "FREE_AGENT" | "TRANSFER";
  sourceCareerTeamId: number | null;
  transferAgreementId: number | null;
  player: {
    nickname: string;
    currentPosition: Position;
    currentAge: number;
  };
  status: ContractOfferStatus;
  revision: number;
  offeredDate: string;
  responseDate: string;
  responseEventId: number | null;
  terms: ContractTerms;
  counterTerms: ContractTerms | null;
  response: {
    kind: "ACCEPTED" | "COUNTER_OFFER" | "REJECTED";
    reason: string;
    evaluatedDate: string;
  } | null;
  extensionsUsed: number;
  history: unknown[];
  createdAt: string;
}

export interface PlayerContract {
  id: number;
  careerId: number;
  careerTeamId: number;
  careerPlayerId: number;
  sourceOfferId: number;
  signedDate: string;
  startDate: string;
  endDate: string;
  terms: ContractTerms;
  promises: Array<ContractPromise & { status: "PENDING" }>;
}

export interface LegendMarketPlayer {
  careerPlayerId: number;
  playerCardId: number;
  nickname: string;
  cardYear: number;
  position: Position;
  currentAge: number;
  overall: number;
  imageUrl: string | null;
  currentTeam: { id: number; code: string; name: string } | null;
  interestedClubs: Array<{ id: number; code: string; name: string }>;
  canNegotiate: boolean;
}

export interface RevealedLegendEvent {
  id: number;
  seasonYear: number;
  theme: { id: number; code: string; name: string };
  revealedDate: string;
  players: LegendMarketPlayer[];
}

export interface LegendEventsResponse {
  careerId: number;
  currentDate: string;
  events: RevealedLegendEvent[];
}

export type CalendarAdvanceMode =
  "ONE_DAY" | "THREE_DAYS" | "NEXT_MATCH" | "NEXT_EVENT";

export type CalendarStopReason =
  | "TARGET_REACHED"
  | "MATCH_DAY"
  | "BLOCKING_EVENT"
  | "MANAGER_DISMISSED"
  | "SEASON_BOUNDARY"
  | "TRANSFER_WINDOW_BOUNDARY";

export type CalendarEventStatus = "SCHEDULED" | "READY" | "COMPLETED";

export type CalendarEventType =
  | "SCHEDULED_GAME"
  | "CONTRACT_RESPONSE"
  | "LEGEND_REVEAL"
  | "LEGEND_SIGNING"
  | "AI_CLUB_UPDATE"
  | "MANAGER_REVIEW"
  | "JOB_SECURITY_WARNING"
  | "MANAGER_DISMISSED"
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

export interface SeasonPeriod {
  code: string;
  label: string;
  kind: "PRESEASON" | "REGIONAL" | "INTERNATIONAL" | "BREAK" | "REVIEW" | "OFFSEASON";
  startsAt: string;
  endsAt: string;
  splitNumber: number | null;
  status: "UPCOMING" | "CURRENT" | "COMPLETED";
  activities: string[];
}

export interface SeasonSchedule {
  year: number;
  currentPhase: SeasonPeriod;
  nextPhase: SeasonPeriod | null;
  nextBoundaryDate: string | null;
  periods: SeasonPeriod[];
}

export interface SeasonScheduleWarning {
  fixtureId: number;
  leagueSplitId: number;
  scheduledDate: string;
  expectedEndDate: string;
  message: string;
}

export interface CalendarResponse {
  careerId: number;
  currentDate: string;
  currentYear: number;
  manager?: ManagerOverview;
  autoSchedule: boolean;
  season: SeasonSchedule;
  scheduleWarnings: SeasonScheduleWarning[];
  seasonReadiness: Array<{
    region: Region;
    teamCount: number;
    status: "READY" | "INSUFFICIENT_TEAMS" | "WAITING_FOR_PREVIOUS_SPLIT" | "NO_REMAINING_SPLIT";
    splitNumber: number | null;
    message: string;
  }>;
  canCloseTransferWindow: boolean;
  transferWindow: {
    seasonYear: number;
    isOpen: boolean;
    opensAt: string;
    endsAt: string;
    nextBoundaryDate: string | null;
    nextBoundaryType: "OPEN" | "CLOSE";
  };
  nextMatch: CalendarFixture | null;
  dueMatches: CalendarFixture[];
  blockingEvents: CalendarEvent[];
}

export interface ManagerOverview {
  careerId: number;
  careerTeamId: number;
  status: "ACTIVE" | "WARNING" | "DISMISSED";
  fanApproval: number;
  boardConfidence: number;
  canManage: boolean;
  trackingStartedDate: string | null;
  reviewYear: number;
  record: {
    played: number;
    wins: number;
    losses: number;
    expectedWins: number;
    winningStreak: number;
    losingStreak: number;
  };
  warning: {
    issuedDate: string;
    issuedAtPlayed: number;
    minimumAdditionalSeries: number;
  } | null;
  dismissedDate: string | null;
  recentReviews: Array<{
    id: number;
    date: string;
    type: "BASELINE" | "EXPECTATION" | "SERIES" | "SPLIT" | "TRANSFER" | "SEASON" | "WARNING" | "RECOVERED" | "DISMISSED";
    title: string;
    reason: string;
    fanDelta: number;
    boardDelta: number;
    fanApproval: number;
    boardConfidence: number;
  }>;
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
  | "MANAGER_DISMISSED"
  | "FIXTURE_LIMIT"
  | "SEASON_BOUNDARY"
  | "TRANSFER_WINDOW_BOUNDARY";

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

export interface Club {
  code: string;
  name: string;
  region: Region;
  logoUrl: string | null;
  selectable: boolean;
  unavailableReason: string | null;
  startingStrength: number | null;
  starters: Array<{ position: Position; playerCard: PlayerCard }>;
  benches: Array<{ playerCard: PlayerCard }>;
}

export interface ClubsResponse {
  startYear: number;
  worldTeamCount: number;
  ready: boolean;
  unavailableReason: string | null;
  clubs: Club[];
}

export interface CreateCareerFromClubPayload {
  clubCode: string;
}
