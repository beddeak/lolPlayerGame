import 'reflect-metadata';
import { DataSource, EntityManager, FindOperator } from 'typeorm';
import { AiClubBudgetService } from '../ai-clubs/ai-club-budget.service';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { LegendEventPlayer } from '../legends/entities/legend-event-player.entity';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { TransferAgreement } from '../transfers/entities/transfer-agreement.entity';
import { TransfersService } from '../transfers/transfers.service';
import { TransferAgreementStatus } from '../transfers/transfer.types';
import {
  ContractDecisionAction,
  ContractExpectedRole,
  ContractOfferStatus,
  ContractOfferType,
  PlayerContractStatus,
} from './contract.types';
import { ContractsService } from './contracts.service';
import { ContractOffer } from './entities/contract-offer.entity';
import { PlayerContract } from './entities/player-contract.entity';

const terms = {
  annualSalary: 200_000,
  years: 2,
  starterGuarantee: true,
  expectedRole: ContractExpectedRole.CORE,
  promises: [],
};

function setup() {
  const career = {
    id: 1,
    accountId: 7,
    currentDate: '2026-11-23',
    currentYear: 2026,
  } as Career;
  const team = {
    id: 2,
    careerId: 1,
    name: 'AI',
    isUserControlled: false,
  } as CareerTeam;
  const home = {
    id: 1,
    careerId: 1,
    name: 'Home',
    isUserControlled: true,
  } as CareerTeam;
  const player = {
    id: 9,
    careerId: 1,
    currentTeamId: null,
    coachTrust: 60,
    personality: PlayerPersonality.PROFESSIONAL,
    currentMechanics: 80,
    currentGameSense: 80,
    currentLaning: 80,
    currentTeamFight: 80,
    currentMacro: 80,
    currentTeamPlay: 80,
    currentMental: 80,
    currentChampionPool: 80,
    playerCard: { player: { nickname: 'Candidate' } },
  } as CareerPlayer;
  const offers: ContractOffer[] = [];
  const events: CalendarEvent[] = [];
  let contract: PlayerContract | null = null;
  let legend: Partial<LegendEventPlayer> | null = null;
  let nextId = 100;
  const agreement = {
    id: 50,
    careerId: 1,
    careerPlayerId: 9,
    buyerCareerTeamId: 2,
    sellerCareerTeamId: 3,
    offeredFee: 100_000,
    offeredDate: career.currentDate,
    status: TransferAgreementStatus.ACCEPTED,
  } as TransferAgreement;
  const matches = (value: object, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, condition]) => {
      const field = (value as Record<string, unknown>)[key];
      if (condition instanceof FindOperator && condition.type === 'between') {
        const [start, end] = condition.value as string[];
        return typeof field === 'string' && field >= start && field <= end;
      }
      return condition instanceof FindOperator
        ? (condition.value as unknown[]).includes(field)
        : condition === field;
    });
  const manager = {
    findOne: jest
      .fn()
      .mockImplementation(
        (entity: unknown, options: { where: Record<string, unknown> }) => {
          const values: object[] =
            entity === Career
              ? [career]
              : entity === CareerTeam
                ? [team, home]
                : entity === CareerPlayer
                  ? [player]
                  : entity === ContractOffer
                    ? offers
                    : entity === CalendarEvent
                      ? events
                      : entity === PlayerContract
                        ? contract
                          ? [contract]
                          : []
                        : entity === TransferAgreement
                          ? [agreement]
                          : entity === LegendEventPlayer
                            ? legend
                              ? [legend]
                              : []
                            : [];
          return Promise.resolve(
            values.find((value) => matches(value, options.where)) ?? null,
          );
        },
      ),
    findOneBy: jest.fn(),
    findBy: jest.fn().mockResolvedValue([player]),
    find: jest
      .fn()
      .mockImplementation(
        (entity: unknown, options: { where: Record<string, unknown> }) =>
          Promise.resolve(
            entity === ContractOffer
              ? offers.filter((value) => matches(value, options.where))
              : [],
          ),
      ),
    countBy: jest.fn().mockResolvedValue(0),
    create: jest
      .fn()
      .mockImplementation((_entity: unknown, value: object) => ({ ...value })),
    save: jest
      .fn()
      .mockImplementation((entity: unknown, value: { id?: number }) => {
        value.id ??= nextId++;
        if (
          entity === ContractOffer &&
          !offers.includes(value as ContractOffer)
        )
          offers.push(value as ContractOffer);
        if (
          entity === CalendarEvent &&
          !events.includes(value as CalendarEvent)
        )
          events.push(value as CalendarEvent);
        if (entity === PlayerContract) contract = value as PlayerContract;
        return Promise.resolve(value);
      }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  manager.findOneBy.mockImplementation(
    (entity: unknown, where: Record<string, unknown>) =>
      manager.findOne(entity, { where }) as Promise<unknown>,
  );
  const transfers = {
    quoteAiTransfer: jest.fn().mockResolvedValue({
      careerPlayerId: 9,
      sellerCareerTeamId: 3,
      requiredFee: 100_000,
    }),
    createAiAgreement: jest.fn().mockResolvedValue(agreement),
    isContractOfferEligible: jest.fn().mockResolvedValue(true),
    assertContractOfferEligible: jest.fn().mockResolvedValue(player),
    completeAcquisition: jest
      .fn()
      .mockImplementation((_manager: unknown, offer: ContractOffer) => {
        player.currentTeamId = offer.careerTeamId;
        return Promise.resolve(null);
      }),
    prepareContractOffer: jest.fn().mockResolvedValue({
      player,
      offerType: ContractOfferType.FREE_AGENT,
      sourceCareerTeamId: null,
      transferAgreementId: null,
    }),
  };
  const budget = {
    canAfford: jest.fn().mockResolvedValue(true),
    recordTransferFee: jest.fn().mockResolvedValue(undefined),
  };
  const transaction = jest
    .fn()
    .mockImplementation((callback: (em: EntityManager) => Promise<unknown>) =>
      callback(manager as unknown as EntityManager),
    );
  const service = new ContractsService(
    { manager, transaction } as unknown as DataSource,
    transfers as unknown as TransfersService,
    budget as unknown as AiClubBudgetService,
  );
  const create = () =>
    service.createAiOffer(
      manager as unknown as EntityManager,
      career,
      team.id,
      player.id,
      terms,
    );
  const respond = async (offer: ContractOffer) => {
    const event = events.find((value) => value.id === offer.responseEventId)!;
    await service.processResponseEvent(
      manager as unknown as EntityManager,
      event,
      offer.responseDate,
    );
    return event;
  };
  return {
    career,
    team,
    home,
    player,
    offers,
    events,
    manager,
    transfers,
    budget,
    service,
    agreement,
    create,
    respond,
    getContract: () => contract,
    setLegend: (value: Partial<LegendEventPlayer>) => {
      legend = { careerId: 1, careerPlayerId: 9, ...value };
    },
  };
}

describe('Easy AI delayed contracts', () => {
  it('creates a delayed non-blocking offer without immediately acquiring the player', async () => {
    const { create, events, player, transfers, budget } = setup();
    const offer = (await create())!;
    expect(offer.status).toBe(ContractOfferStatus.WAITING_PLAYER_RESPONSE);
    expect(offer.responseDate > offer.offeredDate).toBe(true);
    expect(offer.responseDate <= '2026-11-26').toBe(true);
    expect(events[0]).toMatchObject({
      type: CalendarEventType.CONTRACT_RESPONSE,
      requiresUserAction: false,
      status: CalendarEventStatus.SCHEDULED,
    });
    expect(player.currentTeamId).toBeNull();
    expect(transfers.completeAcquisition).not.toHaveBeenCalled();
    expect(budget.canAfford).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      2,
      9,
      200_000,
      0,
    );
  });

  it.each([
    'managed',
    'closed',
    'full',
    'budget',
    'ineligible',
    'legend-pending',
    'legend-today',
  ])('does not create an offer for %s', async (reason) => {
    const current = setup();
    if (reason === 'managed') current.team.isUserControlled = true;
    if (reason === 'closed') current.career.currentDate = '2027-01-01';
    if (reason === 'full') current.manager.countBy.mockResolvedValue(5);
    if (reason === 'budget') current.budget.canAfford.mockResolvedValue(false);
    if (reason === 'ineligible')
      current.transfers.isContractOfferEligible.mockResolvedValue(false);
    if (reason === 'legend-pending')
      current.setLegend({ aiProcessedDate: null });
    if (reason === 'legend-today')
      current.setLegend({ aiProcessedDate: current.career.currentDate });
    expect(await current.create()).toBeNull();
    expect(current.offers).toHaveLength(0);
    expect(current.events).toHaveLength(0);
    expect(current.transfers.createAiAgreement).not.toHaveBeenCalled();
  });

  it('can renew its own player outside the acquisition window and despite a full bench', async () => {
    const current = setup();
    current.career.currentDate = '2027-10-20';
    current.player.currentTeamId = current.team.id;
    current.manager.countBy.mockResolvedValue(5);
    const offer = (await current.create())!;
    expect(offer.offerType).toBe(ContractOfferType.RENEWAL);
    await current.respond(offer);
    expect(offer.status).toBe(ContractOfferStatus.SIGNED);
    expect(current.getContract()?.status).toBe(PlayerContractStatus.ACTIVE);
  });

  it('rejects duplicate AI offers but allows the user to compete for the same FA', async () => {
    const current = setup();
    await current.create();
    expect(await current.create()).toBeNull();
    const userOffer = await current.service.createOffer(7, 1, {
      careerPlayerId: 9,
      terms,
    });
    expect(userOffer.careerTeamId).toBe(current.home.id);
    expect(current.offers).toHaveLength(2);
  });

  it('does not start an AI renewal after the seller has accepted a current-window sale', async () => {
    const current = setup();
    current.player.currentTeamId = current.team.id;
    current.agreement.sellerCareerTeamId = current.team.id;
    current.agreement.buyerCareerTeamId = current.home.id;
    expect(await current.create()).toBeNull();
    expect(current.offers).toHaveLength(0);
    expect(current.events).toHaveLength(0);
    expect(current.agreement.status).toBe(TransferAgreementStatus.ACCEPTED);
  });

  it.each(['old-window', 'future-date', 'cancelled', 'different-player'])(
    'does not let a %s sale incorrectly block an AI renewal',
    async (reason) => {
      const current = setup();
      current.player.currentTeamId = current.team.id;
      current.agreement.sellerCareerTeamId = current.team.id;
      if (reason === 'old-window') current.agreement.offeredDate = '2025-12-01';
      if (reason === 'future-date')
        current.agreement.offeredDate = '2026-11-24';
      if (reason === 'cancelled')
        current.agreement.status = TransferAgreementStatus.CANCELLED;
      if (reason === 'different-player') current.agreement.careerPlayerId = 10;
      expect((await current.create())?.offerType).toBe(
        ContractOfferType.RENEWAL,
      );
    },
  );

  it('withdraws a pending AI renewal if the club subsequently accepts a sale without cancelling the buyer contract', async () => {
    const current = setup();
    current.player.currentTeamId = current.team.id;
    const renewal = (await current.create())!;
    current.agreement.sellerCareerTeamId = current.team.id;
    current.agreement.buyerCareerTeamId = current.home.id;
    current.transfers.prepareContractOffer.mockResolvedValue({
      player: current.player,
      offerType: ContractOfferType.TRANSFER,
      sourceCareerTeamId: current.team.id,
      transferAgreementId: current.agreement.id,
    });
    const buyerOffer = await current.service.createOffer(7, 1, {
      careerPlayerId: current.player.id,
      transferAgreementId: current.agreement.id,
      terms,
    });
    const event = await current.respond(renewal);
    expect(renewal.status).toBe(ContractOfferStatus.WITHDRAWN);
    expect(event.requiresUserAction).toBe(false);
    expect(buyerOffer.status).toBe(ContractOfferStatus.WAITING_PLAYER_RESPONSE);
    expect(
      current.events.find((queued) => queued.id === buyerOffer.responseEventId),
    ).toMatchObject({
      status: CalendarEventStatus.SCHEDULED,
      requiresUserAction: true,
    });
    expect(current.agreement.status).toBe(TransferAgreementStatus.ACCEPTED);
    expect(current.transfers.completeAcquisition).not.toHaveBeenCalled();
    expect(current.manager.update).not.toHaveBeenCalled();
  });

  it('leaves the user-managed renewal decision unchanged by this AI-only sale rule', async () => {
    const current = setup();
    current.player.currentTeamId = current.home.id;
    current.agreement.sellerCareerTeamId = current.home.id;
    current.transfers.prepareContractOffer.mockResolvedValue({
      player: current.player,
      offerType: ContractOfferType.RENEWAL,
      sourceCareerTeamId: current.home.id,
      transferAgreementId: null,
    });
    const offer = await current.service.createOffer(7, 1, {
      careerPlayerId: current.player.id,
      terms,
    });
    await current.respond(offer);
    expect(offer.status).toBe(ContractOfferStatus.PLAYER_ACCEPTED);
    expect(
      current.events.find((event) => event.id === offer.responseEventId)
        ?.requiresUserAction,
    ).toBe(true);
  });

  it('does not leak an accepted transfer agreement when its quoted fee exceeds budget', async () => {
    const current = setup();
    current.player.currentTeamId = 3;
    current.budget.canAfford.mockResolvedValue(false);
    expect(await current.create()).toBeNull();
    expect(current.transfers.quoteAiTransfer).toHaveBeenCalled();
    expect(current.transfers.createAiAgreement).not.toHaveBeenCalled();
    expect(current.manager.save).not.toHaveBeenCalled();
  });

  it('skips protected or non-replaceable sellers rejected by the transfer quote', async () => {
    const current = setup();
    current.player.currentTeamId = current.home.id;
    current.transfers.quoteAiTransfer.mockResolvedValue(null);
    expect(await current.create()).toBeNull();
    expect(current.transfers.createAiAgreement).not.toHaveBeenCalled();
  });

  it('rechecks budget and creates contract, expiration, non-blocking news and fee record on transfer success', async () => {
    const current = setup();
    current.player.currentTeamId = 3;
    const offer = (await current.create())!;
    const event = await current.respond(offer);
    expect(offer.status).toBe(ContractOfferStatus.SIGNED);
    expect(offer.transferAgreementId).toBe(50);
    expect(current.getContract()).toMatchObject({
      careerTeamId: 2,
      sourceOfferId: offer.id,
      status: PlayerContractStatus.ACTIVE,
    });
    expect(
      current.events.some(
        (value) => value.type === CalendarEventType.CONTRACT_EXPIRATION,
      ),
    ).toBe(true);
    expect(event).toMatchObject({
      type: CalendarEventType.AI_CLUB_UPDATE,
      requiresUserAction: false,
    });
    expect(current.budget.canAfford).toHaveBeenLastCalledWith(
      current.manager,
      expect.objectContaining({ currentDate: offer.responseDate }),
      2,
      9,
      200_000,
      100_000,
      offer.id,
    );
    expect(current.budget.recordTransferFee).toHaveBeenCalledWith(
      current.manager,
      expect.anything(),
      2,
      100_000,
    );
    expect(event.payload?.message).toContain('Candidate');
  });

  it.each(['counter', 'distrust', 'budget', 'full', 'ineligible', 'closed'])(
    'terminates without blocking when final signing is %s',
    async (reason) => {
      const current = setup();
      current.player.currentTeamId = reason === 'distrust' ? 2 : 3;
      const offer = (await current.create())!;
      if (reason === 'counter') offer.terms.annualSalary = 1;
      if (reason === 'distrust') current.player.coachTrust = 0;
      if (reason === 'budget')
        current.budget.canAfford.mockResolvedValue(false);
      if (reason === 'full') current.manager.countBy.mockResolvedValue(5);
      if (reason === 'ineligible')
        current.transfers.isContractOfferEligible.mockResolvedValue(false);
      if (reason === 'closed') offer.responseDate = '2027-01-01';
      const event = await current.respond(offer);
      expect(offer.status).toBe(ContractOfferStatus.WITHDRAWN);
      expect(event.requiresUserAction).toBe(false);
      expect(current.transfers.completeAcquisition).not.toHaveBeenCalled();
      expect(current.budget.recordTransferFee).not.toHaveBeenCalled();
      if (reason !== 'distrust')
        expect(current.manager.update).toHaveBeenCalledWith(
          TransferAgreement,
          expect.objectContaining({ id: 50 }),
          expect.objectContaining({
            status: TransferAgreementStatus.CANCELLED,
          }),
        );
    },
  );

  it('withdraws the competing user offer and completes its event when AI signs first', async () => {
    const current = setup();
    const aiOffer = (await current.create())!;
    const userOffer = await current.service.createOffer(7, 1, {
      careerPlayerId: 9,
      terms,
    });
    await current.respond(aiOffer);
    expect(userOffer.status).toBe(ContractOfferStatus.WITHDRAWN);
    expect(
      current.events.find((event) => event.id === userOffer.responseEventId),
    ).toMatchObject({
      status: CalendarEventStatus.COMPLETED,
      requiresUserAction: false,
    });
  });

  it('withdraws the competing AI offer and prevents a later AI acquisition when the user signs first', async () => {
    const current = setup();
    const aiOffer = (await current.create())!;
    const userOffer = await current.service.createOffer(7, 1, {
      careerPlayerId: 9,
      terms,
    });
    userOffer.status = ContractOfferStatus.PLAYER_ACCEPTED;
    current.career.currentDate = userOffer.responseDate;
    current.events.find(
      (event) => event.id === userOffer.responseEventId,
    )!.status = CalendarEventStatus.READY;
    await current.service.respond(7, 1, userOffer.id, {
      action: ContractDecisionAction.ACCEPT,
    });
    expect(aiOffer.status).toBe(ContractOfferStatus.WITHDRAWN);
    expect(
      current.events.find((event) => event.id === aiOffer.responseEventId),
    ).toMatchObject({
      status: CalendarEventStatus.COMPLETED,
      requiresUserAction: false,
    });
    await current.respond(aiOffer);
    expect(current.player.currentTeamId).toBe(current.home.id);
    expect(current.transfers.completeAcquisition).toHaveBeenCalledTimes(1);
    expect(current.budget.recordTransferFee).not.toHaveBeenCalled();
  });

  it('propagates storage failure after signing starts so the career transaction can roll back', async () => {
    const current = setup();
    const offer = (await current.create())!;
    current.transfers.completeAcquisition.mockRejectedValueOnce(
      new Error('database failed'),
    );
    await expect(current.respond(offer)).rejects.toThrow('database failed');
  });
});
