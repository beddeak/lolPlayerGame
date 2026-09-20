import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueStageStatus } from '../leagues/enums/league-stage-status.enum';
import { LeagueFixtureStatus } from '../leagues/enums/league-fixture-status.enum';
import { LeagueSplitStatus } from '../leagues/enums/league-split-status.enum';
import { LeagueSplitResponseDto } from '../leagues/dto/league-split-response.dto';
import { getSeriesWinsRequired } from '../match-series/config/bo3-series.config';
import { TransferRecord } from '../transfers/entities/transfer-record.entity';
import { getTransferWindow } from '../transfers/transfer-window';
import { ManagerJobOffer } from './entities/manager-job-offer.entity';
import {
  isCurrentJobOffer,
  prepareManagerJobOffers,
} from './manager-job-offers';
import { MANAGER_CAREER_CONFIG as CONFIG } from './config/manager-career.config';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import {
  ManagerReview,
  ManagerReviewType,
} from './entities/manager-review.entity';
import { ManagerOverview } from './manager-overview';
import { getManagerFinalRank } from './manager-placement';
import {
  evaluateSeries,
  evaluateSplitReview,
  evaluateTransferReview,
  expectedLeagueRank,
  expectedSeriesWinChance,
} from './manager-policy';

@Injectable()
export class ManagerCareerService {
  constructor(private readonly dataSource: DataSource) {}

  async findOne(accountId: number, careerId: number): Promise<ManagerOverview> {
    const career = await this.dataSource.manager.findOneBy(Career, {
      id: careerId,
      accountId,
    });
    if (!career)
      throw new NotFoundException(`Career ${careerId} was not found`);
    return this.describe(this.dataSource.manager, career);
  }

  /** Read-only even for legacy saves; initialization occurs only in write flows. */
  async describe(
    manager: EntityManager,
    career: Career,
  ): Promise<ManagerOverview> {
    const state = await manager.findOneBy(ManagerCareerState, {
      careerId: career.id,
    });
    const teamId =
      state?.careerTeamId ?? (await this.managedTeam(manager, career.id)).id;
    const jobOffers = getTransferWindow(career.currentDate).isOpen
      ? await manager.find(ManagerJobOffer, {
          where: {
            careerId: career.id,
            fromCareerTeamId: teamId,
            status: 'PENDING',
          },
        })
      : [];
    const reviews = state
      ? await manager.find(ManagerReview, {
          where: {
            careerId: career.id,
            type: Not(In(['EXPECTATION', 'BASELINE'])),
          },
          order: { id: 'DESC' },
          take: 15,
        })
      : [];
    return {
      careerId: career.id,
      careerTeamId: teamId,
      status: state?.status ?? 'ACTIVE',
      fanApproval: state?.fanApproval ?? CONFIG.initialFanApproval,
      boardConfidence: state?.boardConfidence ?? CONFIG.initialBoardConfidence,
      canManage: state?.status !== 'DISMISSED',
      pendingJobOfferCount: jobOffers.filter((offer) =>
        isCurrentJobOffer(offer, career),
      ).length,
      trackingStartedDate: state?.trackingStartedDate ?? null,
      reviewYear: state?.reviewYear ?? career.currentYear,
      record: {
        played: state?.played ?? 0,
        wins: state?.wins ?? 0,
        losses: (state?.played ?? 0) - (state?.wins ?? 0),
        expectedWins: state?.expectedWins ?? 0,
        winningStreak: state?.winningStreak ?? 0,
        losingStreak: state?.losingStreak ?? 0,
      },
      warning:
        state?.warnedDate && state.warningAtPlayed !== null
          ? {
              issuedDate: state.warnedDate,
              issuedAtPlayed: state.warningAtPlayed,
              minimumAdditionalSeries: CONFIG.warningGraceSeries,
            }
          : null,
      dismissedDate: state?.dismissedDate ?? null,
      recentReviews: reviews
        .filter(
          (review) =>
            review.type !== 'EXPECTATION' && review.type !== 'BASELINE',
        )
        .slice(0, 15)
        .map((review) => ({
          id: review.id,
          date: review.reviewedDate,
          type: review.type,
          title: review.title,
          reason: review.reason,
          fanDelta: review.fanDelta,
          boardDelta: review.boardDelta,
          fanApproval: review.fanApproval,
          boardConfidence: review.boardConfidence,
        })),
    };
  }

