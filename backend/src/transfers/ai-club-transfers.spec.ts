import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { ContractOfferType } from '../contracts/contract.types';
import { ContractOffer } from '../contracts/entities/contract-offer.entity';
import { Position } from '../players/enums/position.enum';
import { TransferAgreement } from './entities/transfer-agreement.entity';
import { calculateRequiredTransferFee } from './transfer-policy';
import { TransferAgreementStatus } from './transfer.types';
import { TransfersService } from './transfers.service';

function setup() {
  const career = { id: 1, currentDate: '2026-11-23' } as Career;
  const buyer = { id: 2, careerId: 1, isUserControlled: false } as CareerTeam;
  const seller = { id: 3, careerId: 1, isUserControlled: false } as CareerTeam;
  const player = {
    id: 9,
    careerId: 1,
    currentTeamId: seller.id,
    currentAge: 24,
    currentMechanics: 80,
    currentGameSense: 80,
    currentLaning: 80,
    currentTeamFight: 80,
    currentMacro: 80,
    currentTeamPlay: 80,
    currentMental: 80,
    currentChampionPool: 80,
    currentPosition: Position.MID,
  } as CareerPlayer;
  const roster = {
    id: 20,
    careerTeamId: seller.id,
    careerPlayerId: player.id,
    role: RosterRole.BENCH,
    starterPosition: null,
  } as Roster;
  const replacements: Roster[] = [];
  let existing: TransferAgreement | null = null;
  const manager = {
    findOne: jest
      .fn()
      .mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === CareerPlayer
            ? player
            : entity === CareerTeam
              ? seller
              : entity === Roster
                ? roster
                : entity === TransferAgreement
                  ? existing
                  : null,
        ),
      ),
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue(replacements),
    create: jest
      .fn()
      .mockImplementation((_entity: unknown, value: object) => ({ ...value })),
    save: jest
      .fn()
      .mockImplementation((_entity: unknown, value: object) =>
        Promise.resolve({ id: 100, ...value }),
      ),
  };
  const service = new TransfersService({} as DataSource);
  const quote = () =>
    service.quoteAiTransfer(
      manager as unknown as EntityManager,
      career,
      buyer,
      player.id,
    );
  return {
    career,
    buyer,
    seller,
    player,
    roster,
    replacements,
    manager,
    service,
    quote,
    setExisting: (value: TransferAgreement) => {
      existing = value;
    },
  };
}

describe('AI transfer seller protection and existing market rules', () => {
  it('uses the same deterministic transfer fee formula as the user market', async () => {
    const current = setup();
    const quote = await current.quote();
    expect(quote).toEqual({
      careerPlayerId: 9,
      sellerCareerTeamId: 3,
      requiredFee: calculateRequiredTransferFee({
        ability: 80,
        currentAge: 24,
        rosterRole: RosterRole.BENCH,
        remainingContractDays: 0,
      }),
    });
    expect(current.manager.save).not.toHaveBeenCalled();
  });

  it.each([RosterRole.STARTER, RosterRole.BENCH])(
    'does not quote or sell the user-owned %s',
    async (role) => {
      const current = setup();
      current.seller.isUserControlled = true;
      current.roster.role = role;
      expect(await current.quote()).toBeNull();
      expect(
        await current.service.createAiAgreement(
          current.manager as unknown as EntityManager,
          current.career,
          current.buyer,
          9,
          500_000,
        ),
      ).toBeNull();
      expect(current.manager.save).not.toHaveBeenCalled();
    },
  );

  it('rechecks user ownership at final contract eligibility even if an agreement already exists', async () => {
    const current = setup();
    current.seller.isUserControlled = true;
    const offer = {
      careerId: 1,
      careerPlayerId: 9,
      careerTeamId: 2,
      offerType: ContractOfferType.TRANSFER,
      sourceCareerTeamId: 3,
      transferAgreementId: 50,
    } as ContractOffer;
    expect(
      await current.service.isContractOfferEligible(
        current.manager as unknown as EntityManager,
        offer,
        current.buyer,
      ),
    ).toBe(false);
    await expect(
      current.service.completeAcquisition(
        current.manager as unknown as EntityManager,
        offer,
        current.buyer,
        '2026-11-25',
      ),
    ).rejects.toThrow('사용자 구단 선수');
    expect(current.manager.save).not.toHaveBeenCalled();
  });

  it.each([
    'user-buyer',
    'other-career',
    'closed',
    'own-player',
    'free-agent',
    'inconsistent-roster',
  ])('does not quote an invalid %s transfer', async (reason) => {
    const current = setup();
    if (reason === 'user-buyer') current.buyer.isUserControlled = true;
    if (reason === 'other-career') current.buyer.careerId = 8;
    if (reason === 'closed') current.career.currentDate = '2027-01-01';
    if (reason === 'own-player')
      current.player.currentTeamId = current.buyer.id;
    if (reason === 'free-agent') current.player.currentTeamId = null;
    if (reason === 'inconsistent-roster') current.roster.careerTeamId = 8;
    expect(await current.quote()).toBeNull();
  });

  it('requires a same-position bench replacement before an AI starter can leave', async () => {
    const current = setup();
    current.roster.role = RosterRole.STARTER;
    current.roster.starterPosition = Position.MID;
    expect(await current.quote()).toBeNull();
    current.replacements.push({
      id: 21,
      careerPlayerId: 10,
      careerPlayer: {
        ...current.player,
        id: 10,
        currentPosition: Position.TOP,
      },
    } as Roster);
    expect(await current.quote()).toBeNull();
    current.replacements[0].careerPlayer.currentPosition = Position.MID;
    expect(await current.quote()).not.toBeNull();
  });

  it('creates an accepted agreement only for the quoted fee, then rejects a duplicate', async () => {
    const current = setup();
    const quote = (await current.quote())!;
    expect(
      await current.service.createAiAgreement(
        current.manager as unknown as EntityManager,
        current.career,
        current.buyer,
        9,
        quote.requiredFee - 1,
      ),
    ).toBeNull();
    expect(current.manager.save).not.toHaveBeenCalled();
    const agreement = (await current.service.createAiAgreement(
      current.manager as unknown as EntityManager,
      current.career,
      current.buyer,
      9,
      quote.requiredFee,
    ))!;
    expect(agreement).toMatchObject({
      status: TransferAgreementStatus.ACCEPTED,
      buyerCareerTeamId: 2,
      sellerCareerTeamId: 3,
      offeredFee: quote.requiredFee,
    });
    current.setExisting(agreement);
    expect(
      await current.service.createAiAgreement(
        current.manager as unknown as EntityManager,
        current.career,
        current.buyer,
        9,
        quote.requiredFee,
      ),
    ).toBeNull();
    expect(current.manager.save).toHaveBeenCalledTimes(1);
  });
});
