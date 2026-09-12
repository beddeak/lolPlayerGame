import type { ManagerJobStatus } from './manager-policy';
import type { ManagerReviewType } from './entities/manager-review.entity';

export interface ManagerOverview {
  careerId: number;
  careerTeamId: number;
  status: ManagerJobStatus;
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
    type: ManagerReviewType;
    title: string;
    reason: string;
    fanDelta: number;
    boardDelta: number;
    fanApproval: number;
    boardConfidence: number;
  }>;
}
