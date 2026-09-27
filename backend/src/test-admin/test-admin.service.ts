import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { withCareerAutomationLock } from '../careers/career-automation-lock';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { Match } from '../matches/entities/match.entity';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { CalendarsService } from '../calendars/calendars.service';
import { CalendarAdvanceMode } from '../calendars/enums/calendar-advance-mode.enum';
import { LeaguesService } from '../leagues/leagues.service';
import { InternationalsService } from '../internationals/internationals.service';
import { updateSeriesDraft } from '../drafts/series-draft.store';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import {
  applyTestStats,
  assertTestTarget,
  TEST_PLAYER_FIELDS,
} from './test-admin.policy';
import { AdvanceTestSeasonDto, EditTestPlayerDto } from './test-admin.dto';

@Injectable()
export class TestAdminService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly calendars: CalendarsService,
    private readonly leagues: LeaguesService,
    private readonly internationals: InternationalsService,
  ) {}

  private assertEnabled() {
    const configured = this.config.get<string>('TEST_ADMIN_ENABLED');
    const enabled =
      configured === undefined
        ? this.config.get<string>('NODE_ENV') !== 'production'
        : configured === 'true';
    if (!enabled)
      throw new ForbiddenException('임시 관리자 기능이 비활성화되어 있습니다.');
  }

  private async owned(accountId: number, careerId: number) {
    this.assertEnabled();
    const career = await this.db.manager.findOneBy(Career, {
      id: careerId,
      accountId,
    });
    if (!career)
      throw new NotFoundException('자신의 세이브만 관리할 수 있습니다.');
    return career;
  }

  private async progress(careerId: number) {
    const career = await this.db.manager.findOneByOrFail(Career, {
      id: careerId,
    });
    const games = await this.db.manager.count(Match, { where: { careerId } });
    return {
      currentDate: career.currentDate,
      games,
      cursor: `${career.currentDate}:${games}`,
    };
  }

  async inspect(accountId: number, careerId: number) {
    await this.owned(accountId, careerId);
    const players = await this.db.manager.find(CareerPlayer, {
      where: { careerId },
      relations: { playerCard: { player: true }, currentTeam: true },
      order: { id: 'ASC' },
    });
    return {
      ...(await this.progress(careerId)),
      players: players.map((player) => ({
        id: player.id,
        nickname: player.playerCard.player.nickname,
        team: player.currentTeam?.code ?? 'FA',
        position: player.currentPosition,
        values: Object.fromEntries(
          Object.keys(TEST_PLAYER_FIELDS).map((key) => [
            key,
            player[key as keyof typeof TEST_PLAYER_FIELDS],
          ]),
        ),
      })),
    };
  }

  /** MySQL connection-owned lock also serializes admin requests across server workers. */
  private async exclusive<T>(careerId: number, work: () => Promise<T>) {
    return withCareerAutomationLock(this.db, careerId, work);
  }

  async editPlayer(
    accountId: number,
    careerId: number,
    playerId: number,
    dto: EditTestPlayerDto,
  ) {
    await this.owned(accountId, careerId);
    return this.exclusive(careerId, () =>
      this.db.transaction(async (manager) => {
        const career = await manager.findOne(Career, {
          where: { id: careerId, accountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!career) throw new NotFoundException('세이브를 찾을 수 없습니다.');
        const player = await manager.findOneBy(CareerPlayer, {
          id: playerId,
          careerId,
        });
        if (!player)
          throw new NotFoundException('이 세이브의 선수가 아닙니다.');
        const series = await manager.find(MatchSeries, {
          where: { careerId },
          relations: { games: true },
        });
        if (
          series.some((s) =>
            Object.keys(s.drafts ?? {}).some(
              (key) => !s.games.some((g) => g.seriesGameNumber === Number(key)),
            ),
          )
        )
          throw new ConflictException(
            '진행 중인 밴픽 세트를 먼저 완료해 주세요.',
          );
        applyTestStats(player, dto.values, dto.expected);
        await manager.save(CareerPlayer, player);
        return { playerId, values: dto.values };
      }),
    );
  }

  /** One set or one day per request. Completed work persists; no blind date writes. */
  async advance(
    accountId: number,
    careerId: number,
    dto: AdvanceTestSeasonDto,
  ) {
    await this.owned(accountId, careerId);
    return this.exclusive(careerId, async () => {
      const before = await this.progress(careerId);
      assertTestTarget(before.currentDate, dto.targetDate);
      if (before.cursor !== dto.cursor)
        throw new ConflictException(
          '날짜나 경기 기록이 변경됐습니다. 다시 불러온 뒤 이어서 진행하세요.',
        );
      const finish = async (message: string, stopped = false) => {
        const state = await this.progress(careerId);
        return {
          ...state,
          message,
          stopped,
          done: state.currentDate >= dto.targetDate,
        };
      };
      if (before.currentDate >= dto.targetDate)
        return finish('이미 이적시장 기간입니다.');
      let calendar = await this.calendars.findOne(accountId, careerId);
      if (calendar.manager?.status === 'DISMISSED')
        return finish(
          '감독 경질로 중단했습니다. 감독 상태를 확인해 주세요.',
          true,
        );
      if (!calendar.autoSchedule)
        calendar = await this.calendars.startSeason(accountId, careerId);
      const otherBlocker = calendar.blockingEvents.find(
        (event) =>
          event.type !== CalendarEventType.SCHEDULED_GAME ||
          typeof event.payload?.internationalFixtureId !== 'number',
      );
      if (otherBlocker)
        return finish(
          `결정이 필요한 이벤트가 있습니다: ${otherBlocker.type}. 시즌 화면의 알림을 확인해 주세요.`,
          true,
        );
      if (calendar.blockingEvents.length) {
        const data = await this.internationals.findAll(accountId, careerId);
        const next = data.tournaments.flatMap((t) =>
          t.fixtures
            .filter((f) => f.playable && f.id !== null)
            .map((f) => ({ tournamentId: t.id, fixtureId: f.id! })),
        )[0];
        if (!next) return finish('국제대회 진행 조건을 확인해 주세요.', true);
        const { series } = await this.internationals.prepareFixture(
          accountId,
          careerId,
          next.tournamentId,
          next.fixtureId,
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
          await this.internationals.simulate(
            accountId,
            careerId,
            next.tournamentId,
            next.fixtureId,
            { single: true, gameNumber: game },
          );
        }
        return finish('국제대회 경기 자동 처리');
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
          `${fixture.teamA.code} vs ${fixture.teamB.code} 경기 자동 처리`,
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
          ? '진행 조건을 확인해 주세요. 날짜를 강제로 덮어쓰지 않았습니다.'
          : '날짜·계약·이벤트 처리',
        after.cursor === before.cursor,
      );
    });
  }
}
