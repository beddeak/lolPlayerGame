import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { Region } from '../careers/enums/region.enum';
import { EventQueueService } from '../event-queue/event-queue.service';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { LeaguesService } from '../leagues/leagues.service';
import { LeagueSplitStatus } from '../leagues/enums/league-split-status.enum';
import { MatchSeriesService } from '../match-series/match-series.service';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import { lockActiveManagerCareer } from '../manager-career/manager-access';
import { InternationalTournament } from './entities/international-tournament.entity';
import { InternationalFixture } from './entities/international-fixture.entity';
import {
  availableGames,
  createTournament,
  recordResult,
  resolveSlot,
} from './tournament-engine';
import {
  INTERNATIONAL_WINDOWS,
  qualifyInternational,
  RegionalQualification,
} from './qualification';
import { INTERNATIONAL_REGIONS, InternationalKind } from './tournament.types';
import { lcpQualification } from './lcp-qualification';

@Injectable()
export class InternationalsService {
  constructor(
    private readonly db: DataSource,
    private readonly leagues: LeaguesService,
    private readonly series: MatchSeriesService,
    private readonly events: EventQueueService,
  ) {}

  async findAll(accountId: number, careerId: number) {
    const career = await this.db.manager.findOneBy(Career, {
      id: careerId,
      accountId,
    });
    if (!career)
      throw new NotFoundException(`Career ${careerId} was not found`);
    return this.describe(this.db.manager, career);
  }

  async describe(manager: EntityManager, career: Career) {
    const plan = await this.plan(manager, career);
    const tournaments = await manager.find(InternationalTournament, {
      where: { careerId: career.id },
      order: { year: 'DESC', id: 'ASC' },
    });
    const fixtures = tournaments.length
      ? await manager.find(InternationalFixture, {
          where: { tournamentId: In(tournaments.map((value) => value.id)) },
          relations: { series: { games: true } },
        })
      : [];
    const fixturesByKey = new Map(
      fixtures.map((fixture) => [
        `${fixture.tournamentId}:${fixture.key}`,
        fixture,
      ]),
    );
    return {
      careerId: career.id,
      currentDate: career.currentDate,
      readiness: plan.map((item) => ({
        kind: item.kind,
        ...item.window,
        teamRequirements: item.requirements,
        reasons: item.reasons,
        ready: item.reasons.length === 0,
        tournamentId: item.existing?.id ?? null,
      })),
      tournaments: tournaments.map((value) => ({
        id: value.id,
        year: value.year,
        kind: value.kind,
        championTeamId: value.state.champion,
        rosterConfirmed: value.rosterConfirmed,
        entrants: value.state.entrants,
        fixtures: value.state.games.map((game) => {
          const fixture = fixturesByKey.get(`${value.id}:${game.key}`);
          const teamAId = resolveSlot(value.state, game.a),
            teamBId = resolveSlot(value.state, game.b);
          const games = fixture?.series?.games ?? [];
          return {
            id: fixture?.id ?? null,
            key: game.key,
            stage: game.stage,
            round: game.round,
            scheduledDate: game.day,
            bestOf: game.bestOf,
            teamAId,
            teamBId,
            winnerTeamId: game.winner,
            seriesId: fixture?.seriesId ?? null,
            teamAWins: games.filter((match) => match.winnerTeamId === teamAId)
              .length,
            teamBWins: games.filter((match) => match.winnerTeamId === teamBId)
              .length,
            playable:
              value.rosterConfirmed &&
              game.winner === null &&
              !!fixture &&
              game.day <= career.currentDate,
          };
        }),
      })),
    };
  }

  /** Calendar caller owns the Career write lock. Never fabricate absent entrants. */
  async prepare(manager: EntityManager, career: Career) {
    if (!career.autoSchedule) return;
    const candidates = Object.values(InternationalKind).filter((kind) => {
      const window = INTERNATIONAL_WINDOWS[kind];
      return (
        career.currentDate >= `${career.currentYear}-${window.preparation}` &&
        career.currentDate <= `${career.currentYear}-${window.ends}`
      );
    });
    if (!candidates.length) return;
    const existing = await manager.find(InternationalTournament, {
      where: { careerId: career.id, year: career.currentYear },
      select: { kind: true },
    });
    if (
      candidates.every((kind) => existing.some((value) => value.kind === kind))
    )
      return;
    for (const item of await this.plan(manager, career)) {
      if (!item.existing && !item.reasons.length && item.entrants)
        await this.createWithManager(manager, career, item.kind, item.entrants);
    }
  }

