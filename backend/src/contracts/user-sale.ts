import { ContractOfferType } from './contract.types';
import type { ContractOffer } from './entities/contract-offer.entity';

// Server-only audit entry, never accepted from a request DTO. Existing JSON history
// persists the owner's explicit consent without changing old saves or the schema.
export const USER_SALE_ACTION = 'USER_APPROVED_SALE';
export function isUserApprovedSale(offer: ContractOffer): boolean {
  return (
    offer.offerType === ContractOfferType.TRANSFER &&
    offer.history?.[0]?.action === USER_SALE_ACTION
  );
}
