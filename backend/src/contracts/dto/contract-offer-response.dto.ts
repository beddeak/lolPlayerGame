import type { Position } from '../../players/enums/position.enum';
import type { ContractOffer } from '../entities/contract-offer.entity';

export type ContractOfferResponseDto = Omit<ContractOffer, 'careerPlayer'> & {
  player: {
    nickname: string;
    currentPosition: Position;
    currentAge: number;
  };
};
