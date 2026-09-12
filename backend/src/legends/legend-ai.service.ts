import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull, LessThanOrEqual } from 'typeorm';
import { addCalendarDays } from '../calendars/calendar-date';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { ContractsService } from '../contracts/contracts.service';
import {
  ContractExpectedRole,
  type ContractTerms,
} from '../contracts/contract.types';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { createSeededRandom } from '../matches/simulation/seeded-random';
import { getTransferWindow } from '../transfers/transfer-window';
import { LEGEND_EVENT_CONFIG } from './config/legend-event.config';
import { LegendEventPlayer } from './entities/legend-event-player.entity';

// Prototype terms only: no fictitious bank balance or club-reputation bonus.
export const LEGEND_AI_CONTRACT_TERMS: Readonly<ContractTerms> = {
  annualSalary: 200_000,
  years: 2,
  starterGuarantee: true,
  expectedRole: ContractExpectedRole.CORE,
  promises: [],
};

@Injectable()
export class LegendAiService {
  constructor(private readonly contracts: ContractsService) {}

  async prepareInterests(
    manager: EntityManager,
    career: Career,
    player: CareerPlayer,
    seed: string,
    revealDate: string,
  ): Promise<{ interestedTeamIds: number[]; aiDecisionDate: string }> {
    const teams = await manager.find(CareerTeam, {
      where: { careerId: career.id, isUserControlled: false },
      order: { id: 'ASC' },
    });
    const random = createSeededRandom(
      createHash('sha256')
        .update(`${seed}:legend-ai:${player.playerCardId}`)
        .digest()
        .readUInt32LE(0),
    );
    const teamIds = teams.map((team) => team.id);
    for (let index = teamIds.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [teamIds[index], teamIds[other]] = [teamIds[other], teamIds[index]];
    }
    const { minDecisionDays, maxDecisionDays, maxInterestedClubs } =
      LEGEND_EVENT_CONFIG.ai;
    const delay =
      minDecisionDays +
      Math.floor(random() * (maxDecisionDays - minDecisionDays + 1));
    const requestedDate = addCalendarDays(revealDate, delay);
    return {
      interestedTeamIds: teamIds.slice(0, maxInterestedClubs),
      // Old saves can reveal near closing day. Never remove the reaction window
      // by clamping AI to that same day; closed-market decisions are skipped.
      aiDecisionDate: requestedDate,
    };
  }

  /** Runs once per revealed entrant, inside the calendar's existing career lock. */
  async processCompetition(
    manager: EntityManager,
    career: Career,
    date: string,
  ): Promise<CalendarEvent[]> {
    const entrants = await manager.find(LegendEventPlayer, {
      where: {
        careerId: career.id,
        aiProcessedDate: IsNull(),
        aiDecisionDate: LessThanOrEqual(date),
      },
      order: { aiDecisionDate: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    const news: CalendarEvent[] = [];
    const datedCareer = { ...career, currentDate: date };
    for (const entrant of entrants) {
      const player = await manager.findOne(CareerPlayer, {
        where: { id: entrant.careerPlayerId, careerId: career.id },
        relations: { playerCard: { player: true } },
        lock: { mode: 'pessimistic_write' },
      });
      if (getTransferWindow(date).isOpen && player?.currentTeamId === null) {
        for (const teamId of entrant.interestedTeamIds) {
          const signed = await this.contracts.signLegendFreeAgentForAi(
            manager,
            datedCareer,
            teamId,
            player.id,
            structuredClone(LEGEND_AI_CONTRACT_TERMS),
          );
          if (!signed) continue;
          const team = await manager.findOneBy(CareerTeam, {
            id: teamId,
            careerId: career.id,
          });
          const event = manager.create(CalendarEvent, {
            careerId: career.id,
            scheduledDate: date,
            type: CalendarEventType.LEGEND_SIGNING,
            status: CalendarEventStatus.COMPLETED,
            requiresUserAction: false,
            payload: {
              kind: 'LEGEND_AI_SIGNING',
              legendEventId: entrant.legendEventId,
              careerPlayerId: player.id,
              careerTeamId: teamId,
              teamCode: team?.code ?? null,
              message: `${player.playerCard.cardYear} ${player.playerCard.player.nickname} 선수가 ${team?.name ?? 'AI 구단'}와 계약했습니다.`,
            },
            completedAt: new Date(),
          });
          news.push(await manager.save(CalendarEvent, event));
          break;
        }
      }
      // No repeat roll when every interested club rejects or lacks roster space.
      entrant.aiProcessedDate = date;
      await manager.save(LegendEventPlayer, entrant);
    }
    return news;
  }
}