  /** Caller holds the Career write lock; never grades historical results on adoption. */
  async initialize(
    manager: EntityManager,
    career: Career,
  ): Promise<ManagerCareerState> {
    const existing = await manager.findOneBy(ManagerCareerState, {
      careerId: career.id,
    });
    if (existing) return existing;
    const team = await this.managedTeam(manager, career.id);
    const state = await manager.save(
      ManagerCareerState,
      manager.create(ManagerCareerState, {
        careerId: career.id,
        careerTeamId: team.id,
        status: 'ACTIVE',
        fanApproval: CONFIG.initialFanApproval,
        boardConfidence: CONFIG.initialBoardConfidence,
        trackingStartedDate: career.currentDate,
        reviewYear: career.currentYear,
        played: 0,
        wins: 0,
        expectedWins: 0,
        winningStreak: 0,
        losingStreak: 0,
        warningAtPlayed: null,
        warnedDate: null,
        dismissedDate: null,
      }),
    );
    const fixtures = await manager.find(LeagueFixture, {
      where: [
        { leagueSplit: { careerId: career.id }, teamAId: team.id },
        { leagueSplit: { careerId: career.id }, teamBId: team.id },
      ],
      relations: { series: { games: true } },
    });
    for (const fixture of fixtures) {
      if (!this.fixtureCompleted(fixture)) continue;
      await this.record(
        manager,
        state,
        career.currentDate,
        `SERIES:${fixture.id}`,
        'BASELINE',
        '기존 경기 보존',
        '평가 시작 전 경기에는 소급 평가를 적용하지 않습니다.',
      );
    }
    const splits = await manager.find(LeagueSplit, {
      where: { careerId: career.id, region: team.region },
      relations: { stages: true },
    });
    for (const split of splits) {
      if (
        split.stages.length &&
        split.stages.every(
          (stage) => stage.status === LeagueStageStatus.COMPLETED,
        )
      ) {
        await this.record(
          manager,
          state,
          career.currentDate,
          `SPLIT:${split.id}`,
          'BASELINE',
          '기존 시즌 보존',
          '평가 시작 전 시즌 성적은 소급 적용하지 않습니다.',
        );
      }
    }
    return state;
  }

  /** The caller holds the Career lock and has switched the two club ownership flags. */
  async adoptTeam(
    manager: EntityManager,
    career: Career,
    state: ManagerCareerState,
    target: CareerTeam,
    previous: CareerTeam,
  ): Promise<void> {
    const previousRecord = { ...state };
    Object.assign(state, {
      careerTeamId: target.id,
      status: 'ACTIVE',
      fanApproval: CONFIG.initialFanApproval,
      boardConfidence: CONFIG.initialBoardConfidence,
      trackingStartedDate: career.currentDate,
      reviewYear: career.currentYear,
      played: 0,
      wins: 0,
      expectedWins: 0,
      winningStreak: 0,
      losingStreak: 0,
      warningAtPlayed: null,
      warnedDate: null,
      dismissedDate: null,
    });
    const baseline = async (sourceKey: string, reason: string) => {
      if (await this.hasReview(manager, career.id, sourceKey)) return;
      await this.record(
        manager,
        state,
        career.currentDate,
        sourceKey,
        'BASELINE',
        '부임 전 기록 보존',
        reason,
      );
    };
    const fixtures = await manager.find(LeagueFixture, {
      where: [
        { leagueSplit: { careerId: career.id }, teamAId: target.id },
        { leagueSplit: { careerId: career.id }, teamBId: target.id },
      ],
      relations: { series: { games: true } },
    });
    const startedSplits = new Set<number>();
    for (const fixture of fixtures) {
      if (!fixture.series?.games.length) continue;
      startedSplits.add(fixture.leagueSplitId);
      await baseline(
        `SERIES:${fixture.id}`,
        '부임 전에 진행된 경기는 새 구단 감독의 평가에 소급 반영하지 않습니다.',
      );
    }
    const splits = await manager.find(LeagueSplit, {
      where: { careerId: career.id, region: target.region },
      relations: { stages: true },
    });
    for (const split of splits) {
      if (
        startedSplits.has(split.id) ||
        (split.stages.length > 0 &&
          split.stages.every(
            (stage) => stage.status === LeagueStageStatus.COMPLETED,
          ))
      ) {
        await baseline(
          `SPLIT:${split.id}`,
          '부임 전에 시작된 스플릿의 최종 순위는 새 감독의 평가에 소급 반영하지 않습니다.',
        );
      }
    }
    const transfers = await manager.find(TransferRecord, {
      where: [
        { careerId: career.id, sourceCareerTeamId: target.id },
        { careerId: career.id, destinationCareerTeamId: target.id },
      ],
    });
    for (const transfer of transfers) {
      if (transfer.completedDate <= career.currentDate)
        await baseline(
          `TRANSFER:${transfer.id}`,
          '부임 전에 완료된 선수 이동은 새 감독의 평가에 소급 반영하지 않습니다.',
        );
    }
    await manager.save(ManagerCareerState, state);
    const review = await this.record(
      manager,
      state,
      career.currentDate,
      `APPOINTMENT:${target.id}:${career.currentDate}`,
      'SEASON',
      `${target.name} 감독 부임`,
      `${previous.name}에서 ${target.name}(으)로 부임했습니다. 이전 구단의 기록은 보존하고 새 구단 평가는 부임 시점부터 시작합니다.`,
      0,
      0,
      {
        previousTeamId: previous.id,
        careerTeamId: target.id,
        previousManagerState: previousRecord,
      },
    );
    await this.publish(manager, state, review);
  }

