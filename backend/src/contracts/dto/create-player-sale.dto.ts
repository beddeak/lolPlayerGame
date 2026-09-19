import { IsInt, Min, Max } from 'class-validator';
import { TRANSFER_CONFIG } from '../../transfers/config/transfer.config';

export class CreatePlayerSaleDto {
  @IsInt()
  @Min(1)
  careerPlayerId!: number;

  @IsInt()
  @Min(1)
  buyerCareerTeamId!: number;

  @IsInt()
  @Min(TRANSFER_CONFIG.fee.contractedMinimum)
  @Max(TRANSFER_CONFIG.fee.max)
  askingFee!: number;
}
