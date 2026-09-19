import { MANAGER_CAREER_CONFIG } from './config/manager-career.config';
import { PLAYER_CARD_STAT_MAX } from '../players/constants/player-card.constants';

export type ManagerJobStatus = 'ACTIVE' | 'WARNING' | 'DISMISSED';
export type ManagerTransition = 'NONE' | 'WARNING' | 'RECOVERED' | 'DISMISSED';

export interface ManagerRatings {
  fanApproval: number;
  boardConfidence: number;
}

export interface ManagerResultState extends ManagerRatings {
  played: number;
  wins: number;
  expectedWins: number;
  winningStreak: number;
  losingStreak: number;
  status: ManagerJobStatus;
  warningAtPlayed: number | null;
}

export interface ManagerSeriesInput extends ManagerResultState {
  won: boolean;
  expectedWinChance: number;
}

export interface ManagerSeriesEvaluation extends ManagerResultState {
  reason: string;
  transition: ManagerTransition;
}

export interface ManagerRatingReview extends ManagerRatings {
  fanDelta: number;
  boardDelta: number;
  reason: string;
}

export interface ManagerSplitReviewInput extends ManagerRatings {
  rank: number;
  expectedRank: number;
  teamCount: number;
}

export interface ManagerTransferReviewInput extends ManagerRatings {
  kind: 'ACQUISITION' | 'RELEASE';
  /** Signed change in public lineup ability AFTER minus BEFORE the transaction. */
  abilityDelta: number;
}

function finite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
}