  /** Freeze public strengths before the first observed game, never private potential. */
  async prepareLeague(
    manager: EntityManager,
    career: Career,
    splitId: number,
  ): Promise<void> {
    const state = await this.initialize(manager, career);
    if (
      state.status === 'DISMISSED' ||
      (await this.hasReview(manager, career.id, `EXPECTATION:${splitId}`))
    )
      return;
    const split = await manager.findOne(LeagueSplit, {
      where: { id: splitId, careerId: career.id },
      relations: { stages: { participants: true } },
    });
    if (!split) return;
    const firstStage = [...split.stages].sort(
      (a, b) => a.sequence - b.sequence,
    )[0];
    const teamIds =
      firstStage?.participants.map((row) => row.careerTeamId) ?? [];
    if (!teamIds.includes(state.careerTeamId) || teamIds.length < 2) return;
    const rosters = await manager.find(Roster, {
      where: { careerTeam: { careerId: career.id }, role: RosterRole.STARTER },
      relations: { careerPlayer: true },
    });
    const strengths: Record<string, number> = {};
    for (const teamId of teamIds) {
      strengths[teamId] =
        rosters
          .filter((row) => row.careerTeamId === teamId)
          .reduce((sum, row) => {
            const p = row.careerPlayer;
            return (
              sum +
              (p.currentMechanics +
                p.currentGameSense +
                p.currentLaning +
                p.currentTeamFight +
                p.currentMacro +
                p.currentTeamPlay +
                p.currentMental +
                p.currentChampionPool) /
                8
            );
          }, 0) / 5;
    }
    await this.record(
      manager,
      state,
      career.currentDate,
      `EXPECTATION:${splitId}`,
      'EXPECTATION',
      `${split.year} ${split.region} Split ${split.splitNumber} 기대치`,
      '첫 평가 전 공개 주전 전력으로 기대치를 고정했습니다.',
      0,
      0,
      {
        strengths,
        teamCount: teamIds.length,
        expectedRank: expectedLeagueRank(
          strengths[state.careerTeamId],
          Object.values(strengths),
        ),
      },
    );
  }

