import { BadRequestException } from '@nestjs/common';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { Position } from '../players/enums/position.enum';
import { CONTRACT_CONFIG } from './config/contract.config';
import {
  ContractExpectedRole,
  ContractPromiseType,
  ContractResponse,
  ContractTerms,
} from './contract.types';

export interface ContractEvaluationContext {
  ability: number;
  teamStrength: number;
  coachTrust: number;
  personality: PlayerPersonality;
  currentAnnualSalary: number | null;
}

export interface ContractEvaluation {
  kind: ContractResponse['kind'];
  reason: string;
  counterTerms: ContractTerms | null;
}

export function validateContractTerms(terms: ContractTerms): void {
  const { limits } = CONTRACT_CONFIG;
  if (
    !terms ||
    !Number.isInteger(terms.annualSalary) ||
    terms.annualSalary < limits.minAnnualSalary ||
    terms.annualSalary > limits.maxAnnualSalary ||
    !Number.isInteger(terms.years) ||
    terms.years < limits.minYears ||
    terms.years > limits.maxYears ||
    typeof terms.starterGuarantee !== 'boolean' ||
    !Object.values(ContractExpectedRole).includes(terms.expectedRole) ||
    !Array.isArray(terms.promises) ||
    terms.promises.length > limits.maxPromises
  ) {
    throw new BadRequestException(
      '계약 조건의 연봉, 기간, 역할, 약속을 확인하세요.',
    );
  }
  if (
    terms.starterGuarantee &&
    ![ContractExpectedRole.CORE, ContractExpectedRole.STARTER].includes(
      terms.expectedRole,
    )
  ) {
    throw new BadRequestException(
      '주전 보장은 핵심 또는 주전 역할에만 가능합니다.',
    );
  }

  const seen = new Set<string>();
  for (const promise of terms.promises) {
    if (
      !promise ||
      !Object.values(ContractPromiseType).includes(promise.type)
    ) {
      throw new BadRequestException('유효하지 않은 계약 약속입니다.');
    }
    const key = `${promise.type}:${promise.position ?? ''}`;
    if (seen.has(key)) {
      throw new BadRequestException('동일한 계약 약속은 중복할 수 없습니다.');
    }
    seen.add(key);
    if (promise.type === ContractPromiseType.SIGN_POSITION) {
      if (!Object.values(Position).includes(promise.position as Position)) {
        throw new BadRequestException(
          '특정 포지션 보강 약속에는 포지션이 필요합니다.',
        );
      }
    } else if (promise.position !== undefined) {
      throw new BadRequestException(
        '포지션은 특정 포지션 보강 약속에만 지정합니다.',
      );
    }
    if (
      promise.type === ContractPromiseType.STARTER_GUARANTEE &&
      !terms.starterGuarantee
    ) {
      throw new BadRequestException(
        '주전 약속에는 주전 보장 조건이 필요합니다.',
      );
    }
    if (
      promise.type === ContractPromiseType.CARRY_ROLE &&
      terms.expectedRole !== ContractExpectedRole.CORE
    ) {
      throw new BadRequestException(
        '캐리 역할 약속에는 핵심 역할이 필요합니다.',
      );
    }
  }
}

export function getResponseDelayDays(
  offerId: number,
  revision: number,
): number {
  const { minDays, maxDays } = CONTRACT_CONFIG.responseDelay;
  return minDays + ((offerId + revision - 2) % (maxDays - minDays + 1));
}

