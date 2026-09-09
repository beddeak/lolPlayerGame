import { IsEnum, IsOptional } from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import { TransferMarketAvailability } from '../transfer.types';

export class FindTransferMarketQueryDto {
  @IsOptional()
  @IsEnum(TransferMarketAvailability)
  availability?: TransferMarketAvailability;

  @IsOptional()
  @IsEnum(Position)
  position?: Position;
}
