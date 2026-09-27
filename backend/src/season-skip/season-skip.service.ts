import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { TrainingSession } from '../careers/entities/training-session.entity';
import { TrainingService } from '../careers/training.service';
import { TrainingType } from '../careers/enums/training-type.enum';
import { TrainingCategory } from '../careers/enums/training-category.enum';
import { withCareerAutomationLock } from '../careers/career-automation-lock';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueStageStatus } from '../leagues/enums/league-stage-status.enum';
import { LeaguesService } from '../leagues/leagues.service';
import { CalendarsService } from '../calendars/calendars.service';
import { CalendarAdvanceMode } from '../calendars/enums/calendar-advance-mode.enum';
import { getLeagueSplitWindow } from '../calendars/config/season-calendar.config';
import { Match } from '../matches/entities/match.entity';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import { updateSeriesDraft } from '../drafts/series-draft.store';
import { SeasonSkipDto } from './season-skip.dto';
import { isRegularStage, plannedActivity } from './season-skip.policy';

@Injectable()
export class SeasonSkipService {
  constructor(
    private readonly db: DataSource,
    private readonly calendars: CalendarsService,
    private readonly leagues: LeaguesService,
    private readonly training: TrainingService,
  ) {}

  private async context(accountId: number, careerId: number) {
    const career = await this.db.manager.findOneBy(Career, {
      id: careerId,
      accountId,
    });
    if (!career)
      throw new NotFoundException('자신의 커리어만 진행할 수 있습니다.');
    const team = await this.db.manager.findOne(CareerTeam, {
      where: { careerId, isUserControlled: true },
      relations: {
        rosters: { careerPlayer: { playerCard: { player: true } } },
        strategyProficiencies: true,
      },
    });
    if (!team) throw new NotFoundException('감독 구단을 찾을 수 없습니다.');
    const splits = await this.db.manager.find(LeagueSplit, {
      where: { careerId, year: career.currentYear, region: team.region },
      relations: { stages: true },
      order: { splitNumber: 'ASC' },
    });
    const split = splits.find((s) =>
      s.stages.some((stage) => stage.status !== LeagueStageStatus.COMPLETED),
    );
    const stage = split?.stages
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .find((s) => s.status !== LeagueStageStatus.COMPLETED);
    return { career, team, split, stage };
  }

  private async progress(careerId: number) {
    const career = await this.db.manager.findOneByOrFail(Career, {
      id: careerId,
    });
    const [games, activities] = await Promise.all([
      this.db.manager.count(Match, { where: { careerId } }),
      this.db.manager.count(TrainingSession, {
        where: { trainingPeriod: { careerId } },
      }),
    ]);
    return {
      currentDate: career.currentDate,
      games,
      activities,
      cursor: `${career.currentDate}:${games}:${activities}`,
    };
  }

  async inspect(accountId: number, careerId: number) {
    const { team, split, stage } = await this.context(accountId, careerId);
    return {
      ...(await this.progress(careerId)),
      splitId: split?.id ?? null,
      label: split
        ? `${team.region} Split ${split.splitNumber}`
        : '진행할 정규시즌 없음',
      available: Boolean(stage && isRegularStage(stage.format)),
      reason: !stage
        ? '시즌 일정을 먼저 준비해 주세요. 완료된 스플릿은 건너뛰지 않습니다.'
        : !isRegularStage(stage.format)
          ? '이미 플레이인·토너먼트 단계입니다.'
          : null,
      players: team.rosters.map((r) => ({
        id: r.careerPlayerId,
        nickname: r.careerPlayer.playerCard.player.nickname,
      })),
    };
  }

