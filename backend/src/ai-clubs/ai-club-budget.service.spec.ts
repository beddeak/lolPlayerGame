import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Career } from '../careers/entities/career.entity';
import {
  ContractExpectedRole,
  ContractOfferStatus,
  ContractOfferType,
  ContractTerms,
  PlayerContractStatus,
} from '../contracts/contract.types';
import { ContractOffer } from '../contracts/entities/contract-offer.entity';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import { TransferAgreement } from '../transfers/entities/transfer-agreement.entity';
import {
  AiClubBudgetService,
  estimateAiAnnualSalary,
} from './ai-club-budget.service';
import { AI_CLUB_CONFIG } from './config/ai-club.config';
import { AiClubDifficulty, AiClubState } from './entities/ai-club-state.entity';

const career = Object.assign(new Career(), {
  id: 1,
  currentDate: '2026-11-25',
});
const teamId = 2;

function initialPlayers(): CareerPlayer[] {
  return STARTER_POSITIONS.map((position, index) =>
    Object.assign(new CareerPlayer(), {
      id: index + 1,
      careerId: career.id,
      currentTeamId: teamId,
      currentPosition: position,
      currentMechanics: 70,
      currentGameSense: 70,
      currentLaning: 70,
      currentTeamFight: 70,
      currentMacro: 70,
      currentTeamPlay: 70,
      currentMental: 70,
      currentChampionPool: 70,
    }),
  );
}

function terms(annualSalary: number): ContractTerms {
  return {
    annualSalary,
    years: 2,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.CORE,
    promises: [],
  };
}

function contract(
  careerPlayerId: number,
  annualSalary: number,
  endDate = '2027-11-18',
): PlayerContract {
  return Object.assign(new PlayerContract(), {
    careerId: career.id,
    careerTeamId: teamId,
    careerPlayerId,
    terms: terms(annualSalary),
    status: PlayerContractStatus.ACTIVE,
    endDate,
  });
}

function offer(
  id: number,
  careerPlayerId: number,
  annualSalary: number,
  overrides: Partial<ContractOffer> = {},
): ContractOffer {
  return Object.assign(new ContractOffer(), {
    id,
    careerId: career.id,
    careerTeamId: teamId,
    careerPlayerId,
    terms: terms(annualSalary),
    offerType: ContractOfferType.FREE_AGENT,
    offeredDate: '2026-11-23',
    status: ContractOfferStatus.WAITING_PLAYER_RESPONSE,
    transferAgreement: null,
    ...overrides,
  });
}

function state(overrides: Partial<AiClubState> = {}): AiClubState {
  return Object.assign(new AiClubState(), {
    id: 1,
    careerId: career.id,
    careerTeamId: teamId,
    difficulty: AiClubDifficulty.EASY,
    budgetYear: 2026,
    annualSalaryBudget: AI_CLUB_CONFIG.initialSalaryBudget,
    transferBudget: AI_CLUB_CONFIG.initialTransferBudget,
    transferSpent: 100_000,
    lastDecisionDate: '2026-11-22',
    ...overrides,
  });
}

function fixture(
  options: {
    state?: AiClubState | null;
    players?: CareerPlayer[];
    contracts?: PlayerContract[];
    offers?: ContractOffer[];
  } = {},
) {
  const players = options.players ?? initialPlayers();
  const contracts = options.contracts ?? [];
  const offers = options.offers ?? [];
  let storedState = options.state === undefined ? state() : options.state;
  const mock = {
    findOneBy: jest.fn().mockResolvedValue(
      Object.assign(new CareerTeam(), {
        id: teamId,
        careerId: career.id,
        isUserControlled: false,
      }),
    ),
    findOne: jest.fn().mockImplementation(() => Promise.resolve(storedState)),
    findBy: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === CareerPlayer) return Promise.resolve(players);
      if (entity === PlayerContract) return Promise.resolve(contracts);
      throw new Error('Unexpected entity');
    }),
    find: jest.fn().mockResolvedValue(offers),
    create: jest
      .fn()
      .mockImplementation((_: unknown, values: Partial<AiClubState>) =>
        Object.assign(new AiClubState(), values),
      ),
    save: jest.fn().mockImplementation((_: unknown, value: AiClubState) => {
      storedState = value;
      return Promise.resolve(value);
    }),
  };
  return {
    service: new AiClubBudgetService(),
    manager: mock as unknown as EntityManager,
    mock,
    players,
    storedState: () => storedState,
  };
}