function inRange(value: number, field: string, min: number, max: number): void {
  finite(value, field);
  if (value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
}

function counter(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeRatings(ratings: ManagerRatings): ManagerRatings {
  finite(ratings.fanApproval, 'fanApproval');
  finite(ratings.boardConfidence, 'boardConfidence');
  return {
    fanApproval: round(clamp(ratings.fanApproval, 0, 100)),
    boardConfidence: round(clamp(ratings.boardConfidence, 0, 100)),
  };
}

function validateState(input: ManagerResultState): void {
  counter(input.played, 'played');
  counter(input.wins, 'wins');
  counter(input.winningStreak, 'winningStreak');
  counter(input.losingStreak, 'losingStreak');
  inRange(input.expectedWins, 'expectedWins', 0, input.played);
  if (
    input.wins > input.played ||
    input.winningStreak > input.wins ||
    input.losingStreak > input.played - input.wins ||
    (input.winningStreak > 0 && input.losingStreak > 0)
  ) {
    throw new Error('Manager result counters are inconsistent');
  }
  if (!['ACTIVE', 'WARNING', 'DISMISSED'].includes(input.status)) {
    throw new Error('Unknown manager job status');
  }
  if (input.warningAtPlayed !== null) {
    counter(input.warningAtPlayed, 'warningAtPlayed');
    if (input.warningAtPlayed > input.played) {
      throw new Error('warningAtPlayed cannot exceed played');
    }
  }
  if (input.status === 'WARNING' && input.warningAtPlayed === null) {
    throw new Error('A warning must record its starting series count');
  }
}

/**
 * Current public lineup strength only. This is a management expectation, not a
 * replacement for the match simulator and never uses private potential or buffs.
 */
export function expectedSeriesWinChance(
  teamStrength: number,
  opponentStrength: number,
): number {
  inRange(teamStrength, 'teamStrength', 0, PLAYER_CARD_STAT_MAX);
  inRange(opponentStrength, 'opponentStrength', 0, PLAYER_CARD_STAT_MAX);
  const config = MANAGER_CAREER_CONFIG;
  return clamp(
    0.5 +
      ((teamStrength - opponentStrength) /
        config.abilityDifferenceForMaximumAdvantage) *
        (config.maximumWinChance - 0.5),
    config.minimumWinChance,
    config.maximumWinChance,
  );
}

/** leagueStrengths includes the managed team. Equal strength shares mean rank. */
export function expectedLeagueRank(
  teamStrength: number,
  leagueStrengths: readonly number[],
): number {
  inRange(teamStrength, 'teamStrength', 0, PLAYER_CARD_STAT_MAX);
  if (leagueStrengths.length === 0 || !leagueStrengths.includes(teamStrength)) {
    throw new Error('leagueStrengths must include the managed team');
  }
  let stronger = 0;
  let equal = 0;
  for (const strength of leagueStrengths) {
    inRange(strength, 'leagueStrength', 0, PLAYER_CARD_STAT_MAX);
    if (strength > teamStrength) stronger += 1;
    if (strength === teamStrength) equal += 1;
  }
  return 1 + stronger + (equal - 1) / 2;
}

/** Ratings alone never count as poor sporting results. */
export function hasPoorManagerResults(state: ManagerResultState): boolean {
  validateState(state);
  const config = MANAGER_CAREER_CONFIG;
  return (
    state.played >= config.minimumSeriesForWarning &&
    (state.losingStreak >= config.poorResultLosingStreak ||
      (state.wins / state.played <= config.poorResultMaximumWinRate &&
        state.expectedWins - state.wins >=
          config.poorResultExpectedWinsDeficit))
  );
}

/**
 * One completed, competitive SERIES, not one set or repeated calendar tick.
 * The caller must persist a unique review key; this pure function has no clock
 * or storage and cannot identify whether a series has already been processed.
 */
export function evaluateSeries(
  input: ManagerSeriesInput,
): ManagerSeriesEvaluation {
  validateState(input);
  inRange(input.expectedWinChance, 'expectedWinChance', 0, 1);
  if (typeof input.won !== 'boolean') {
    throw new Error('won must be boolean');
  }
  const ratings = normalizeRatings(input);
  if (input.status === 'DISMISSED') {
    return {
      ...ratings,
      played: input.played,
      wins: input.wins,
      expectedWins: input.expectedWins,
      winningStreak: input.winningStreak,
      losingStreak: input.losingStreak,
      status: input.status,
      warningAtPlayed: input.warningAtPlayed,
      reason: '경질 이후 경기 결과는 이전 감독의 평가에 반영하지 않습니다.',
      transition: 'NONE',
    };
  }
  if (input.played === Number.MAX_SAFE_INTEGER) {
    throw new Error('played cannot exceed the safe integer range');
  }
  const config = MANAGER_CAREER_CONFIG;
  const winningStreak = input.won ? input.winningStreak + 1 : 0;
  const losingStreak = input.won ? 0 : input.losingStreak + 1;
  const signedStreak = (startsAt: number, maximum: number): number =>
    (input.won ? 1 : -1) *
    clamp(
      (input.won ? winningStreak : losingStreak) - startsAt + 1,
      0,
      maximum,
    );
  const resultDelta = Number(input.won) - input.expectedWinChance;
  const next: ManagerSeriesEvaluation = {
    fanApproval: round(
      clamp(
        ratings.fanApproval +
          resultDelta * config.fanResultWeight +
          signedStreak(config.fanStreakStartsAt, config.fanMaximumStreakEffect),
        0,
        100,
      ),
    ),
    boardConfidence: round(
      clamp(
        ratings.boardConfidence +
          resultDelta * config.boardResultWeight +
          signedStreak(
            config.boardStreakStartsAt,
            config.boardMaximumStreakEffect,
          ),
        0,
        100,
      ),
    ),
    played: input.played + 1,
    wins: input.wins + Number(input.won),
    expectedWins: input.expectedWins + input.expectedWinChance,
    winningStreak,
    losingStreak,
    status: input.status,
    warningAtPlayed: input.warningAtPlayed,
    reason: input.won
      ? '시리즈 승리와 상대 전력 대비 기대치를 감독 평가에 반영했습니다.'
      : '시리즈 패배와 상대 전력 대비 기대치를 감독 평가에 반영했습니다.',
    transition: 'NONE',
  };
  const poorResults = hasPoorManagerResults(next);
  if (
    next.status === 'WARNING' &&
    next.winningStreak >= config.recoveryWinningStreak &&
    (!poorResults ||
      next.fanApproval >= config.recoveryFanApproval ||
      next.boardConfidence >= config.recoveryBoardConfidence)
  ) {
    next.status = 'ACTIVE';
    next.warningAtPlayed = null;
    next.transition = 'RECOVERED';
    next.reason = '연승과 성적 개선으로 경질 경고가 해제되었습니다.';
  } else if (
    next.status === 'WARNING' &&
    next.warningAtPlayed !== null &&
    next.played - next.warningAtPlayed >= config.warningGraceSeries &&
    poorResults &&
    next.fanApproval <= config.dismissalFanApproval &&
    next.boardConfidence <= config.dismissalBoardConfidence
  ) {
    next.status = 'DISMISSED';
    next.transition = 'DISMISSED';
    next.reason =
      '경고 이후 유예 경기 동안 성적과 팬 지지, 이사회 신뢰가 모두 회복되지 않아 경질되었습니다.';
  } else if (
    next.status === 'ACTIVE' &&
    poorResults &&
    next.fanApproval <= config.warningFanApproval &&
    next.boardConfidence <= config.warningBoardConfidence
  ) {
    next.status = 'WARNING';
    next.warningAtPlayed = next.played;
    next.transition = 'WARNING';
    next.reason =
      '부진한 성적과 낮은 팬 지지, 이사회 신뢰로 경질 경고를 받았습니다. 최소 3시리즈의 개선 기회가 주어집니다.';
  }
  return next;
}

function ratingReview(
  input: ManagerRatings,
  fanEffect: number,
  boardEffect: number,
  reason: string,
): ManagerRatingReview {
  const original = normalizeRatings(input);
  const updated = normalizeRatings({
    fanApproval: original.fanApproval + fanEffect,
    boardConfidence: original.boardConfidence + boardEffect,
  });
  return {
    ...updated,
    fanDelta: round(updated.fanApproval - original.fanApproval),
    boardDelta: round(updated.boardConfidence - original.boardConfidence),
    reason,
  };
}

/** A one-time split summary; never bypasses the series warning/grace period. */
export function evaluateSplitReview(
  input: ManagerSplitReviewInput,
): ManagerRatingReview {
  counter(input.teamCount, 'teamCount');
  if (input.teamCount < 2) throw new Error('A split needs at least two teams');
  counter(input.rank, 'rank');
  inRange(input.rank, 'rank', 1, input.teamCount);
  inRange(input.expectedRank, 'expectedRank', 1, input.teamCount);
  const performance = (input.expectedRank - input.rank) / (input.teamCount - 1);
  return ratingReview(
    input,
    performance * MANAGER_CAREER_CONFIG.splitMaximumFanEffect,
    performance * MANAGER_CAREER_CONFIG.splitMaximumBoardEffect,
    performance > 0
      ? '스플릿 최종 순위가 시즌 시작 기대 순위를 웃돌았습니다.'
      : performance < 0
        ? '스플릿 최종 순위가 시즌 시작 기대 순위에 미치지 못했습니다.'
        : '스플릿 최종 순위가 시즌 시작 기대 순위와 일치합니다.',
  );
}

/**
 * Small roster-quality feedback, NOT popularity or a complete finance policy.
 * The signed delta is measured once from the pre/post public starting lineup;
 * signing a reserve or renewing a contract without an upgrade is not a reward.
 */
export function evaluateTransferReview(
  input: ManagerTransferReviewInput,
): ManagerRatingReview {
  inRange(input.abilityDelta, 'abilityDelta', -100, 100);
  if (!['ACQUISITION', 'RELEASE'].includes(input.kind)) {
    throw new Error('Unknown manager transfer review kind');
  }
  const config = MANAGER_CAREER_CONFIG;
  return ratingReview(
    input,
    clamp(
      input.abilityDelta * config.transferFanEffectPerAbility,
      -config.transferMaximumFanEffect,
      config.transferMaximumFanEffect,
    ),
    clamp(
      input.abilityDelta * config.transferBoardEffectPerAbility,
      -config.transferMaximumBoardEffect,
      config.transferMaximumBoardEffect,
    ),
    `${input.kind === 'ACQUISITION' ? '영입' : '선수 방출 또는 이적'}으로 인한 공개 주전 전력 변화를 반영했습니다.`,
  );
}