  async create(accountId: number, careerId: number, kind: InternationalKind) {
    await this.db.transaction(async (manager) => {
      const career = await lockActiveManagerCareer(
        manager,
        accountId,
        careerId,
      );
      const item = (await this.plan(manager, career)).find(
        (value) => value.kind === kind,
      )!;
      if (item.existing) return;
      if (item.reasons.length || !item.entrants)
        throw new ConflictException(item.reasons.join(' '));
      await this.createWithManager(manager, career, kind, item.entrants);
    });
    return this.findAll(accountId, careerId);
  }

  async registerRoster(
    accountId: number,
    careerId: number,
    tournamentId: number,
  ) {
    await this.db.transaction(async (manager) => {
      const career = await lockActiveManagerCareer(
        manager,
        accountId,
        careerId,
      );
      const tournament = await manager.findOneBy(InternationalTournament, {
        id: tournamentId,
        careerId,
      });
      if (!tournament)
        throw new NotFoundException('국제대회를 찾을 수 없습니다.');
      if (tournament.rosterConfirmed) return;
      if (
        tournament.year !== career.currentYear ||
        career.currentDate >
          `${tournament.year}-${INTERNATIONAL_WINDOWS[tournament.kind].ends}`
      )
        throw new ConflictException('로스터 등록 기간이 지났습니다.');
      tournament.registeredRosters = await this.snapshotRosters(
        manager,
        tournament.state.entrants.map((entry) => entry.teamId),
      );
      tournament.rosterConfirmed = true;
      await manager.save(tournament);
      const pending = await manager.find(CalendarEvent, {
        where: {
          careerId,
          type: CalendarEventType.INTERNATIONAL_ROSTER_REGISTRATION,
        },
      });
      for (const event of pending.filter(
        (value) => value.payload?.tournamentId === tournamentId,
      )) {
        event.status = CalendarEventStatus.COMPLETED;
        event.completedAt = new Date();
        await manager.save(event);
      }
    });
    return this.findAll(accountId, careerId);
  }