describe('AiClubBudgetService', () => {
  it('charges estimated wages for all five initial players without contracts', async () => {
    const { service, manager, mock, players } = fixture();
    expect(estimateAiAnnualSalary(players[0])).toBe(74_500);
    const summary = await service.summarize(manager, career, teamId, null);
    expect(summary).toMatchObject({
      annualSalaryBudget: 1_000_000,
      salaryCommitted: 372_500,
      salaryAvailable: 627_500,
    });
    expect(mock.findBy).toHaveBeenCalledWith(CareerPlayer, {
      careerId: career.id,
      currentTeamId: teamId,
    });
    expect(mock.findBy).toHaveBeenCalledWith(PlayerContract, {
      careerId: career.id,
      careerTeamId: teamId,
      status: PlayerContractStatus.ACTIVE,
    });
  });

  it('replaces an estimate with an active salary and ignores expired/non-roster contracts', async () => {
    const { service, manager } = fixture({
      contracts: [
        contract(1, 150_000, career.currentDate),
        contract(2, 40_000, '2026-11-24'),
        contract(99, 900_000),
      ],
    });
    const summary = await service.summarize(manager, career, teamId, null);
    expect(summary.salaryCommitted).toBe(150_000 + 4 * 74_500);
  });

  it('reserves pending signings and the maximum renewal salary without double-counting a player', async () => {
    const { service, manager, mock } = fixture({
      offers: [
        offer(1, 1, 100_000, { offerType: ContractOfferType.RENEWAL }),
        offer(2, 2, 30_000, { offerType: ContractOfferType.RENEWAL }),
        offer(3, 6, 90_000, { status: ContractOfferStatus.PLAYER_ACCEPTED }),
        offer(4, 7, 110_000, {
          offerType: ContractOfferType.TRANSFER,
          transferAgreement: Object.assign(new TransferAgreement(), {
            offeredFee: 60_000,
          }),
        }),
      ],
    });
    const summary = await service.summarize(manager, career, teamId, state());
    expect(summary.salaryCommitted).toBe(100_000 + 4 * 74_500 + 200_000);
    expect(summary.transferReserved).toBe(60_000);
    expect(mock.find).toHaveBeenCalledWith(ContractOffer, {
      where: {
        careerId: career.id,
        careerTeamId: teamId,
        status: In([
          ContractOfferStatus.WAITING_PLAYER_RESPONSE,
          ContractOfferStatus.PLAYER_ACCEPTED,
          ContractOfferStatus.COUNTER_OFFERED,
        ]),
      },
      relations: { transferAgreement: true },
      order: { id: 'ASC' },
    });
  });

  it('replaces the target player current/pending salary when assessing a renewal', async () => {
    const { service, manager } = fixture({
      state: state({ annualSalaryBudget: 600_000 }),
      contracts: [contract(1, 200_000)],
      offers: [offer(11, 1, 250_000, { offerType: ContractOfferType.RENEWAL })],
    });
    await expect(
      service.canAfford(manager, career, teamId, 1, 302_000, 0, 11),
    ).resolves.toBe(true);
    await expect(
      service.canAfford(manager, career, teamId, 1, 302_001, 0, 11),
    ).resolves.toBe(false);
  });

  it('counts spent plus reserved fees and replaces the target offer reservation on signing', async () => {
    const { service, manager } = fixture({
      offers: [
        offer(11, 6, 100_000, {
          offerType: ContractOfferType.TRANSFER,
          transferAgreement: Object.assign(new TransferAgreement(), {
            offeredFee: 200_000,
          }),
        }),
        offer(12, 7, 100_000, {
          offerType: ContractOfferType.TRANSFER,
          transferAgreement: Object.assign(new TransferAgreement(), {
            offeredFee: 150_000,
          }),
        }),
      ],
    });
    await expect(
      service.canAfford(manager, career, teamId, 6, 100_000, 250_000, 11),
    ).resolves.toBe(true);
    await expect(
      service.canAfford(manager, career, teamId, 6, 100_000, 250_001, 11),
    ).resolves.toBe(false);
    await expect(
      service.canAfford(manager, career, teamId, 8, 100_000, 50_000),
    ).resolves.toBe(true);
    await expect(
      service.canAfford(manager, career, teamId, 8, 100_000, 50_001),
    ).resolves.toBe(false);
  });

  it('drops out-of-window acquisition reservations while retaining year-round renewals', async () => {
    const { service, manager } = fixture({
      players: [],
      offers: [
        offer(1, 1, 40_000, {
          offerType: ContractOfferType.RENEWAL,
          offeredDate: '2025-12-30',
        }),
        offer(2, 2, 80_000, { offeredDate: '2025-12-30' }),
        offer(3, 3, 90_000, {
          offerType: ContractOfferType.TRANSFER,
          transferAgreement: Object.assign(new TransferAgreement(), {
            offeredFee: 50_000,
          }),
        }),
      ],
    });
    expect(
      await service.summarize(manager, career, teamId, null),
    ).toMatchObject({ salaryCommitted: 130_000, transferReserved: 50_000 });
    expect(
      await service.summarize(
        manager,
        Object.assign(new Career(), career, { currentDate: '2027-01-01' }),
        teamId,
        null,
      ),
    ).toMatchObject({ salaryCommitted: 40_000, transferReserved: 0 });
  });

  it('creates a missing AI-only state with configured caps and reuses it', async () => {
    const { service, manager, mock } = fixture({ state: null });
    const created = await service.getOrCreate(manager, career, teamId);
    expect(created).toMatchObject({
      careerId: career.id,
      careerTeamId: teamId,
      difficulty: AiClubDifficulty.EASY,
      budgetYear: 2026,
      annualSalaryBudget: AI_CLUB_CONFIG.initialSalaryBudget,
      transferBudget: AI_CLUB_CONFIG.initialTransferBudget,
      transferSpent: 0,
      lastDecisionDate: null,
    });
    expect(await service.getOrCreate(manager, career, teamId)).toBe(created);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(mock.findOneBy).toHaveBeenCalledWith(CareerTeam, {
      id: teamId,
      careerId: career.id,
      isUserControlled: false,
    });
    expect(mock.findOne).toHaveBeenCalledWith(AiClubState, {
      where: { careerId: career.id, careerTeamId: teamId },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('rejects missing or non-AI teams without creating a budget', async () => {
    const { service, manager, mock } = fixture({ state: null });
    mock.findOneBy.mockResolvedValue(null);
    await expect(
      service.getOrCreate(manager, career, teamId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.findOne).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('resets annual transfer spending once without resetting decisions or configured caps', async () => {
    const existing = state({
      budgetYear: 2025,
      annualSalaryBudget: 800_000,
      transferBudget: 300_000,
      transferSpent: 200_000,
      lastDecisionDate: '2025-12-30',
    });
    const { service, manager, mock } = fixture({ state: existing });
    expect(await service.getOrCreate(manager, career, teamId)).toBe(existing);
    expect(existing).toMatchObject({
      budgetYear: 2026,
      transferSpent: 0,
      lastDecisionDate: '2025-12-30',
      annualSalaryBudget: 800_000,
      transferBudget: 300_000,
    });
    await service.getOrCreate(manager, career, teamId);
    expect(mock.save).toHaveBeenCalledTimes(1);
  });

  it('records transfer fees at the cap and leaves state unchanged on zero or overspend', async () => {
    const { service, manager, mock, storedState } = fixture();
    await service.recordTransferFee(manager, career, teamId, 400_000);
    expect(storedState()?.transferSpent).toBe(500_000);
    expect(mock.save).toHaveBeenCalledTimes(1);
    await service.recordTransferFee(manager, career, teamId, 0);
    await expect(
      service.recordTransferFee(manager, career, teamId, 1),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storedState()?.transferSpent).toBe(500_000);
    expect(mock.save).toHaveBeenCalledTimes(1);
  });

  it.each([Number.NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed annual salary %s before reading or writing the database',
    async (salary) => {
      const { service, manager, mock } = fixture();
      await expect(
        service.canAfford(manager, career, teamId, 6, salary, 0),
      ).resolves.toBe(false);
      expect(mock.findOneBy).not.toHaveBeenCalled();
      expect(mock.find).not.toHaveBeenCalled();
      expect(mock.save).not.toHaveBeenCalled();
    },
  );

  it.each([Number.NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed transfer fee %s without spending it',
    async (fee) => {
      const { service, manager, mock, storedState } = fixture();
      await expect(
        service.canAfford(manager, career, teamId, 6, 100_000, fee),
      ).resolves.toBe(false);
      expect(mock.findOneBy).not.toHaveBeenCalled();
      await expect(
        service.recordTransferFee(manager, career, teamId, fee),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storedState()?.transferSpent).toBe(100_000);
      expect(mock.save).not.toHaveBeenCalled();
    },
  );

  it.each([null, state({ budgetYear: 2025, transferSpent: 450_000 })])(
    'summarizes a missing or previous-year state without lazy writes or mutation',
    async (existing) => {
      const { service, manager, mock } = fixture({ state: existing });
      const before = existing === null ? null : { ...existing };
      const summary = await service.summarize(
        manager,
        career,
        teamId,
        existing,
      );
      expect(summary).toMatchObject({
        year: 2026,
        transferSpent: 0,
        transferAvailable: 500_000,
      });
      expect(existing).toEqual(before);
      expect(mock.findOneBy).not.toHaveBeenCalled();
      expect(mock.findOne).not.toHaveBeenCalled();
      expect(mock.create).not.toHaveBeenCalled();
      expect(mock.save).not.toHaveBeenCalled();
    },
  );

  it('reports zero available funds instead of negative values for existing over-budget squads', async () => {
    const { service, manager } = fixture({
      offers: [
        offer(1, 6, 100_000, {
          transferAgreement: Object.assign(new TransferAgreement(), {
            offeredFee: 450_000,
          }),
        }),
      ],
    });
    expect(
      await service.summarize(
        manager,
        career,
        teamId,
        state({ annualSalaryBudget: 100_000 }),
      ),
    ).toMatchObject({
      salaryCommitted: 472_500,
      salaryAvailable: 0,
      transferSpent: 100_000,
      transferReserved: 450_000,
      transferAvailable: 0,
    });
  });
});
