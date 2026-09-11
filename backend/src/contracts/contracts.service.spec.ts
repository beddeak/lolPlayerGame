import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { ContractOfferStatus, PlayerContractStatus } from './contract.types';
import { ContractsService, contractEndDate } from './contracts.service';
import { ContractOffer } from './entities/contract-offer.entity';
import { TransfersService } from '../transfers/transfers.service';
import { PlayerContract } from './entities/player-contract.entity';
import { TransferRecord } from '../transfers/entities/transfer-record.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';

describe('Contract response processing invariants', () => {
  const transfersService = {
    expireContract: jest.fn(),
    isContractOfferEligible: jest.fn(),
  };
  const service = new ContractsService(
    {} as DataSource,
    transfersService as unknown as TransfersService,
  );
  beforeEach(() => jest.resetAllMocks());
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

  it.each([
    ContractOfferStatus.PLAYER_ACCEPTED,
    ContractOfferStatus.COUNTER_OFFERED,
  ])(
    'withdraws a postponed %s response after the player leaves the club',
    async (status) => {
      const postponed = event();
      const offer = {
        id: 5,
        careerId: 1,
        careerPlayerId: 9,
        careerTeamId: 3,
        responseEventId: 7,
        revision: 2,
        status,
      } as ContractOffer;
      const player = { id: 9, currentTeamId: null } as CareerPlayer;
      const team = { id: 3, isUserControlled: true } as CareerTeam;
      const manager = {
        findOne: jest.fn().mockResolvedValue(offer),
        findOneBy: jest
          .fn()
          .mockImplementation((entity: unknown) =>
            Promise.resolve(entity === CareerPlayer ? player : team),
          ),
        save: jest.fn(),
      };
      transfersService.isContractOfferEligible.mockResolvedValueOnce(false);

      await service.processResponseEvent(
        manager as unknown as EntityManager,
        postponed,
        '2026-01-04',
      );

      expect(transfersService.isContractOfferEligible).toHaveBeenCalledWith(
        manager,
        offer,
        team,
      );
      expect(offer.status).toBe(ContractOfferStatus.WITHDRAWN);
      expect(postponed.requiresUserAction).toBe(false);
      expect(manager.save).toHaveBeenCalledWith(ContractOffer, offer);
    },
  );

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
      findOneBy: jest.fn().mockResolvedValue({ isUserControlled: true }),
      save: jest.fn(),
    };
    transfersService.isContractOfferEligible.mockResolvedValueOnce(true);
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

  it('ignores stale expiration events after a contract has been renewed', async () => {
    const expiration = {
      ...event(),
      type: CalendarEventType.CONTRACT_EXPIRATION,
      requiresUserAction: false,
      payload: { playerContractId: 11, sourceOfferId: 40 },
    } as CalendarEvent;
    const renewed = {
      id: 11,
      careerId: 1,
      sourceOfferId: 41,
      status: PlayerContractStatus.ACTIVE,
      endDate: '2028-12-31',
    } as PlayerContract;
    const manager = { findOne: jest.fn().mockResolvedValue(renewed) };

    await service.processExpirationEvent(
      manager as unknown as EntityManager,
      expiration,
      '2027-01-01',
    );

    expect(transfersService.expireContract).not.toHaveBeenCalled();
    expect(expiration.requiresUserAction).toBe(false);
  });

  it('expires the matching active contract on the day after its inclusive end date', async () => {
    const expiration = {
      ...event(),
      type: CalendarEventType.CONTRACT_EXPIRATION,
      requiresUserAction: false,
      payload: { playerContractId: 12, sourceOfferId: 42 },
    } as CalendarEvent;
    const contract = {
      id: 12,
      careerId: 1,
      sourceOfferId: 42,
      status: PlayerContractStatus.ACTIVE,
      endDate: '2026-12-31',
    } as PlayerContract;
    const record = { id: 77 } as TransferRecord;
    const manager = { findOne: jest.fn().mockResolvedValue(contract) };
    transfersService.expireContract.mockResolvedValueOnce(record);

    await service.processExpirationEvent(
      manager as unknown as EntityManager,
      expiration,
      '2027-01-01',
    );

    expect(transfersService.expireContract).toHaveBeenCalledWith(
      manager,
      contract,
      '2027-01-01',
    );
    expect(expiration.payload).toEqual(
      expect.objectContaining({ expired: true, transferRecordId: record.id }),
    );
  });
});
