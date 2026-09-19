import { BadRequestException } from '@nestjs/common';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { PLAYER_CARD_STAT_MAX } from '../players/constants/player-card.constants';
import { TRANSFER_CONFIG } from './config/transfer.config';

export interface RequiredTransferFeeInput {
  ability: number;
  currentAge: number;
  rosterRole: RosterRole;
  remainingContractDays: number;
}

/**
 * Calculates a contracted player's required transfer fee in ten thousand KRW
 * (만원). The result is deterministic and rounded to the configured unit.
 */
export function calculateRequiredTransferFee(
  input: RequiredTransferFeeInput,
): number {
  validateTransferFeeInput(input);

  const { fee } = TRANSFER_CONFIG;
  const abilityValue =
    fee.base + input.ability ** 2 * fee.abilitySquaredMultiplier;
  const ageMultiplier =
    input.currentAge <= fee.prospect.maxAge
      ? fee.prospect.multiplier
      : input.currentAge >= fee.veteran.minAge
        ? fee.veteran.multiplier
        : 1;
  const weightedContractYears = Math.min(
    input.remainingContractDays / fee.remainingContract.daysPerYear,
    fee.remainingContract.maxWeightedYears,
  );
  const contractMultiplier =
    1 + weightedContractYears * fee.remainingContract.multiplierPerYear;
  const rawFee =
    abilityValue *
    ageMultiplier *
    fee.rosterRoleMultiplier[input.rosterRole] *
    contractMultiplier;
  const roundedFee = Math.round(rawFee / fee.roundingUnit) * fee.roundingUnit;
  const clampedFee = Math.min(
    fee.max,
    Math.max(fee.contractedMinimum, roundedFee),
  );

  validateTransferFee(clampedFee);
  return clampedFee;
}

/** Validates a transfer fee expressed in ten thousand KRW (만원). */
export function validateTransferFee(transferFee: number): void {
  const { min, max } = TRANSFER_CONFIG.fee;

  if (
    !Number.isInteger(transferFee) ||
    transferFee < min ||
    transferFee > max
  ) {
    throw new BadRequestException(
      `Transfer fee must be an integer between ${min} and ${max} (만원)`,
    );
  }
}

function validateTransferFeeInput(input: RequiredTransferFeeInput): void {
  if (
    !Number.isFinite(input.ability) ||
    input.ability < 0 ||
    input.ability > PLAYER_CARD_STAT_MAX
  ) {
    throw new BadRequestException(
      `Ability must be between 0 and ${PLAYER_CARD_STAT_MAX}`,
    );
  }

  if (!Number.isInteger(input.currentAge) || input.currentAge < 1) {
    throw new BadRequestException('Current age must be a positive integer');
  }

  if (!Object.values(RosterRole).includes(input.rosterRole)) {
    throw new BadRequestException('Roster role is invalid');
  }

  if (
    !Number.isInteger(input.remainingContractDays) ||
    input.remainingContractDays < 0
  ) {
    throw new BadRequestException(
      'Remaining contract days must be a non-negative integer',
    );
  }
}