  async step(accountId: number, careerId: number, dto: SeasonSkipDto) {
    await this.context(accountId, careerId);
    return withCareerAutomationLock(this.db, careerId, async () => {
      const { career, team, split, stage } = await this.context(
        accountId,
        careerId,
      );
      const before = await this.progress(careerId);
      if (before.cursor !== dto.cursor)
        throw new ConflictException(
          '날짜·경기·활동이 변경됐습니다. 현재 상태를 다시 확인하세요.',
        );
      if (
        !Number.isFinite(Date.parse(dto.startDate)) ||
        new Date(dto.startDate).toISOString().slice(0, 10) !== dto.startDate ||
        dto.startDate > before.currentDate ||
        dto.startDate.slice(0, 4) !== String(career.currentYear)
      )
        throw new BadRequestException(
          '자동 진행 시작 날짜가 올바르지 않습니다.',
        );
      const finish = async (
        message: string,
        stopped = false,
        done = false,
      ) => ({ ...(await this.progress(careerId)), message, stopped, done });
      if (!split || split.id !== dto.splitId || !stage)
        return finish(
          '대상 스플릿 정규시즌이 끝났습니다. 진출 결과를 확인하세요.',
          false,
          true,
        );
      if (!isRegularStage(stage.format))
        return finish(
          '플레이인·플레이오프 시작 전입니다. 직접 진행해 주세요.',
          false,
          true,
        );
      if (
        career.currentDate >
        getLeagueSplitWindow(split.year, split.splitNumber).endsAt
      )
        return finish('대상 스플릿 일정 범위를 벗어나 중단했습니다.', true);
      const calendar = await this.calendars.findOne(accountId, careerId);
      if (calendar.manager?.canManage === false)
        return finish('감독 상태를 확인해 주세요.', true);
      if (calendar.blockingEvents.length)
        return finish(
          '계약·면담·국제대회 등 직접 확인할 일정이 있어 중단했습니다.',
          true,
        );
      if (calendar.transferWindow.isOpen)
        return finish('이적시장에서는 자동 진행하지 않습니다.', true);
      const pendingDecision = await this.db.manager.existsBy(CalendarEvent, {
        careerId,
        requiresUserAction: true,
        status: CalendarEventStatus.SCHEDULED,
        scheduledDate: LessThanOrEqual(before.currentDate),
      });
      if (pendingDecision) {
        // Activate today's scheduled decisions using the calendar's locked path.
        // It stops on the decision before advancing the date.
        await this.calendars.advance(
          accountId,
          careerId,
          { mode: CalendarAdvanceMode.ONE_DAY },
          before.currentDate,
        );
        return finish(
          '직접 결정할 이벤트가 있습니다. 구단 소식을 확인해 주세요.',
          true,
        );
      }
      if (
        new Set(dto.individuals.map((p) => p.careerPlayerId)).size !==
        dto.individuals.length
      )
        throw new BadRequestException(
          '개인 훈련 선수는 중복 지정할 수 없습니다.',
        );
      if (
        dto.individuals.some(
          (p) =>
            !team.rosters.some((r) => r.careerPlayerId === p.careerPlayerId),
        )
      )
        return finish(
          '개인 훈련 대상의 소속이 바뀌었습니다. 계획을 다시 설정해 주세요.',
          true,
        );
      const week = await this.training.findCurrent(accountId, careerId);
      let restingWithoutRecovery = false;
      if (week.teamTraining.remaining > 0) {
        let activity = plannedActivity(
          dto.startDate,
          before.currentDate,
          dto.pattern,
        );
        const proficiency = team.strategyProficiencies.find(
          (p) => p.strategy === dto.strategy,
        );
        if (
          activity === 'SCRIM' &&
          proficiency?.proficiency === 100 &&
          team.chemistry === 100
        )
          activity = 'REST';
        if (
          activity === 'REST' &&
          week.sessions.some((s) => s.category === TrainingCategory.INDIVIDUAL)
        )
          return finish(
            '이번 주 개인 훈련을 이미 진행해 전체 휴식을 할 수 없습니다. 주간 활동을 직접 선택해 주세요.',
            true,
          );
        restingWithoutRecovery =
          activity === 'REST' &&
          team.rosters.every(
            (r) =>
              r.careerPlayer.condition >= 100 && r.careerPlayer.form >= 100,
          );
        if (!restingWithoutRecovery) {
          await this.training.trainTeam(
            accountId,
            careerId,
            activity === 'REST'
              ? { type: TrainingType.REST }
              : { type: TrainingType.STRATEGY, strategy: dto.strategy },
            before.currentDate,
          );
          return finish(
            activity === 'REST'
              ? '이번 주 팀 휴식 완료'
              : '이번 주 지정 전술 스크림 완료',
          );
        }
      }
      if (
        week.available &&
        !restingWithoutRecovery &&
        !week.teamRested &&
        week.individualTraining.remaining > 0
      ) {
        const player = dto.individuals.find(
          (p) => !week.usedPlayerIds.includes(p.careerPlayerId),
        );
        if (player) {
          await this.training.trainIndividual(
            accountId,
            careerId,
            player,
            before.currentDate,
          );
          return finish('준비 기간 개인 훈련 완료');
        }
      }
      const fixture = calendar.dueMatches[0];
      if (fixture) {
        const { series } = await this.leagues.simulateNextFixtureGame(
          accountId,
          careerId,
          fixture.leagueSplitId,
          fixture.id,
          true,
        );
        if (series.status !== MatchSeriesStatus.COMPLETED) {
          const game = series.nextGameNumber!;
          await updateSeriesDraft(
            this.db,
            accountId,
            series.seriesId,
            game,
            undefined,
            true,
            true,
          );
          await this.leagues.simulateNextFixtureGame(
            accountId,
            careerId,
            fixture.leagueSplitId,
            fixture.id,
            false,
            game,
          );
        }
        return finish(
          `${fixture.teamA.code} vs ${fixture.teamB.code} 자동 경기 완료`,
        );
      }
      await this.calendars.advance(
        accountId,
        careerId,
        { mode: CalendarAdvanceMode.ONE_DAY },
        before.currentDate,
      );
      const after = await this.progress(careerId);
      return finish(
        after.cursor === before.cursor
          ? '진행 조건을 확인해 주세요.'
          : '다음 날짜로 진행',
        after.cursor === before.cursor,
      );
    });
  }
}