  async simulate(
    accountId: number,
    careerId: number,
    tournamentId: number,
    fixtureId: number,
  ) {
    const context = await this.db.transaction(async (manager) => {
      const career = await lockActiveManagerCareer(
        manager,
        accountId,
        careerId,
      );
      const tournament = await manager.findOneBy(InternationalTournament, {
        id: tournamentId,
        careerId,
      });
      const fixture = await manager.findOne(InternationalFixture, {
        where: { id: fixtureId, tournamentId },
        relations: { series: { games: true } },
      });
      if (!tournament || !fixture)
        throw new NotFoundException('국제대회 경기를 찾을 수 없습니다.');
      const savedGame = tournament.state.games.find(
        (game) => game.key === fixture.key,
      )!;
      if (savedGame.winner !== null)
        return { seriesId: fixture.seriesId!, done: true };
      if (!tournament.rosterConfirmed)
        throw new ConflictException('국제대회 로스터를 먼저 등록해 주세요.');
      const game = availableGames(tournament.state).find(
        (value) => value.key === fixture.key,
      );
      if (!game || game.day > career.currentDate)
        throw new ConflictException('아직 진행할 수 없는 경기입니다.');
      const blockers = await this.events.findBlockingEvents(
        manager,
        careerId,
        career.currentDate,
      );
      if (
        blockers.some(
          (event) =>
            event.type !== CalendarEventType.SCHEDULED_GAME ||
            !event.payload?.internationalFixtureId,
        )
      )
        throw new ConflictException('다른 미해결 이벤트를 먼저 처리해 주세요.');
      const rosters = await manager.find(Roster, {
        where: {
          careerTeamId: In([game.teamAId, game.teamBId]),
          role: RosterRole.STARTER,
        },
      });
      for (const roster of rosters)
        if (
          !tournament.registeredRosters[String(roster.careerTeamId)]?.includes(
            roster.careerPlayerId,
          )
        )
          throw new ConflictException(
            '국제대회에 등록되지 않은 선수가 선발에 있습니다. 등록된 선수로 교체해 주세요.',
          );
      if (!fixture.seriesId) {
        const series = await manager.save(
          MatchSeries,
          manager.create(MatchSeries, {
            careerId,
            teamAId: game.teamAId,
            teamBId: game.teamBId,
            bestOf: game.bestOf,
            seed: (Math.imul(tournamentId, 104729) + fixtureId * 97) >>> 0,
            games: [],
          }),
        );
        fixture.seriesId = series.id;
        // Loaded `series: null` must not overwrite the new foreign key on save.
        await manager.update(InternationalFixture, fixture.id, {
          seriesId: series.id,
        });
      }
      return { seriesId: fixture.seriesId, done: false };
    });
    // The existing simulator persists each game transactionally, with unique series-game slots.
    let series = await this.series.findOne(accountId, context.seriesId);
    for (
      let game = 0;
      !context.done &&
      series.status !== MatchSeriesStatus.COMPLETED &&
      game < 5;
      game++
    )
      series = await this.series.simulateNextGame(accountId, context.seriesId);
    if (series.status === MatchSeriesStatus.COMPLETED) {
      await this.db.transaction(async (manager) => {
        const career = await lockActiveManagerCareer(
          manager,
          accountId,
          careerId,
        );
        const tournament = await manager.findOneByOrFail(
          InternationalTournament,
          { id: tournamentId, careerId },
        );
        const fixture = await manager.findOneByOrFail(InternationalFixture, {
          id: fixtureId,
          tournamentId,
        });
        if (
          tournament.state.games.find((game) => game.key === fixture.key)!
            .winner === null
        ) {
          tournament.state = recordResult(
            tournament.state,
            fixture.key,
            series.winnerTeamId!,
          );
          await manager.save(tournament);
        }
        await manager.update(CalendarEvent, fixture.eventId, {
          status: CalendarEventStatus.COMPLETED,
          completedAt: new Date(),
        });
        await this.materialize(manager, career, tournament);
      });
    }
    return this.findAll(accountId, careerId);
  }

  private async plan(manager: EntityManager, career: Career) {
    const [teams, splits, tournaments] = await Promise.all([
      manager.find(CareerTeam, { where: { careerId: career.id } }),
      this.leagues.qualificationSplits(manager, career.id, career.currentYear),
      manager.find(InternationalTournament, {
        where: { careerId: career.id, year: career.currentYear },
      }),
    ]);
    const rosters = teams.length
      ? await manager.find(Roster, {
          where: {
            careerTeamId: In(teams.map((team) => team.id)),
            role: RosterRole.STARTER,
          },
        })
      : [];
    const startersByTeam = new Map<number, number>();
    for (const roster of rosters)
      startersByTeam.set(
        roster.careerTeamId,
        (startersByTeam.get(roster.careerTeamId) ?? 0) + 1,
      );
    return Object.values(InternationalKind).map((kind) => {
      const config = INTERNATIONAL_WINDOWS[kind];
      const window = {
        preparationDate: `${career.currentYear}-${config.preparation}`,
        startsAt: `${career.currentYear}-${config.starts}`,
        endsAt: `${career.currentYear}-${config.ends}`,
        participantCount: config.count,
      };
      const results: RegionalQualification[] = splits
        .filter(
          (split) =>
            split.region !== Region.LCP &&
            split.splitNumber === config.split &&
            split.status === LeagueSplitStatus.COMPLETED,
        )
        .map((split) => {
          const playoff = split.stages.find(
            (stage) => stage.code === 'PLAYOFFS',
          );
          const ranking = [
            ...new Set([
              ...(playoff?.standings.map((row) => row.teamId) ?? []),
              ...split.standings.map((row) => row.teamId),
            ]),
          ];
          return {
            region: split.region,
            ranking,
            playoffTeamIds:
              playoff?.participants.map((row) => row.teamId) ?? [],
          };
        });
      const lcp = lcpQualification(splits, config.split);
      if (lcp) results.push(lcp);
      const priorKind =
        kind === InternationalKind.MSI
          ? InternationalKind.FIRST_STAND
          : InternationalKind.MSI;
      const qualified = qualifyInternational(
        kind,
        results,
        tournaments.find((value) => value.kind === priorKind)?.state ?? null,
      );
      const existing = tournaments.find((value) => value.kind === kind);
      const reasons = [...qualified.reasons];
      for (const entrant of qualified.entrants ?? []) {
        if (startersByTeam.get(entrant.teamId) !== 5)
          reasons.push(
            `${teams.find((team) => team.id === entrant.teamId)?.code ?? entrant.teamId}: 주전 5명 구성이 필요합니다.`,
          );
      }
      if (career.currentDate < window.preparationDate)
        reasons.unshift(
          `${window.preparationDate}부터 대회를 준비할 수 있습니다.`,
        );
      if (career.currentDate > window.endsAt)
        reasons.unshift('이미 지난 대회는 새로 생성하지 않습니다.');
      const requirements = INTERNATIONAL_REGIONS.map((region) => ({
        region,
        required: qualified.allocations[region],
        available: teams.filter((team) => (team.region as string) === region)
          .length,
      }));
      return {
        kind,
        window,
        existing,
        requirements,
        reasons,
        entrants: qualified.entrants,
      };
    });
  }

