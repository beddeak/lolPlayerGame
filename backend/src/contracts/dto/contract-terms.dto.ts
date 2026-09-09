import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import { CONTRACT_CONFIG } from '../config/contract.config';
import {
  ContractExpectedRole,
  ContractPromise,
  ContractPromiseType,
  ContractTerms,
} from '../contract.types';

export class ContractPromiseDto implements ContractPromise {
  @IsEnum(ContractPromiseType)
  type!: ContractPromiseType;

  @ValidateIf((value: ContractPromiseDto) => value.position !== undefined)
  @IsEnum(Position)
  position?: Position;
}

export class ContractTermsDto implements ContractTerms {
  @IsInt()
  @Min(CONTRACT_CONFIG.limits.minAnnualSalary)
  @Max(CONTRACT_CONFIG.limits.maxAnnualSalary)
  annualSalary!: number;

  @IsInt()
  @Min(CONTRACT_CONFIG.limits.minYears)
  @Max(CONTRACT_CONFIG.limits.maxYears)
  years!: number;

  @IsBoolean()
  starterGuarantee!: boolean;

  @IsEnum(ContractExpectedRole)
  expectedRole!: ContractExpectedRole;

  @IsArray()
  @ArrayMaxSize(CONTRACT_CONFIG.limits.maxPromises)
  @ValidateNested({ each: true })
  @Type(() => ContractPromiseDto)
  promises!: ContractPromiseDto[];
}
