import type { CareerPlayer } from '../careers/entities/career-player.entity';
import { CONTRACT_CONFIG } from '../contracts/config/contract.config';
import { SALARY_CONFIG } from '../contracts/config/salary.config';
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
  // A standing salary is protected, but repeated AI renewals no longer multiply
  // it by 1.15 forever. Only the market estimate gets a bidding premium.
  const salary = Math.max(
    currentSalary,
    Math.min(
      SALARY_CONFIG.maxMarketAnnualSalary,
      estimateAiAnnualSalary(player) * AI_CLUB_CONFIG.salaryOfferRatio,
    ),
  );
  return {
    annualSalary: Math.min(
      CONTRACT_CONFIG.limits.maxAnnualSalary,
      Math.ceil(salary / CONTRACT_CONFIG.negotiation.salaryRounding) *
        CONTRACT_CONFIG.negotiation.salaryRounding,
    ),
    years: AI_CLUB_CONFIG.contractYears,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.CORE,
    promises: [],
  };
}
