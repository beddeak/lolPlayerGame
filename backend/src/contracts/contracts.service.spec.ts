import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { ContractOfferStatus } from './contract.types';
import { ContractsService, contractEndDate } from './contracts.service';
import { ContractOffer } from './entities/contract-offer.entity';

describe('Contract response processing invariants', () => {
  const service = new ContractsService({} as DataSource);
  const event = (): CalendarEvent =>
    ({
      id: 7,
      careerId: 1,
      type: CalendarEventType.CONTRACT_RESPONSE,
      status: CalendarEventStatus.SCHEDULED,
      scheduledDate: '2026-01-04',
      requiresUserAction: true,
      payload: { contractOfferId: 5, revision: 2 },
      completedAt: null,
    }) as unknown as CalendarEvent;

  it('ignores an old revision instead of changing the current negotiation', async () => {
    const stale = event();
    const offer = {
      id: 5,
      responseEventId: 8,
      revision: 3,
      status: ContractOfferStatus.WAITING_PLAYER_RESPONSE,
    } as ContractOffer;
    const manager = {
      findOne: jest.fn().mockResolvedValue(offer),
      save: jest.fn(),
    };
    await service.processResponseEvent(
      manager as unknown as EntityManager,
      stale,
      '2026-01-04',
    );
    expect(stale.requiresUserAction).toBe(false);
    expect(offer.status).toBe(ContractOfferStatus.WAITING_PLAYER_RESPONSE);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('preserves the original player response when a requested extension ends', async () => {
    const postponed = event();
    const offer = {
      id: 5,
      responseEventId: 7,
      revision: 2,
      status: ContractOfferStatus.PLAYER_ACCEPTED,
      response: {
        kind: 'ACCEPTED',
        reason: 'accepted',
        evaluatedDate: '2026-01-02',
      },
    } as ContractOffer;
    const manager = {
      findOne: jest.fn().mockResolvedValue(offer),
      save: jest.fn(),
    };
    await service.processResponseEvent(
      manager as unknown as EntityManager,
      postponed,
      '2026-01-04',
    );
    expect(postponed.requiresUserAction).toBe(true);
    expect(offer.response?.evaluatedDate).toBe('2026-01-02');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('does not block on a withdrawn or deleted negotiation', async () => {
    for (const offer of [
      null,
      {
        id: 5,
        responseEventId: 7,
        revision: 2,
        status: ContractOfferStatus.WITHDRAWN,
      },
    ]) {
      const cancelled = event();
      const manager = { findOne: jest.fn().mockResolvedValue(offer) };
      await service.processResponseEvent(
        manager as unknown as EntityManager,
        cancelled,
        '2026-01-04',
      );
      expect(cancelled.requiresUserAction).toBe(false);
    }
  });

  it('uses an inclusive end date and handles leap-day anniversaries', () => {
    expect(contractEndDate('2026-01-01', 2)).toBe('2027-12-31');
    expect(contractEndDate('2026-11-22', 3)).toBe('2029-11-21');
    expect(contractEndDate('2028-02-29', 1)).toBe('2029-02-27');
    expect(contractEndDate('2028-02-29', 4)).toBe('2032-02-28');
  });
});
