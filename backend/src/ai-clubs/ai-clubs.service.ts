import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  addCalendarDays,
  calendarDaysBetween,
} from '../calendars/calendar-date';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { ContractsService } from '../contracts/contracts.service';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import {
  ContractExpectedRole,
  PlayerContractStatus,
  type ContractTerms,
} from '../contracts/contract.types';
import { CONTRACT_CONFIG } from '../contracts/config/contract.config';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { getSeriesWinsRequired } from '../match-series/config/bo3-series.config';
import { LegendEventPlayer } from '../legends/entities/legend-event-player.entity';
import { getTransferWindow } from '../transfers/transfer-window';
import {
  AiClubBudgetService,
  estimateAiAnnualSalary,
} from './ai-club-budget.service';
import {
  assessAiRoster,
  chooseAiBenchPromotion,
  chooseAiTeamStrategy,
  rankAiTransferCandidates,
} from './ai-club-policy';
import { AI_CLUB_CONFIG } from './config/ai-club.config';
import { AiClubDifficulty, AiClubState } from './entities/ai-club-state.entity';

@Injectable()
export class AiClubsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly budgets: AiClubBudgetService,
    private readonly contracts: ContractsService,
  ) {}

  async findAll(accountId: number, careerId: number) {
    const manager = this.dataSource.manager;
    const career = await manager.findOneBy(Career, { id: careerId, accountId });
    if (!career)
      throw new NotFoundException(`Career ${careerId} was not found`);
    const teams = await manager.find(CareerTeam, {
      where: { careerId, isUserControlled: false },
      order: { id: 'ASC' },
    });
    return {
      careerId,
      currentDate: career.currentDate,
      clubs: await Promise.all(
        teams.map(async (team) => {
          const state = await manager.findOneBy(AiClubState, {
            careerId,
            careerTeamId: team.id,
          });
          const rosters = await this.loadRoster(manager, team.id);
          return {
            team: { id: team.id, code: team.code, name: team.name },
            difficulty: state?.difficulty ?? AiClubDifficulty.EASY,
            lastDecisionDate: state?.lastDecisionDate ?? null,
            strategy: team.teamStrategy,
            roster: assessAiRoster(rosters),
            budget: await this.budgets.summarize(
              manager,
              career,
              team.id,
              state,
            ),
          };
        }),
      ),
    };
  }

  /** Existing calendar transaction owns the career lock. No work is triggered by GET. */
  async processDay(
    manager: EntityManager,
    career: Career,
    date: string,
  ): Promise<CalendarEvent[]> {
    const teams = await manager.find(CareerTeam, {
      where: { careerId: career.id, isUserControlled: false },
      order: { id: 'ASC' },
    });
    const series = await manager.find(MatchSeries, {
      where: { careerId: career.id },
      relations: { games: true },
      select: {
        id: true,
        teamAId: true,
        teamBId: true,
        bestOf: true,
        games: { id: true, winnerTeamId: true },
      },
    });
    const playingTeams = new Set(
      series
        .filter((entry) => {
          const needed = getSeriesWinsRequired(entry.bestOf);
          return (
            entry.games.length > 0 &&
            entry.games.filter((game) => game.winnerTeamId === entry.teamAId)
              .length < needed &&
            entry.games.filter((game) => game.winnerTeamId === entry.teamBId)
              .length < needed
          );
        })
        .flatMap((entry) => [entry.teamAId, entry.teamBId]),
    );
    const news: CalendarEvent[] = [];
    for (const team of teams) {
      const state = await this.budgets.getOrCreate(manager, career, team.id);
      // Mid-series squad/strategy changes are not part of EASY autonomous management.
      if (playingTeams.has(team.id)) continue;
      let rosters = await this.loadRoster(manager, team.id);
      // A just-signed player or contract expiry can create a new starter need on any day.
      for (let index = 0; index < STARTER_POSITIONS.length; index += 1) {
        const promotion = chooseAiBenchPromotion(rosters);
        if (!promotion) break;
        const incoming = rosters.find(
          (slot) => slot.careerPlayerId === promotion.incomingPlayerId,
        )!;
        const outgoing = rosters.find(
          (slot) => slot.careerPlayerId === promotion.outgoingPlayerId,
        );
        if (outgoing) {
          outgoing.role = RosterRole.BENCH;
          outgoing.starterPosition = null;
          outgoing.playerInstruction = null;
          outgoing.championArchetype = null;
          await manager.save(Roster, outgoing);
        }
        incoming.role = RosterRole.STARTER;
        incoming.starterPosition = promotion.position;
        incoming.playerInstruction = null;
        incoming.championArchetype = null;
        await manager.save(Roster, incoming);
        news.push(
          await this.news(
            manager,
            career.id,
            date,
            team,
            'ROSTER',
            `${team.code}: ${promotion.position} 주전을 ${incoming.careerPlayer.playerCard.player.nickname} 선수로 변경했습니다.`,
          ),
        );
      }
      if (
        state.lastDecisionDate &&
        calendarDaysBetween(state.lastDecisionDate, date) <
          AI_CLUB_CONFIG.decisionIntervalDays
      )
        continue;
      const strategy = chooseAiTeamStrategy(
        team.teamStrategy,
        rosters,
        `${career.id}:${team.id}:${date}`,
      );
      if (strategy !== team.teamStrategy) {
        team.teamStrategy = strategy;
        await manager.save(CareerTeam, team);
        news.push(
          await this.news(
            manager,
            career.id,
            date,
            team,
            'STRATEGY',
            `${team.code}: 기본 전략을 ${strategy}로 변경했습니다.`,
          ),
        );
      }
      const ownedContracts = await manager.findBy(PlayerContract, {
        careerId: career.id,
        careerTeamId: team.id,
        status: PlayerContractStatus.ACTIVE,
      });
      const byPlayer = new Map(
        ownedContracts.map((contract) => [contract.careerPlayerId, contract]),
      );
      // One simple renewal decision per review; no forced acceptance or endless same-day retries.
      const renewal = rosters
        .filter((slot) => slot.role === RosterRole.STARTER)
        .filter((slot) =>
          byPlayer.has(slot.careerPlayerId)
            ? byPlayer.get(slot.careerPlayerId)!.endDate <=
              addCalendarDays(date, AI_CLUB_CONFIG.renewalLeadDays)
            : getTransferWindow(date).isOpen,
        )
        .sort((a, b) => a.id - b.id)[0];
      if (renewal) {
        const offered = await this.contracts.createAiOffer(
          manager,
          career,
          team.id,
          renewal.careerPlayerId,
          this.terms(
            renewal.careerPlayer,
            byPlayer.get(renewal.careerPlayerId)?.terms.annualSalary,
          ),
        );
        if (offered)
          news.push(
            await this.news(
              manager,
              career.id,
              date,
              team,
              'RENEWAL_OFFER',
              `${team.code}: ${renewal.careerPlayer.playerCard.player.nickname} 선수에게 재계약을 제안했습니다.`,
            ),
          );
      }
      if (getTransferWindow(date).isOpen) {
        const [players, entrants] = await Promise.all([
          manager.find(CareerPlayer, {
            where: { careerId: career.id },
            relations: { currentTeam: true, playerCard: { player: true } },
            order: { id: 'ASC' },
          }),
          manager.findBy(LegendEventPlayer, { careerId: career.id }),
        ]);
        const protectedLegends = new Set(
          entrants
            .filter(
              (entrant) =>
                entrant.aiProcessedDate === null ||
                entrant.aiProcessedDate >= date,
            )
            .map((entrant) => entrant.careerPlayerId),
        );
        const candidates = players.filter(
          (player) =>
            player.currentTeamId !== team.id &&
            !player.currentTeam?.isUserControlled &&
            !protectedLegends.has(player.id),
        );
        rosters = await this.loadRoster(manager, team.id);
        const ranked = rankAiTransferCandidates(
          candidates,
          assessAiRoster(rosters),
        );
        for (const candidate of ranked) {
          const player = candidates.find(
            (member) => member.id === candidate.careerPlayerId,
          )!;
          const offered = await this.contracts.createAiOffer(
            manager,
            career,
            team.id,
            player.id,
            this.terms(player),
          );
          if (!offered) continue;
          news.push(
            await this.news(
              manager,
              career.id,
              date,
              team,
              'ACQUISITION_OFFER',
              `${team.code}: ${player.playerCard.player.nickname} 선수 영입 협상을 시작했습니다.`,
            ),
          );
          break;
        }
      }
      state.lastDecisionDate = date;
      await manager.save(AiClubState, state);
    }
    return news;
  }

  private terms(player: CareerPlayer, currentSalary?: number): ContractTerms {
    const salary = Math.max(estimateAiAnnualSalary(player), currentSalary ?? 0);
    return {
      annualSalary: Math.min(
        CONTRACT_CONFIG.limits.maxAnnualSalary,
        Math.ceil(
          (salary * AI_CLUB_CONFIG.salaryOfferRatio) /
            CONTRACT_CONFIG.negotiation.salaryRounding,
        ) * CONTRACT_CONFIG.negotiation.salaryRounding,
      ),
      years: AI_CLUB_CONFIG.contractYears,
      starterGuarantee: true,
      expectedRole: ContractExpectedRole.CORE,
      promises: [],
    };
  }

  private loadRoster(manager: EntityManager, teamId: number) {
    return manager.find(Roster, {
      where: { careerTeamId: teamId },
      relations: {
        careerPlayer: {
          playerCard: { player: true },
          positionProficiencies: true,
        },
      },
      order: { id: 'ASC' },
    });
  }

  private news(
    manager: EntityManager,
    careerId: number,
    date: string,
    team: CareerTeam,
    action: string,
    message: string,
  ) {
    return manager.save(
      CalendarEvent,
      manager.create(CalendarEvent, {
        careerId,
        scheduledDate: date,
        type: CalendarEventType.AI_CLUB_UPDATE,
        status: CalendarEventStatus.COMPLETED,
        requiresUserAction: false,
        payload: {
          action,
          careerTeamId: team.id,
          teamCode: team.code,
          message,
        },
        completedAt: new Date(),
      }),
    );
  }
}