  /** Called AFTER league progression so a dismissal cannot strand the final game. */
  async reviewLeague(
    manager: EntityManager,
    career: Career,
    split: LeagueSplitResponseDto,
  ): Promise<void> {
    const state = await this.initialize(manager, career);
    if (state.status === 'DISMISSED') return;
    await this.prepareLeague(manager, career, split.id);
    const expectation = await manager.findOneBy(ManagerReview, {
      careerId: career.id,
      sourceKey: `EXPECTATION:${split.id}`,
    });
    if (!expectation?.payload) return;
    const strengths = expectation.payload.strengths as Record<string, number>;
    for (const fixture of [...split.fixtures].sort((a, b) => a.id - b.id)) {
      if (this.dismissed(state)) break;
      if (
        fixture.status !== LeagueFixtureStatus.COMPLETED ||
        ![fixture.teamA.id, fixture.teamB.id].includes(state.careerTeamId) ||
        (await this.hasReview(manager, career.id, `SERIES:${fixture.id}`))
      )
        continue;
      const opponentId =
        fixture.teamA.id === state.careerTeamId
          ? fixture.teamB.id
          : fixture.teamA.id;
      const previousFan = state.fanApproval;
      const previousBoard = state.boardConfidence;
      const evaluation = evaluateSeries({
        ...state,
        won: fixture.winnerTeamId === state.careerTeamId,
        expectedWinChance: expectedSeriesWinChance(
          strengths[state.careerTeamId],
          strengths[opponentId],
        ),
      });
      const { reason, transition, ...updated } = evaluation;
      Object.assign(state, updated);
      if (transition === 'WARNING') state.warnedDate = career.currentDate;
      if (transition === 'RECOVERED') state.warnedDate = null;
      if (transition === 'DISMISSED') state.dismissedDate = career.currentDate;
      const type = transition === 'NONE' ? 'SERIES' : transition;
      const review = await this.record(
        manager,
        state,
        career.currentDate,
        `SERIES:${fixture.id}`,
        type,
        transition === 'WARNING'
          ? '경질 경고'
          : transition === 'DISMISSED'
            ? '감독 경질'
            : transition === 'RECOVERED'
              ? '경질 경고 해제'
              : '공식 시리즈 평가',
        reason,
        state.fanApproval - previousFan,
        state.boardConfidence - previousBoard,
        { fixtureId: fixture.id, leagueSplitId: split.id },
      );
      await this.publish(manager, state, review);
    }
    if (
      !this.dismissed(state) &&
      split.status === LeagueSplitStatus.COMPLETED &&
      !(await this.hasReview(manager, career.id, `SPLIT:${split.id}`))
    ) {
      const rank = getManagerFinalRank(split, state.careerTeamId);
      if (rank !== undefined) {
        const review = evaluateSplitReview({
          ...state,
          rank,
          expectedRank: expectedLeagueRank(
            strengths[state.careerTeamId],
            Object.values(strengths),
          ),
          teamCount: Number(expectation.payload.teamCount),
        });
        state.fanApproval = review.fanApproval;
        state.boardConfidence = review.boardConfidence;
        await this.publish(
          manager,
          state,
          await this.record(
            manager,
            state,
            career.currentDate,
            `SPLIT:${split.id}`,
            'SPLIT',
            `${split.year} ${split.name} 최종 평가`,
            review.reason,
            review.fanDelta,
            review.boardDelta,
            {
              rank,
              expectedRank: expectedLeagueRank(
                strengths[state.careerTeamId],
                Object.values(strengths),
              ),
            },
          ),
        );
      }
    }
    await manager.save(ManagerCareerState, state);
  }

