import type { CareerPlayer } from '../careers/entities/career-player.entity';
import { CONTRACT_CONFIG } from '../contracts/config/contract.config';
import {
  ContractExpectedRole,
  type ContractTerms,
} from '../contracts/contract.types';
import { estimateAiAnnualSalary } from './ai-club-budget.service';
import { AI_CLUB_CONFIG } from './config/ai-club.config';

export function buildAiContractTerms(
  player: CareerPlayer,
  currentSalary = 0,
): ContractTerms {
  const salary = Math.max(estimateAiAnnualSalary(player), currentSalary);
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
