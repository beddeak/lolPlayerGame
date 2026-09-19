import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Region } from '../careers/enums/region.enum';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueStageStatus } from '../leagues/enums/league-stage-status.enum';
import { LEAGUE_CONFIG } from '../leagues/config/league.config';
import { LeaguesService } from '../leagues/leagues.service';
import { getLeagueSplitWindow } from './config/season-calendar.config';
import { InternationalsService } from '../internationals/internationals.service';

export interface SeasonScheduleReadiness {
  region: Region;
  teamCount: number;
  status:
    | 'READY'
    | 'INSUFFICIENT_TEAMS'
    | 'WAITING_FOR_PREVIOUS_SPLIT'
    | 'NO_REMAINING_SPLIT';
  splitNumber: number | null;
  message: string;
}

/** Opt-in provisioning only; read endpoints never initialize or rewrite saves. */
@Injectable()
export class SeasonScheduleService {
  constructor(
    private readonly leaguesService: LeaguesService,
    private readonly internationals: InternationalsService,
  ) {}

  /** Runs inside the calendar transaction, after acquiring the Career lock. */
  async prepare(manager: EntityManager, career: Career): Promise<void> {
    if (!career.autoSchedule) return;

    const { teams, plans } = await this.getPlan(manager, career);
    for (const { readiness, exists } of plans) {
      if (exists || readiness.status !== 'READY') continue;
      await this.leaguesService.ensureCalendarSplit(
        manager,
        { ...career, careerTeams: teams },
        readiness.region,
        readiness.splitNumber!,
      );
    }
    await this.internationals.prepare(manager, career);
  }

  async describe(
    manager: EntityManager,
    career: Career,
  ): Promise<SeasonScheduleReadiness[]> {
    return (await this.getPlan(manager, career)).plans.map(
      ({ readiness }) => readiness,
    );
  }

  private async getPlan(manager: EntityManager, career: Career) {
    // Never backfill already-ended splits into a legacy save's past.
    const splitNumber = [1, 2, 3].find(
      (number) =>
        career.currentDate <=
        getLeagueSplitWindow(career.currentYear, number).endsAt,
    );

    const [teams, splits] = await Promise.all([
      manager.find(CareerTeam, { where: { careerId: career.id } }),
      manager.find(LeagueSplit, {
        where: { careerId: career.id },
        relations: { stages: true },
      }),
    ]);

    const plans = Object.values(Region).map((region) => {
      const readiness: SeasonScheduleReadiness = {
        region,
        teamCount: teams.filter((team) => team.region === region).length,
        status: 'READY',
        splitNumber: splitNumber ?? null,
        message: '지역리그 일정을 준비할 수 있습니다.',
      };
      const regionalSplits = splits.filter((split) => split.region === region);
      const exists = regionalSplits.some(
        (split) =>
          split.year === career.currentYear &&
          split.splitNumber === splitNumber,
      );
      if (exists) {
        readiness.message = '이미 생성된 지역리그 일정을 유지합니다.';
        return { readiness, exists };
      }
      if (splitNumber === undefined) {
        readiness.status = 'NO_REMAINING_SPLIT';
        readiness.message = '올해 새로 생성할 지역리그가 없습니다.';
        return { readiness, exists };
      }
      const minimumTeams = [Region.LCP, Region.CBLOL].includes(region)
        ? 8
        : LEAGUE_CONFIG.minTeams;
      if (
        readiness.teamCount < minimumTeams ||
        (minimumTeams === 8 && readiness.teamCount !== 8)
      ) {
        readiness.status = 'INSUFFICIENT_TEAMS';
        readiness.message =
          minimumTeams === 8
            ? '이 지역의 정식 포맷에는 정확히 8개 팀이 필요합니다.'
            : `리그를 생성하려면 최소 ${minimumTeams}개 팀이 필요합니다.`;
        return { readiness, exists };
      }

      // An old unfinished season remains playable; do not silently replace it.
      if (
        regionalSplits.some(
          (split) =>
            (split.year < career.currentYear ||
              (split.year === career.currentYear &&
                split.splitNumber < splitNumber)) &&
            !this.isComplete(split),
        )
      ) {
        readiness.status = 'WAITING_FOR_PREVIOUS_SPLIT';
        readiness.message = '이전에 생성한 미완료 지역리그를 먼저 마쳐 주세요.';
        return { readiness, exists };
      }

      // LCK/LPL Split 3 uses the actual same-year Split 2 standings.
      // Missing legacy history cannot be replaced with invented seed results.
      if (
        splitNumber === 3 &&
        [Region.LCK, Region.LPL, Region.LCP].includes(region) &&
        !regionalSplits.some(
          (split) =>
            split.year === career.currentYear &&
            split.splitNumber === 2 &&
            this.isComplete(split),
        )
      ) {
        readiness.status = 'WAITING_FOR_PREVIOUS_SPLIT';
        readiness.message =
          'Split 3 시드를 정하려면 같은 해 Split 2 완료 기록이 필요합니다.';
        return { readiness, exists };
      }

      return { readiness, exists };
    });
    return { teams, plans };
  }

  private isComplete(split: LeagueSplit): boolean {
    return (
      split.stages.length > 0 &&
      split.stages.every(
        (stage) => stage.status === LeagueStageStatus.COMPLETED,
      )
    );
  }
}
