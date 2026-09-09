import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsObject,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ContractDecisionAction } from '../contract.types';
import { ContractTermsDto } from './contract-terms.dto';

export class RespondContractOfferDto {
  @IsEnum(ContractDecisionAction)
  action!: ContractDecisionAction;

  @ValidateIf(
    (value: RespondContractOfferDto) =>
      value.action === ContractDecisionAction.COUNTER ||
      value.terms !== undefined,
  )
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ContractTermsDto)
  terms?: ContractTermsDto;
}