export function evaluateContractOffer(
  terms: ContractTerms,
  context: ContractEvaluationContext,
): ContractEvaluation {
  validateContractTerms(terms);
  const config = CONTRACT_CONFIG.negotiation;
  if (context.coachTrust < config.lowTrustRejection[context.personality]) {
    return {
      kind: 'REJECTED',
      reason: '감독과의 신뢰가 낮아 연봉과 관계없이 재계약을 거절했습니다.',
      counterTerms: null,
    };
  }

  const counterTerms: ContractTerms = {
    ...terms,
    promises: terms.promises.map((promise) => ({ ...promise })),
  };
  const concerns: string[] = [];
  const wantsCore =
    context.personality === PlayerPersonality.SELF_CENTERED &&
    context.ability >= config.carryDemandAbility;
  const wantsStarter = wantsCore || context.ability >= config.starAbility;
  if (wantsCore && terms.expectedRole !== ContractExpectedRole.CORE) {
    counterTerms.expectedRole = ContractExpectedRole.CORE;
    concerns.push('핵심 캐리 역할');
  } else if (
    wantsStarter &&
    ![ContractExpectedRole.CORE, ContractExpectedRole.STARTER].includes(
      terms.expectedRole,
    )
  ) {
    counterTerms.expectedRole = ContractExpectedRole.STARTER;
    concerns.push('주전 역할');
  }
  if (wantsStarter && !terms.starterGuarantee) {
    counterTerms.starterGuarantee = true;
    concerns.push('주전 보장');
  }
  const hasPlan = terms.promises.some((promise) =>
    [
      ContractPromiseType.STRENGTHEN_TEAM,
      ContractPromiseType.SIGN_POSITION,
    ].includes(promise.type),
  );
  if (
    context.ability >= config.starAbility &&
    context.ability - context.teamStrength > config.teamStrengthGap &&
    !hasPlan
  ) {
    counterTerms.promises.push({ type: ContractPromiseType.STRENGTHEN_TEAM });
    concerns.push('다음 시즌 전력 보강');
  }
  // Promises are valuable once, regardless of how many positions are named.
  const targetSalary = getTargetSalary(counterTerms, context);
  const salaryRatio = terms.annualSalary / targetSalary;
  if (salaryRatio < config.salaryAcceptanceRatio) {
    counterTerms.annualSalary = targetSalary;
    concerns.push('연봉 인상');
  }

  const score =
    config.nonMoneyBase +
    Math.min(config.maxSalaryBenefit, salaryRatio) * config.moneyWeight +
    (context.coachTrust - config.trustNeutral) * config.trustWeight +
    (context.teamStrength - context.ability) * config.teamStrengthWeight +
    (terms.starterGuarantee ? config.starterBonus : 0) +
    (terms.expectedRole === ContractExpectedRole.CORE ? config.coreBonus : 0) +
    (hasPlan ? config.planBonus : 0);

  if (concerns.length > 0) {
    validateContractTerms(counterTerms);
    return {
      kind: 'COUNTER_OFFER',
      reason: `${concerns.join(', ')} 조건을 요청했습니다.`,
      counterTerms,
    };
  }
  if (score < config.acceptScore) {
    // No achievable term change fixes the relationship/team mismatch.
    return {
      kind: 'REJECTED',
      reason: '감독 신뢰와 팀 경쟁력을 고려해 현재 재계약 계획을 거절했습니다.',
      counterTerms: null,
    };
  }
  return {
    kind: 'ACCEPTED',
    reason: '연봉, 계약 기간, 역할 및 팀 계획을 검토한 뒤 조건에 동의했습니다.',
    counterTerms: null,
  };
}

function getTargetSalary(
  terms: ContractTerms,
  context: ContractEvaluationContext,
): number {
  const config = CONTRACT_CONFIG.negotiation;
  const marketSalary =
    config.salaryBase + context.ability ** 2 * config.salaryPerAbilitySquared;
  const hasPlan = terms.promises.some((promise) =>
    [
      ContractPromiseType.STRENGTHEN_TEAM,
      ContractPromiseType.SIGN_POSITION,
    ].includes(promise.type),
  );
  const adjustment =
    1 +
    (config.trustNeutral - context.coachTrust) * config.trustSalaryAdjustment +
    Math.max(0, context.ability - context.teamStrength) *
      config.teamSalaryAdjustment +
    Math.max(0, terms.years - config.maxComfortableYears) *
      config.additionalYearSalaryRatio -
    (hasPlan ? config.planSalaryDiscount : 0);
  const target = Math.max(
    marketSalary *
      config.personalitySalaryRatio[context.personality] *
      adjustment,
    (context.currentAnnualSalary ?? 0) * config.currentSalaryFloorRatio,
  );
  return Math.min(
    CONTRACT_CONFIG.limits.maxAnnualSalary,
    Math.max(
      CONTRACT_CONFIG.limits.minAnnualSalary,
      Math.ceil(target / config.salaryRounding) * config.salaryRounding,
    ),
  );
}
