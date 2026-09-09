import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { ContractTermsDto } from './contract-terms.dto';

export class CreateContractOfferDto {
  @IsInt()
  @Min(1)
  careerPlayerId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  transferAgreementId?: number;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ContractTermsDto)
  terms!: ContractTermsDto;
}