  /** Calendar/AI/contract flow owns the same Career lock. */
  async processDay(
    manager: EntityManager,
    career: Career,
    date: string,
  ): Promise<CalendarEvent[]> {
    const state = await this.initialize(manager, {
      ...career,
      currentDate: date,
    });
    if (Number(date.slice(0, 4)) < state.reviewYear) return [];
    const news = await prepareManagerJobOffers(
      manager,
      { ...career, currentDate: date, currentYear: Number(date.slice(0, 4)) },
      state,
    );
    if (state.status === 'DISMISSED') return news;
    if (state.reviewYear < Number(date.slice(0, 4))) {
      state.reviewYear = Number(date.slice(0, 4));
      const review = await this.record(
        manager,
        state,
        date,
        `SEASON:${state.reviewYear}`,
        'SEASON',
        '새 시즌 감독 평가',
        '팬 지지도·이사회 신뢰·누적 공식 전적과 경고 유예는 새해에도 유지합니다.',
      );
      news.push(await this.publish(manager, state, review));
    }
    const transfers = await manager.find(TransferRecord, {
      where: [
        { careerId: career.id, sourceCareerTeamId: state.careerTeamId },
        { careerId: career.id, destinationCareerTeamId: state.careerTeamId },
      ],
      order: { id: 'ASC' },
    });
    const processedTransferKeys = new Set(
      (
        await manager.find(ManagerReview, {
          where: { careerId: career.id },
          select: { sourceKey: true },
        })
      ).map((review) => review.sourceKey),
    );
    for (const transfer of transfers) {
      if (
        transfer.completedDate > date ||
        transfer.managerLineupBefore == null ||
        transfer.managerLineupAfter == null
      )
        continue;
      const key = `TRANSFER:${transfer.id}`;
      if (processedTransferKeys.has(key)) continue;
      const evaluation = evaluateTransferReview({
        ...state,
        kind:
          transfer.destinationCareerTeamId === state.careerTeamId
            ? 'ACQUISITION'
            : 'RELEASE',
        abilityDelta:
          transfer.managerLineupAfter - transfer.managerLineupBefore,
      });
      state.fanApproval = evaluation.fanApproval;
      state.boardConfidence = evaluation.boardConfidence;
      const review = await this.record(
        manager,
        state,
        date,
        key,
        'TRANSFER',
        '선수단 변경 평가',
        evaluation.reason,
        evaluation.fanDelta,
        evaluation.boardDelta,
        { transferRecordId: transfer.id },
      );
      news.push(await this.publish(manager, state, review));
    }
    await manager.save(ManagerCareerState, state);
    return news;
  }

  private async managedTeam(
    manager: EntityManager,
    careerId: number,
  ): Promise<CareerTeam> {
    const team = await manager.findOneBy(CareerTeam, {
      careerId,
      isUserControlled: true,
    });
    if (!team)
      throw new NotFoundException(
        `Managed team for Career ${careerId} was not found`,
      );
    return team;
  }
  private dismissed(state: ManagerCareerState): boolean {
    return state.status === 'DISMISSED';
  }
  private fixtureCompleted(fixture: LeagueFixture): boolean {
    const needed = getSeriesWinsRequired(fixture.bestOf);
    return [fixture.teamAId, fixture.teamBId].some(
      (teamId) =>
        (fixture.series?.games ?? []).filter(
          (game) => game.winnerTeamId === teamId,
        ).length >= needed,
    );
  }
  private hasReview(
    manager: EntityManager,
    careerId: number,
    sourceKey: string,
  ): Promise<boolean> {
    return manager.existsBy(ManagerReview, { careerId, sourceKey });
  }
  private record(
    manager: EntityManager,
    state: ManagerCareerState,
    date: string,
    sourceKey: string,
    type: ManagerReviewType,
    title: string,
    reason: string,
    fanDelta = 0,
    boardDelta = 0,
    payload: Record<string, unknown> | null = null,
  ): Promise<ManagerReview> {
    return manager.save(
      ManagerReview,
      manager.create(ManagerReview, {
        careerId: state.careerId,
        sourceKey,
        type,
        reviewedDate: date,
        title,
        reason,
        fanDelta: Math.round(fanDelta * 100) / 100,
        boardDelta: Math.round(boardDelta * 100) / 100,
        fanApproval: state.fanApproval,
        boardConfidence: state.boardConfidence,
        payload,
      }),
    );
  }
  private publish(
    manager: EntityManager,
    state: ManagerCareerState,
    review: ManagerReview,
  ): Promise<CalendarEvent> {
    return manager.save(
      CalendarEvent,
      manager.create(CalendarEvent, {
        careerId: state.careerId,
        scheduledDate: review.reviewedDate,
        type:
          review.type === 'DISMISSED'
            ? CalendarEventType.MANAGER_DISMISSED
            : review.type === 'WARNING'
              ? CalendarEventType.JOB_SECURITY_WARNING
              : CalendarEventType.MANAGER_REVIEW,
        status: CalendarEventStatus.COMPLETED,
        requiresUserAction: false,
        completedAt: new Date(),
        payload: {
          managerReviewId: review.id,
          title: review.title,
          message: review.reason,
        },
      }),
    );
  }
}