  private async createWithManager(
    manager: EntityManager,
    career: Career,
    kind: InternationalKind,
    entrants: NonNullable<ReturnType<typeof qualifyInternational>['entrants']>,
  ) {
    const rosters = await this.snapshotRosters(
      manager,
      entrants.map((entry) => entry.teamId),
    );
    const managed = await manager.findOneBy(CareerTeam, {
      careerId: career.id,
      isUserControlled: true,
    });
    const requiresRegistration =
      !!managed && entrants.some((entry) => entry.teamId === managed.id);
    const tournament = await manager.save(
      InternationalTournament,
      manager.create(InternationalTournament, {
        careerId: career.id,
        year: career.currentYear,
        kind,
        state: createTournament(kind, career.currentYear, entrants),
        registeredRosters: rosters,
        rosterConfirmed: !requiresRegistration,
      }),
    );
    if (requiresRegistration) {
      const event = await this.events.enqueue(
        career.id,
        {
          scheduledDate: career.currentDate,
          type: CalendarEventType.INTERNATIONAL_ROSTER_REGISTRATION,
          requiresUserAction: true,
          payload: { tournamentId: tournament.id, kind },
        },
        manager,
      );
      event.status = CalendarEventStatus.READY;
      await manager.save(event);
    }
    await this.materialize(manager, career, tournament);
  }

  private async snapshotRosters(manager: EntityManager, teamIds: number[]) {
    const rosters = await manager.find(Roster, {
      where: { careerTeamId: In(teamIds) },
    });
    const snapshot: Record<string, number[]> = {};
    for (const id of teamIds) {
      const members = rosters.filter((roster) => roster.careerTeamId === id);
      if (
        members.filter((roster) => roster.role === RosterRole.STARTER)
          .length !== 5
      )
        throw new ConflictException(
          `국제대회 참가 구단 ${id}의 주전 5명이 필요합니다.`,
        );
      snapshot[String(id)] = members.map((roster) => roster.careerPlayerId);
    }
    return snapshot;
  }

  private async materialize(
    manager: EntityManager,
    career: Career,
    tournament: InternationalTournament,
  ) {
    const existing = await manager.find(InternationalFixture, {
      where: { tournamentId: tournament.id },
    });
    for (const game of availableGames(tournament.state)) {
      if (existing.some((fixture) => fixture.key === game.key)) continue;
      const event = await this.events.enqueue(
        career.id,
        {
          scheduledDate: game.day,
          type: CalendarEventType.SCHEDULED_GAME,
          requiresUserAction: true,
          payload: { tournamentId: tournament.id, kind: tournament.kind },
        },
        manager,
      );
      const fixture = await manager.save(
        InternationalFixture,
        manager.create(InternationalFixture, {
          tournamentId: tournament.id,
          key: game.key,
          seriesId: null,
          eventId: event.id,
        }),
      );
      event.payload = { ...event.payload, internationalFixtureId: fixture.id };
      if (game.day <= career.currentDate)
        event.status = CalendarEventStatus.READY;
      await manager.save(event);
    }
  }
}
