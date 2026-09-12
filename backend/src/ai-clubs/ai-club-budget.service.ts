import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { ContractOffer } from '../contracts/entities/contract-offer.entity';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import {
  ContractOfferStatus,
  ContractOfferType,
  PlayerContractStatus,
} from '../contracts/contract.types';
import { CONTRACT_CONFIG } from '../contracts/config/contract.config';
import { getTransferWindow } from '../transfers/transfer-window';
import { AI_CLUB_CONFIG } from './config/ai-club.config';
import { AiClubDifficulty, AiClubState } from './entities/ai-club-state.entity';
import { getAiPlayerAbility } from './ai-club-policy';

/** A cost estimate for initial roster members without an explicit contract, not free wages. */
export function estimateAiAnnualSalary(player: CareerPlayer): number {
  const config = CONTRACT_CONFIG.negotiation;
  const ability = getAiPlayerAbility(player);
  return (
    Math.ceil(
      (config.salaryBase + ability * ability * config.salaryPerAbilitySquared) /
        config.salaryRounding,
    ) * config.salaryRounding
  );
}

@Injectable()
export class AiClubBudgetService {
  /** Only called under the career write lock. Reads use summarize instead. */
  async getOrCreate(
    manager: EntityManager,
    career: Career,
    teamId: number,
  ): Promise<AiClubState> {
    const team = await manager.findOneBy(CareerTeam, {
      id: teamId,
      careerId: career.id,
      isUserControlled: false,
    });
    if (!team) throw new NotFoundException('AI 구단을 찾을 수 없습니다.');
    let state = await manager.findOne(AiClubState, {
      where: { careerId: career.id, careerTeamId: teamId },
      lock: { mode: 'pessimistic_write' },
    });
    const year = Number(career.currentDate.slice(0, 4));
    if (!state) {
      state = manager.create(AiClubState, {
        careerId: career.id,
        careerTeamId: teamId,
        difficulty: AiClubDifficulty.EASY,
        budgetYear: year,
        annualSalaryBudget: AI_CLUB_CONFIG.initialSalaryBudget,
        transferBudget: AI_CLUB_CONFIG.initialTransferBudget,
        transferSpent: 0,
        lastDecisionDate: null,
      });
      return manager.save(AiClubState, state);
    }
    if (state.budgetYear !== year) {
      state.budgetYear = year;
      state.transferSpent = 0;
      await manager.save(AiClubState, state);
    }
    return state;
  }

  async canAfford(
    manager: EntityManager,
    career: Career,
    teamId: number,
    playerId: number,
    annualSalary: number,
    transferFee: number,
    excludeOfferId?: number,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(annualSalary) ||
      annualSalary < 1 ||
      !Number.isSafeInteger(transferFee) ||
      transferFee < 0
    )
      return false;
    const state = await this.getOrCreate(manager, career, teamId);
    const obligations = await this.obligations(
      manager,
      career,
      teamId,
      playerId,
      excludeOfferId,
    );
    return (
      obligations.salary + annualSalary <= state.annualSalaryBudget &&
      state.transferSpent + obligations.transferFees + transferFee <=
        state.transferBudget
    );
  }

  async recordTransferFee(
    manager: EntityManager,
    career: Career,
    teamId: number,
    fee: number,
  ): Promise<void> {
    const state = await this.getOrCreate(manager, career, teamId);
    if (
      !Number.isSafeInteger(fee) ||
      fee < 0 ||
      state.transferSpent + fee > state.transferBudget
    ) {
      throw new ConflictException('AI 구단 이적료 한도를 초과했습니다.');
    }
    if (fee > 0) {
      state.transferSpent += fee;
      await manager.save(AiClubState, state);
    }
  }

  async summarize(
    manager: EntityManager,
    career: Career,
    teamId: number,
    state: AiClubState | null,
  ) {
    const obligations = await this.obligations(manager, career, teamId);
    const year = Number(career.currentDate.slice(0, 4));
    const annualSalaryBudget =
      state?.annualSalaryBudget ?? AI_CLUB_CONFIG.initialSalaryBudget;
    const transferBudget =
      state?.transferBudget ?? AI_CLUB_CONFIG.initialTransferBudget;
    const transferSpent = state?.budgetYear === year ? state.transferSpent : 0;
    return {
      year,
      annualSalaryBudget,
      salaryCommitted: obligations.salary,
      salaryAvailable: Math.max(0, annualSalaryBudget - obligations.salary),
      transferBudget,
      transferSpent,
      transferReserved: obligations.transferFees,
      transferAvailable: Math.max(
        0,
        transferBudget - transferSpent - obligations.transferFees,
      ),
    };
  }

  private async obligations(
    manager: EntityManager,
    career: Career,
    teamId: number,
    excludedPlayerId?: number,
    excludedOfferId?: number,
  ) {
    const [players, contracts, offers] = await Promise.all([
      manager.findBy(CareerPlayer, {
        careerId: career.id,
        currentTeamId: teamId,
      }),
      manager.findBy(PlayerContract, {
        careerId: career.id,
        careerTeamId: teamId,
        status: PlayerContractStatus.ACTIVE,
      }),
      manager.find(ContractOffer, {
        where: {
          careerId: career.id,
          careerTeamId: teamId,
          status: In([
            ContractOfferStatus.WAITING_PLAYER_RESPONSE,
            ContractOfferStatus.PLAYER_ACCEPTED,
            ContractOfferStatus.COUNTER_OFFERED,
          ]),
        },
        relations: { transferAgreement: true },
        order: { id: 'ASC' },
      }),
    ]);
    const salaries = new Map<number, number>();
    const actual = new Map(
      contracts
        .filter((contract) => contract.endDate >= career.currentDate)
        .map((contract) => [
          contract.careerPlayerId,
          contract.terms.annualSalary,
        ]),
    );
    for (const player of players) {
      if (player.id !== excludedPlayerId)
        salaries.set(
          player.id,
          actual.get(player.id) ?? estimateAiAnnualSalary(player),
        );
    }
    let transferFees = 0;
    for (const offer of offers) {
      if (
        offer.id === excludedOfferId ||
        offer.careerPlayerId === excludedPlayerId
      )
        continue;
      if (
        offer.offerType !== ContractOfferType.RENEWAL &&
        (!getTransferWindow(career.currentDate).isOpen ||
          offer.offeredDate < getTransferWindow(career.currentDate).opensAt)
      )
        continue;
      salaries.set(
        offer.careerPlayerId,
        Math.max(
          salaries.get(offer.careerPlayerId) ?? 0,
          offer.terms.annualSalary,
        ),
      );
      transferFees += offer.transferAgreement?.offeredFee ?? 0;
    }
    return {
      salary: [...salaries.values()].reduce(
        (total, salary) => total + salary,
        0,
      ),
      transferFees,
    };
  }
}
