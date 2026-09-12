import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Roster } from '../careers/entities/roster.entity';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { LegendEventPlayer } from '../legends/entities/legend-event-player.entity';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { TransfersService } from '../transfers/transfers.service';
import {
  ContractExpectedRole,
  ContractOfferStatus,
  ContractOfferType,
  PlayerContractStatus,
} from './contract.types';
import { ContractOffer } from './entities/contract-offer.entity';
import { PlayerContract } from './entities/player-contract.entity';
import { ContractsService } from './contracts.service';
import { AiClubBudgetService } from '../ai-clubs/ai-club-budget.service';

describe('Legend AI contract signing', () => {
  const terms = {
    annualSalary: 200_000,
    years: 2,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.CORE,
    promises: [],
  };
  function setup() {
    const career = { id: 1, currentDate: '2026-12-01' } as Career;
    const team = { id: 2, careerId: 1, isUserControlled: false } as CareerTeam;
    const player = {
      id: 9,
      careerId: 1,
      currentTeamId: null,
      personality: PlayerPersonality.PROFESSIONAL,
      currentMechanics: 80,
      currentGameSense: 80,
      currentLaning: 80,
      currentTeamFight: 80,
      currentMacro: 80,
      currentTeamPlay: 80,
      currentMental: 80,
      currentChampionPool: 80,
    } as CareerPlayer;
    const openOffer = {
      id: 40,
      careerId: 1,
      careerTeamId: 1,
      careerPlayerId: 9,
      responseEventId: 50,
      transferAgreementId: null,
      status: ContractOfferStatus.PLAYER_ACCEPTED,
      revision: 1,
      history: [],
      terms,
    } as unknown as ContractOffer;
    const event = {
      id: 50,
      careerId: 1,
      status: 'READY',
      requiresUserAction: true,
    } as CalendarEvent;
    const manager = {
      findOneBy: jest
        .fn()
        .mockImplementation((entity: unknown) =>
          Promise.resolve(
            entity === LegendEventPlayer
              ? { careerPlayerId: 9 }
              : entity === CareerTeam
                ? team
                : null,
          ),
        ),
      findOne: jest
        .fn()
        .mockImplementation((entity: unknown) =>
          Promise.resolve(
            entity === CareerTeam
              ? team
              : entity === CareerPlayer
                ? player
                : entity === CalendarEvent
                  ? event
                  : null,
          ),
        ),
      findBy: jest.fn().mockResolvedValue([player]),
      find: jest.fn().mockResolvedValue([openOffer]),
      countBy: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((_entity: unknown, value: object) => ({
          ...value,
        })),
      save: jest
        .fn()
        .mockImplementation((_entity: unknown, value: { id?: number }) => {
          value.id ??= 100;
          return Promise.resolve(value);
        }),
    };
    const transfers = {
      isContractOfferEligible: jest.fn().mockResolvedValue(true),
      completeAcquisition: jest.fn().mockResolvedValue(null),
    };
    const budget = {
      canAfford: jest.fn().mockResolvedValue(true),
      recordTransferFee: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ContractsService(
      { manager } as unknown as DataSource,
      transfers as unknown as TransfersService,
      budget as unknown as AiClubBudgetService,
    );
    return {
      manager,
      service,
      transfers,
      budget,
      player,
      career,
      team,
      openOffer,
      event,
    };
  }

  it('persists a normal active contract, acquisition and expiration while clearing the user response', async () => {
    const {
      manager,
      service,
      transfers,
      career,
      team,
      player,
      openOffer,
      event,
    } = setup();
    expect(
      await service.signLegendFreeAgentForAi(
        manager as unknown as EntityManager,
        career,
        team.id,
        player.id,
        terms,
      ),
    ).toBe(true);
    expect(transfers.completeAcquisition).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        status: ContractOfferStatus.SIGNED,
        offerType: ContractOfferType.FREE_AGENT,
        careerTeamId: team.id,
      }),
      team,
      '2026-12-01',
    );
    expect(manager.save).toHaveBeenCalledWith(
      PlayerContract,
      expect.objectContaining({
        status: PlayerContractStatus.ACTIVE,
        startDate: '2026-12-01',
        endDate: '2028-11-30',
        careerTeamId: team.id,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      CalendarEvent,
      expect.objectContaining({
        type: CalendarEventType.CONTRACT_EXPIRATION,
        scheduledDate: '2028-12-01',
      }),
    );
    expect(openOffer.status).toBe(ContractOfferStatus.WITHDRAWN);
    expect(event).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        requiresUserAction: false,
      }),
    );
  });

  it.each([
    'closed',
    'ordinary-player',
    'full-bench',
    'owned',
    'unwilling',
    'ineligible',
    'managed-team',
    'budget',
  ])('does not mutate when %s', async (reason) => {
    const { manager, service, transfers, budget, career, team, player } =
      setup();
    if (reason === 'closed') career.currentDate = '2027-01-01';
    if (reason === 'ordinary-player') manager.findOneBy.mockResolvedValue(null);
    if (reason === 'full-bench') manager.countBy.mockResolvedValue(5);
    if (reason === 'owned') player.currentTeamId = 1;
    if (reason === 'ineligible')
      transfers.isContractOfferEligible.mockResolvedValue(false);
    if (reason === 'budget') budget.canAfford.mockResolvedValue(false);
    if (reason === 'managed-team')
      manager.findOne.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === CareerTeam ? null : player),
      );
    const offerTerms =
      reason === 'unwilling' ? { ...terms, annualSalary: 1 } : terms;
    expect(
      await service.signLegendFreeAgentForAi(
        manager as unknown as EntityManager,
        career,
        team.id,
        player.id,
        offerTerms,
      ),
    ).toBe(false);
    expect(manager.save).not.toHaveBeenCalled();
    expect(transfers.completeAcquisition).not.toHaveBeenCalled();
  });

  it('only exposes the managed club offers after AI contracts exist', async () => {
    const { manager, service, team, career } = setup();
    manager.findOne.mockResolvedValue(career);
    manager.findOneBy.mockResolvedValue({
      ...team,
      id: 1,
      isUserControlled: true,
    });
    manager.find.mockResolvedValue([]);
    await service.findOffers(7, career.id);
    expect(manager.find).toHaveBeenCalledWith(
      ContractOffer,
      expect.objectContaining({ where: { careerId: 1, careerTeamId: 1 } }),
    );
  });

  it('does not swallow acquisition failures after writes begin', async () => {
    const { manager, service, transfers, career, team, player } = setup();
    transfers.completeAcquisition.mockRejectedValue(
      new Error('storage failed'),
    );
    await expect(
      service.signLegendFreeAgentForAi(
        manager as unknown as EntityManager,
        career,
        team.id,
        player.id,
        terms,
      ),
    ).rejects.toThrow('storage failed');
    expect(manager.save).not.toHaveBeenCalledWith(Roster, expect.anything());
  });
});
