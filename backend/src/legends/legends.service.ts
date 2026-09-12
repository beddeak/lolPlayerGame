import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThan, Not } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CareerPlayerPositionProficiency } from '../careers/entities/career-player-position-proficiency.entity';
import { CareerPlayerRoleProficiency } from '../careers/entities/career-player-role-proficiency.entity';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { CAREER_PLAYER_STATE_CONFIG } from '../careers/config/player-state.config';
import { POSITION_PROFICIENCY_CONFIG } from '../careers/config/position-proficiency.config';
import {
  PLAYER_INSTRUCTIONS_BY_POSITION,
  ROLE_PROFICIENCY_CONFIG,
} from '../careers/config/player-instruction.config';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { PlayerCard } from '../players/entities/player-card.entity';
import { TransfersService } from '../transfers/transfers.service';
import { getTransferWindow } from '../transfers/transfer-window';
import { LegendEvent } from './entities/legend-event.entity';
import { LegendEventPlayer } from './entities/legend-event-player.entity';
import { LegendSeason } from './entities/legend-season.entity';
import { LegendAiService } from './legend-ai.service';
import { planLegendSeason } from './legend-policy';

@Injectable()
export class LegendsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transfers: TransfersService,
    private readonly ai: LegendAiService,
  ) {}

  /** Read-only: never rolls, reveals, or advances AI on a GET request. */
  async findAll(accountId: number, careerId: number) {
    const manager = this.dataSource.manager;
    const career = await manager.findOneBy(Career, { id: careerId, accountId });
    if (!career)
      throw new NotFoundException(`Career ${careerId} was not found`);
    const [events, teams, market] = await Promise.all([
      manager.find(LegendEvent, {
        where: { careerId, revealedDate: Not(IsNull()) },
        relations: {
          theme: true,
          season: true,
          players: {
            careerPlayer: { playerCard: { player: true }, currentTeam: true },
          },
        },
        order: { revealedDate: 'DESC', id: 'DESC' },
      }),
      manager.findBy(CareerTeam, { careerId }),
      this.transfers.findMarket(accountId, careerId, {}),
    ]);
    const marketByPlayer = new Map(
      market.map((player) => [player.careerPlayerId, player]),
    );
    const club = (team: CareerTeam) => ({
      id: team.id,
      code: team.code,
      name: team.name,
    });
    return {
      careerId,
      currentDate: career.currentDate,
      events: events.map((event) => ({
        id: event.id,
        seasonYear: event.season.year,
        theme: {
          id: event.theme.id,
          code: event.theme.code,
          name: event.theme.name,
        },
        revealedDate: event.revealedDate!,
        players: [...event.players]
          .sort((a, b) => a.id - b.id)
          .map((entrant) => {
            const player = entrant.careerPlayer;
            const candidate = marketByPlayer.get(player.id);
            const overall = Math.round(
              (player.currentMechanics +
                player.currentGameSense +
                player.currentLaning +
                player.currentTeamFight +
                player.currentMacro +
                player.currentTeamPlay +
                player.currentMental +
                player.currentChampionPool) /
                8,
            );
            return {
              careerPlayerId: player.id,
              playerCardId: player.playerCardId,
              nickname: player.playerCard.player.nickname,
              cardYear: player.playerCard.cardYear,
              position: player.currentPosition,
              currentAge: player.currentAge,
              overall,
              imageUrl: player.playerCard.imageUrl,
              currentTeam: player.currentTeam ? club(player.currentTeam) : null,
              interestedClubs: teams
                .filter((team) => entrant.interestedTeamIds.includes(team.id))
                .map(club),
              // This view starts FA offers only; contracted players use the transfer market.
              canNegotiate:
                player.currentTeamId === null &&
                !!candidate?.canNegotiate &&
                candidate.hasBenchSpace,
            };
          }),
      })),
    };
  }

  /** Caller holds the career write lock for the whole calendar transaction. */
  async prepareSeason(
    manager: EntityManager,
    career: Career,
    date: string,
  ): Promise<void> {
    const window = getTransferWindow(date);
    if (!window.isOpen) return;
    const year = window.seasonYear;
    if (await manager.existsBy(LegendSeason, { careerId: career.id, year }))
      return;
    const [previous, cards, existingPlayers] = await Promise.all([
      manager.findOne(LegendSeason, {
        where: { careerId: career.id, year: LessThan(year) },
        order: { year: 'DESC' },
      }),
      manager.find(PlayerCard, {
        where: { theme: { legendEnabled: true } },
        order: { id: 'ASC' },
      }),
      manager.find(CareerPlayer, {
        where: { careerId: career.id },
        select: { playerCardId: true },
      }),
    ]);
    const existing = new Set(
      existingPlayers.map((player) => player.playerCardId),
    );
    const themes = new Map<number, number[]>();
    for (const card of cards) {
      if (existing.has(card.id)) continue;
      themes.set(card.themeId, [...(themes.get(card.themeId) ?? []), card.id]);
    }
    const seed = randomBytes(32).toString('hex');
    const plan = planLegendSeason(
      seed,
      year,
      previous?.year === year - 1 ? previous.zeroEventStreak : 0,
      [...themes].map(([themeId, playerCardIds]) => ({
        themeId,
        playerCardIds,
      })),
    );
    const season = await manager.save(
      LegendSeason,
      manager.create(LegendSeason, {
        careerId: career.id,
        year,
        seed,
        eventCount: plan.events.length,
        zeroEventStreak: plan.zeroEventStreak,
      }),
    );
    for (const [index, planned] of plan.events.entries()) {
      const event = await manager.save(
        LegendEvent,
        manager.create(LegendEvent, {
          careerId: career.id,
          seasonId: season.id,
          ordinal: index + 1,
          ...planned,
          revealedDate: null,
          calendarEventId: null,
        }),
      );
      const queued = await manager.save(
        CalendarEvent,
        manager.create(CalendarEvent, {
          careerId: career.id,
          scheduledDate: event.revealDate,
          type: CalendarEventType.LEGEND_REVEAL,
          status: CalendarEventStatus.SCHEDULED,
          requiresUserAction: true,
          payload: { legendEventId: event.id },
          completedAt: null,
        }),
      );
      event.calendarEventId = queued.id;
      await manager.save(LegendEvent, event);
    }
  }

  async revealEvent(
    manager: EntityManager,
    career: Career,
    queued: CalendarEvent,
    date: string,
  ): Promise<void> {
    const eventId = queued.payload?.legendEventId;
    if (typeof eventId !== 'number' || !Number.isInteger(eventId)) {
      queued.requiresUserAction = false;
      return;
    }
    const event = await manager.findOne(LegendEvent, {
      where: { id: eventId, careerId: career.id, calendarEventId: queued.id },
      relations: { theme: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !event ||
      event.revealedDate ||
      event.revealDate > date ||
      !getTransferWindow(date).isOpen ||
      event.revealDate.slice(0, 4) !== date.slice(0, 4)
    ) {
      queued.requiresUserAction = false;
      return;
    }
    const season = await manager.findOneOrFail(LegendSeason, {
      where: { id: event.seasonId, careerId: career.id },
      select: { id: true, seed: true },
    });
    const cards = event.playerCardIds.length
      ? await manager.find(PlayerCard, {
          where: { id: In(event.playerCardIds), themeId: event.themeId },
          order: { id: 'ASC' },
        })
      : [];
    const generated = await manager.find(CareerPlayer, {
      where: { careerId: career.id },
      select: { playerCardId: true },
    });
    const existing = new Set(generated.map((player) => player.playerCardId));
    let playerCount = 0;
    for (const card of cards) {
      if (existing.has(card.id)) continue;
      const player = await this.createFreeAgent(manager, career.id, card);
      const interest = await this.ai.prepareInterests(
        manager,
        career,
        player,
        season.seed,
        date,
      );
      await manager.save(
        LegendEventPlayer,
        manager.create(LegendEventPlayer, {
          careerId: career.id,
          legendEventId: event.id,
          careerPlayerId: player.id,
          ...interest,
          aiProcessedDate: null,
        }),
      );
      playerCount += 1;
    }
    event.revealedDate = date;
    await manager.save(LegendEvent, event);
    queued.requiresUserAction = playerCount > 0;
    queued.payload = {
      legendEventId: event.id,
      themeId: event.themeId,
      themeName: event.theme.name,
      playerCount,
      message: `${event.theme.name}: 레전드 선수 ${playerCount}명이 FA 시장에 등장했습니다.`,
    };
  }

  processCompetition(manager: EntityManager, career: Career, date: string) {
    return this.ai.processCompetition(manager, career, date);
  }

  private async createFreeAgent(
    manager: EntityManager,
    careerId: number,
    card: PlayerCard,
  ) {
    const player = await manager.save(
      CareerPlayer,
      manager.create(CareerPlayer, {
        careerId,
        playerCardId: card.id,
        currentTeamId: null,
        currentAge: card.startingAge,
        currentPosition: card.mainPosition,
        currentMechanics: card.mechanics,
        currentGameSense: card.gameSense,
        currentLaning: card.laning,
        currentTeamFight: card.teamFight,
        currentMacro: card.macro,
        currentTeamPlay: card.teamPlay,
        currentMental: card.mental,
        currentChampionPool: card.championPool,
        form: CAREER_PLAYER_STATE_CONFIG.initial.form,
        condition: CAREER_PLAYER_STATE_CONFIG.initial.condition,
        personality: card.personality,
        coachTrust: CAREER_PLAYER_STATE_CONFIG.initial.coachTrust,
      }),
    );
    await manager.save(
      CareerPlayerPositionProficiency,
      STARTER_POSITIONS.map((position) =>
        manager.create(CareerPlayerPositionProficiency, {
          careerPlayerId: player.id,
          position,
          proficiency:
            position === player.currentPosition
              ? POSITION_PROFICIENCY_CONFIG.initialPrimary
              : POSITION_PROFICIENCY_CONFIG.initialSecondary,
        }),
      ),
    );
    await manager.save(
      CareerPlayerRoleProficiency,
      PLAYER_INSTRUCTIONS_BY_POSITION[player.currentPosition].map(
        (instruction) =>
          manager.create(CareerPlayerRoleProficiency, {
            careerPlayerId: player.id,
            position: player.currentPosition,
            instruction,
            proficiency: ROLE_PROFICIENCY_CONFIG.initial,
          }),
      ),
    );
    return player;
  }
}
