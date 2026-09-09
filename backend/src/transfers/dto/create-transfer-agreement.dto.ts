import { IsInt, Max, Min } from 'class-validator';
import { TRANSFER_CONFIG } from '../config/transfer.config';

export class CreateTransferAgreementDto {
  @IsInt()
  @Min(1)
  careerPlayerId!: number;

  @IsInt()
  @Min(TRANSFER_CONFIG.fee.min)
  @Max(TRANSFER_CONFIG.fee.max)
  offeredFee!: number;
}
