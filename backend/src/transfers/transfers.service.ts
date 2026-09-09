import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { CAREER_PLAYER_STATE_CONFIG } from '../careers/config/player-state.config';
import { MAX_BENCH_PLAYERS } from '../careers/constants/career.constants';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Career } from '../careers/entities/career.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import {
  ContractOfferStatus,
  ContractOfferType,
  PlayerContractStatus,
} from '../contracts/contract.types';
import { ContractOffer } from '../contracts/entities/contract-offer.entity';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import { Position } from '../players/enums/position.enum';
import { CreateTransferAgreementDto } from './dto/create-transfer-agreement.dto';
import { FindTransferMarketQueryDto } from './dto/find-transfer-market-query.dto';
import { TransferAgreement } from './entities/transfer-agreement.entity';
import { TransferRecord } from './entities/transfer-record.entity';
import {
  calculateRequiredTransferFee,
  validateTransferFee,
} from './transfer-policy';
import {
  TransferAgreementStatus,
  TransferMarketAvailability,
  TransferRecordType,
} from './transfer.types';

const OPEN_CONTRACT_STATUSES = [
  ContractOfferStatus.WAITING_PLAYER_RESPONSE,
  ContractOfferStatus.PLAYER_ACCEPTED,
  ContractOfferStatus.COUNTER_OFFERED,
  ContractOfferStatus.REJECTED,
];

export interface PreparedContractOffer {
  player: CareerPlayer;
  offerType: ContractOfferType;
  sourceCareerTeamId: number | null;
  transferAgreementId: number | null;
}

export interface TransferMarketCandidate {
  careerPlayerId: number;
  nickname: string;
  nationality: string;
  currentAge: number;
  position: Position;
  overall: number;
  availability: TransferMarketAvailability;
  currentTeam: { id: number; code: string; name: string } | null;
  rosterRole: RosterRole | null;
  currentContract: {
    annualSalary: number;
    endDate: string;
  } | null;
  requiredTransferFee: number;
  activeAgreementId: number | null;
  canNegotiate: boolean;
  blockedReason: string | null;
}

@Injectable()
export class TransfersService {
  constructor(private readonly dataSource: DataSource) {}

  async findMarket(
    accountId: number,
    careerId: number,
    query: FindTransferMarketQueryDto,
  ): Promise<TransferMarketCandidate[]> {
    const career = await this.assertOwnedCareer(
      this.dataSource.manager,
      accountId,
      careerId,
    );
    const managedTeam = await this.findManagedTeam(
      this.dataSource.manager,
      careerId,
    );
    const [players, activeContracts, agreements] = await Promise.all([
      this.dataSource.manager.find(CareerPlayer, {
        where: { careerId },
        relations: {
          currentTeam: true,
          roster: true,
          playerCard: { player: true },
        },
        order: { id: 'ASC' },
      }),
      this.dataSource.manager.findBy(PlayerContract, {
        careerId,
        status: PlayerContractStatus.ACTIVE,
      }),
      this.dataSource.manager.find(TransferAgreement, {
        where: {
          careerId,
          buyerCareerTeamId: managedTeam.id,
          status: TransferAgreementStatus.ACCEPTED,
        },
        order: { id: 'DESC' },
      }),
    ]);
    const contractsByPlayer = new Map(
      activeContracts.map((contract) => [contract.careerPlayerId, contract]),
    );
    const agreementsByPlayer = new Map<number, TransferAgreement>();
    for (const agreement of agreements) {
      if (!agreementsByPlayer.has(agreement.careerPlayerId))
        agreementsByPlayer.set(agreement.careerPlayerId, agreement);
    }
    const destinationBenchCount = players.filter(
      (player) =>
        player.currentTeamId === managedTeam.id &&
        player.roster?.role === RosterRole.BENCH,
    ).length;

    return players
      .filter((player) => player.currentTeamId !== managedTeam.id)
      .map((player) => {
        const availability =
          player.currentTeamId === null
            ? TransferMarketAvailability.FREE_AGENT
            : TransferMarketAvailability.CONTRACTED;
        const contract = contractsByPlayer.get(player.id) ?? null;
        const blockedReason = this.marketBlockedReason(
          player,
          contract,
          players,
          destinationBenchCount,
        );
        const requiredTransferFee =
          availability === TransferMarketAvailability.CONTRACTED &&
          player.roster
            ? this.requiredTransferFee(
                player,
                player.roster,
                contract,
                career.currentDate,
              )
            : 0;

        return {
          careerPlayerId: player.id,
          nickname: player.playerCard.player.nickname,
          nationality: player.playerCard.player.nationality,
          currentAge: player.currentAge,
          position: player.currentPosition,
          overall: this.playerAbility(player),
          availability,
          currentTeam: player.currentTeam
            ? {
                id: player.currentTeam.id,
                code: player.currentTeam.code,
                name: player.currentTeam.name,
              }
            : null,
          rosterRole: player.roster?.role ?? null,
          currentContract: contract
            ? {
                annualSalary: contract.terms.annualSalary,
                endDate: contract.endDate,
              }
            : null,
          requiredTransferFee,
          activeAgreementId: agreementsByPlayer.get(player.id)?.id ?? null,
          canNegotiate: blockedReason === null,
          blockedReason,
        };
      })
      .filter(
        (candidate) =>
          (!query.availability ||
            candidate.availability === query.availability) &&
          (!query.position || candidate.position === query.position),
      )
      .sort(
        (left, right) =>
          right.overall - left.overall ||
          left.nickname.localeCompare(right.nickname),
      );
  }

  async findAgreements(
    accountId: number,
    careerId: number,
  ): Promise<TransferAgreement[]> {
    await this.assertOwnedCareer(
      this.dataSource.manager,
      accountId,
      careerId,
    );
    const managedTeam = await this.findManagedTeam(
      this.dataSource.manager,
      careerId,
    );
    return this.dataSource.manager.find(TransferAgreement, {
      where: { careerId, buyerCareerTeamId: managedTeam.id },
      order: { id: 'DESC' },
    });
  }

  async findHistory(
    accountId: number,
    careerId: number,
  ): Promise<TransferRecord[]> {
    await this.assertOwnedCareer(
      this.dataSource.manager,
      accountId,
      careerId,
    );
    return this.dataSource.manager.find(TransferRecord, {
      where: { careerId },
      relations: {
        careerPlayer: { playerCard: { player: true } },
        sourceCareerTeam: true,
        destinationCareerTeam: true,
      },
      order: { completedDate: 'DESC', id: 'DESC' },
    });
  }

  async createAgreement(
    accountId: number,
    careerId: number,
    dto: CreateTransferAgreementDto,
  ): Promise<TransferAgreement> {
    validateTransferFee(dto.offeredFee);
    return this.dataSource.transaction(async (manager) => {
      const career = await this.assertOwnedCareer(
        manager,
        accountId,
        careerId,
        true,
      );
      const buyer = await this.findManagedTeam(manager, careerId);
      const player = await this.findCareerPlayer(
        manager,
        careerId,
        dto.careerPlayerId,
        true,
      );
      if (player.currentTeamId === null)
        throw new BadRequestException(
          'FA 선수는 구단 간 이적 합의 없이 계약을 제안할 수 있습니다.',
        );
      if (player.currentTeamId === buyer.id)
        throw new BadRequestException(
          '소속 구단 선수는 이적 합의가 아니라 재계약을 진행해 주세요.',
        );
      await this.lockTeams(manager, careerId, [buyer.id, player.currentTeamId]);
      const roster = await this.findPlayerRoster(manager, player.id, true);
      if (!roster || roster.careerTeamId !== player.currentTeamId)
        throw new ConflictException('선수의 현재 로스터 정보가 일치하지 않습니다.');
      await this.assertSourceCanReleaseStarter(manager, roster, true);
      await this.assertDestinationBenchSpace(manager, buyer.id);

      const existing = await manager.findOne(TransferAgreement, {
        where: {
          careerId,
          buyerCareerTeamId: buyer.id,
          careerPlayerId: player.id,
          status: TransferAgreementStatus.ACCEPTED,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing)
        throw new ConflictException(
          `이미 승인된 이적 합의 ${existing.id}가 있습니다.`,
        );

      const contract = await manager.findOneBy(PlayerContract, {
        careerId,
        careerPlayerId: player.id,
        status: PlayerContractStatus.ACTIVE,
      });
      const requiredFee = this.requiredTransferFee(
        player,
        roster,
        contract,
        career.currentDate,
      );
      const accepted = dto.offeredFee >= requiredFee;
      const agreement = manager.create(TransferAgreement, {
        careerId,
        buyerCareerTeamId: buyer.id,
        sellerCareerTeamId: player.currentTeamId,
        careerPlayerId: player.id,
        offeredFee: dto.offeredFee,
        requiredFee,
        status: accepted
          ? TransferAgreementStatus.ACCEPTED
          : TransferAgreementStatus.REJECTED,
        offeredDate: career.currentDate,
        resolvedDate: career.currentDate,
        reason: accepted
          ? '판매 구단이 이적료 제안을 수락했습니다.'
          : `판매 구단은 최소 ${requiredFee}만원을 요구합니다.`,
      });
      return manager.save(TransferAgreement, agreement);
    });
  }

  async releasePlayer(
    accountId: number,
    careerId: number,
    careerPlayerId: number,
  ): Promise<{
    careerPlayerId: number;
    currentTeamId: null;
    contractStatus: PlayerContractStatus | null;
    transferRecordId: number;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const career = await this.assertOwnedCareer(
        manager,
        accountId,
        careerId,
        true,
      );
      const team = await this.findManagedTeam(manager, careerId);
      const player = await this.findCareerPlayer(
        manager,
        careerId,
        careerPlayerId,
        true,
      );
      if (player.currentTeamId !== team.id)
        throw new ConflictException(
          '감독 소속 구단의 선수만 방출할 수 있습니다.',
        );
      const openOffer = await manager.findOne(ContractOffer, {
        where: {
          careerId,
          careerPlayerId,
          status: In(OPEN_CONTRACT_STATUSES),
        },
      });
      if (openOffer)
        throw new ConflictException(
          '진행 중인 계약 협상을 먼저 철회한 뒤 방출해 주세요.',
        );

      const roster = await this.findPlayerRoster(manager, player.id, true);
      if (!roster || roster.careerTeamId !== team.id)
        throw new ConflictException('선수의 현재 로스터 정보가 일치하지 않습니다.');
      const replacement = await this.assertSourceCanReleaseStarter(
        manager,
        roster,
        true,
      );
      const contract = await manager.findOne(PlayerContract, {
        where: { careerId, careerPlayerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (contract) {
        contract.status = PlayerContractStatus.TERMINATED;
        contract.endedDate = career.currentDate;
        contract.endReason = '구단 방출';
        await manager.save(PlayerContract, contract);
      }
      await this.detachFromTeam(manager, player, roster, replacement);
      const record = await this.createRecord(manager, {
        careerId,
        careerPlayerId,
        sourceCareerTeamId: team.id,
        destinationCareerTeamId: null,
        transferAgreementId: null,
        contractOfferId: null,
        type: TransferRecordType.RELEASE,
        transferFee: 0,
        completedDate: career.currentDate,
      });
      return {
        careerPlayerId,
        currentTeamId: null,
        contractStatus: contract?.status ?? null,
        transferRecordId: record.id,
      };
    });
  }

  async prepareContractOffer(
    manager: EntityManager,
    career: Career,
    destinationTeam: CareerTeam,
    careerPlayerId: number,
    transferAgreementId?: number,
  ): Promise<PreparedContractOffer> {
    const player = await this.findCareerPlayer(
      manager,
      career.id,
      careerPlayerId,
      true,
    );
    if (player.currentTeamId === destinationTeam.id) {
      if (transferAgreementId !== undefined)
        throw new BadRequestException(
          '재계약에는 이적 합의 ID를 사용할 수 없습니다.',
        );
      return {
        player,
        offerType: ContractOfferType.RENEWAL,
        sourceCareerTeamId: destinationTeam.id,
        transferAgreementId: null,
      };
    }
    await this.assertDestinationBenchSpace(manager, destinationTeam.id);
    if (player.currentTeamId === null) {
      if (transferAgreementId !== undefined)
        throw new BadRequestException(
          'FA 계약에는 이적 합의 ID를 사용할 수 없습니다.',
        );
      const roster = await this.findPlayerRoster(manager, player.id, true);
      const activeContract = await manager.findOneBy(PlayerContract, {
        careerId: career.id,
        careerPlayerId: player.id,
        status: PlayerContractStatus.ACTIVE,
      });
      if (roster || activeContract)
        throw new ConflictException('FA 선수의 소속 또는 계약 상태가 일치하지 않습니다.');
      return {
        player,
        offerType: ContractOfferType.FREE_AGENT,
        sourceCareerTeamId: null,
        transferAgreementId: null,
      };
    }
    if (transferAgreementId === undefined)
      throw new BadRequestException(
        '타 구단 선수에게 제안하려면 승인된 이적 합의 ID가 필요합니다.',
      );
    const agreement = await manager.findOne(TransferAgreement, {
      where: { id: transferAgreementId, careerId: career.id },
      lock: { mode: 'pessimistic_write' },
    });
    this.assertMatchingAgreement(agreement, destinationTeam, player);
    const roster = await this.findPlayerRoster(manager, player.id, true);
    if (!roster || roster.careerTeamId !== player.currentTeamId)
      throw new ConflictException('선수의 현재 로스터 정보가 일치하지 않습니다.');
    await this.assertSourceCanReleaseStarter(manager, roster, true);
    return {
      player,
      offerType: ContractOfferType.TRANSFER,
      sourceCareerTeamId: player.currentTeamId,
      transferAgreementId: agreement!.id,
    };
  }

  async assertContractOfferEligible(
    manager: EntityManager,
    offer: ContractOffer,
    destinationTeam: CareerTeam,
  ): Promise<CareerPlayer> {
    const player = await this.findCareerPlayer(
      manager,
      offer.careerId,
      offer.careerPlayerId,
      true,
    );
    if (offer.careerTeamId !== destinationTeam.id)
      throw new ConflictException('계약 제안 구단 정보가 일치하지 않습니다.');
    if (offer.offerType === ContractOfferType.RENEWAL) {
      if (
        player.currentTeamId !== destinationTeam.id ||
        offer.sourceCareerTeamId !== destinationTeam.id ||
        offer.transferAgreementId !== null
      )
        throw new ConflictException('재계약 대상 선수의 소속이 변경되었습니다.');
      return player;
    }
    await this.assertDestinationBenchSpace(manager, destinationTeam.id);
    if (offer.offerType === ContractOfferType.FREE_AGENT) {
      const [roster, activeContract] = await Promise.all([
        this.findPlayerRoster(manager, player.id, true),
        manager.findOneBy(PlayerContract, {
          careerId: offer.careerId,
          careerPlayerId: player.id,
          status: PlayerContractStatus.ACTIVE,
        }),
      ]);
      if (
        player.currentTeamId !== null ||
        offer.sourceCareerTeamId !== null ||
        offer.transferAgreementId !== null ||
        roster ||
        activeContract
      )
        throw new ConflictException('FA 선수의 상태가 협상 시작 이후 변경되었습니다.');
      return player;
    }
    if (offer.offerType !== ContractOfferType.TRANSFER)
      throw new ConflictException('알 수 없는 계약 제안 유형입니다.');
    if (
      player.currentTeamId === null ||
      player.currentTeamId !== offer.sourceCareerTeamId ||
      offer.transferAgreementId === null
    )
      throw new ConflictException('이적 대상 선수의 소속이 변경되었습니다.');
    const agreement = await manager.findOne(TransferAgreement, {
      where: { id: offer.transferAgreementId, careerId: offer.careerId },
      lock: { mode: 'pessimistic_write' },
    });
    this.assertMatchingAgreement(agreement, destinationTeam, player);
    const roster = await this.findPlayerRoster(manager, player.id, true);
    if (!roster || roster.careerTeamId !== player.currentTeamId)
      throw new ConflictException('선수의 현재 로스터 정보가 일치하지 않습니다.');
    await this.assertSourceCanReleaseStarter(manager, roster, true);
    return player;
  }

  async isContractOfferEligible(
    manager: EntityManager,
    offer: ContractOffer,
    destinationTeam: CareerTeam,
  ): Promise<boolean> {
    try {
      await this.assertContractOfferEligible(manager, offer, destinationTeam);
      return true;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      )
        return false;
      throw error;
    }
  }

  async completeAcquisition(
    manager: EntityManager,
    offer: ContractOffer,
    destinationTeam: CareerTeam,
    completedDate: string,
  ): Promise<TransferRecord | null> {
    if (offer.offerType === ContractOfferType.RENEWAL) return null;
    const player = await this.assertContractOfferEligible(
      manager,
      offer,
      destinationTeam,
    );
    const sourceTeamId = player.currentTeamId;
    let roster = await this.findPlayerRoster(manager, player.id, true);

    if (offer.offerType === ContractOfferType.TRANSFER) {
      if (!roster || sourceTeamId === null)
        throw new ConflictException('이동할 원소속 로스터를 찾을 수 없습니다.');
      const replacement = await this.assertSourceCanReleaseStarter(
        manager,
        roster,
        true,
      );
      if (roster.role === RosterRole.STARTER) {
        roster.role = RosterRole.BENCH;
        roster.starterPosition = null;
        roster.playerInstruction = null;
        roster.championArchetype = null;
        await manager.save(Roster, roster);
        await this.promoteReplacement(manager, replacement!, player.currentPosition);
      }
      roster.careerTeamId = destinationTeam.id;
      roster.careerTeam = destinationTeam;
      roster.role = RosterRole.BENCH;
      roster.starterPosition = null;
      roster.playerInstruction = null;
      roster.championArchetype = null;
      await manager.save(Roster, roster);
    } else {
      if (roster)
        throw new ConflictException('FA 선수에게 기존 로스터가 남아 있습니다.');
      roster = manager.create(Roster, {
        careerTeamId: destinationTeam.id,
        careerTeam: destinationTeam,
        careerPlayerId: player.id,
        careerPlayer: player,
        role: RosterRole.BENCH,
        starterPosition: null,
        playerInstruction: null,
        championArchetype: null,
      });
      await manager.save(Roster, roster);
    }

    player.currentTeamId = destinationTeam.id;
    player.currentTeam = destinationTeam;
    player.coachTrust = CAREER_PLAYER_STATE_CONFIG.initial.coachTrust;
    await manager.save(CareerPlayer, player);

    let agreement: TransferAgreement | null = null;
    if (offer.transferAgreementId !== null) {
      agreement = await manager.findOne(TransferAgreement, {
        where: { id: offer.transferAgreementId, careerId: offer.careerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!agreement)
        throw new ConflictException('이적 합의를 찾을 수 없습니다.');
      agreement.status = TransferAgreementStatus.COMPLETED;
      agreement.resolvedDate = completedDate;
      agreement.reason = '선수 계약이 확정되어 이적이 완료되었습니다.';
      await manager.save(TransferAgreement, agreement);
    }

    return this.createRecord(manager, {
      careerId: offer.careerId,
      careerPlayerId: player.id,
      sourceCareerTeamId: sourceTeamId,
      destinationCareerTeamId: destinationTeam.id,
      transferAgreementId: agreement?.id ?? null,
      contractOfferId: offer.id,
      type:
        offer.offerType === ContractOfferType.TRANSFER
          ? TransferRecordType.TRANSFER
          : TransferRecordType.FREE_AGENT_SIGNING,
      transferFee: agreement?.offeredFee ?? 0,
      completedDate,
    });
  }

  async expireContract(
    manager: EntityManager,
    contract: PlayerContract,
    effectiveDate: string,
  ): Promise<TransferRecord | null> {
    if (contract.status !== PlayerContractStatus.ACTIVE) return null;
    const player = await this.findCareerPlayer(
      manager,
      contract.careerId,
      contract.careerPlayerId,
      true,
    );
    contract.status = PlayerContractStatus.EXPIRED;
    contract.endedDate = effectiveDate;
    contract.endReason = '계약 기간 만료';
    await manager.save(PlayerContract, contract);
    if (player.currentTeamId !== contract.careerTeamId) return null;

    const roster = await this.findPlayerRoster(manager, player.id, true);
    let replacement: Roster | null = null;
    if (roster?.role === RosterRole.STARTER)
      replacement = await this.findStarterReplacement(manager, roster);
    await this.detachFromTeam(manager, player, roster, replacement);
    return this.createRecord(manager, {
      careerId: contract.careerId,
      careerPlayerId: player.id,
      sourceCareerTeamId: contract.careerTeamId,
      destinationCareerTeamId: null,
      transferAgreementId: null,
      contractOfferId: null,
      type: TransferRecordType.CONTRACT_EXPIRATION,
      transferFee: 0,
      completedDate: effectiveDate,
    });
  }

  private async detachFromTeam(
    manager: EntityManager,
    player: CareerPlayer,
    roster: Roster | null,
    replacement: Roster | null,
  ): Promise<void> {
    if (roster) await manager.delete(Roster, roster.id);
    if (replacement)
      await this.promoteReplacement(
        manager,
        replacement,
        player.currentPosition,
      );
    player.currentTeamId = null;
    player.currentTeam = null;
    player.coachTrust = CAREER_PLAYER_STATE_CONFIG.initial.coachTrust;
    await manager.save(CareerPlayer, player);
  }

  private async promoteReplacement(
    manager: EntityManager,
    replacement: Roster,
    position: Position,
  ): Promise<void> {
    replacement.role = RosterRole.STARTER;
    replacement.starterPosition = position;
    replacement.playerInstruction = null;
    replacement.championArchetype = null;
    await manager.save(Roster, replacement);
  }

  private async assertSourceCanReleaseStarter(
    manager: EntityManager,
    roster: Roster,
    requireReplacement: boolean,
  ): Promise<Roster | null> {
    if (roster.role !== RosterRole.STARTER) return null;
    const replacement = await this.findStarterReplacement(manager, roster);
    if (!replacement && requireReplacement)
      throw new ConflictException(
        '원소속 팀에 같은 포지션 후보가 없어 주전 선수를 이동할 수 없습니다.',
      );
    return replacement;
  }

  private async findStarterReplacement(
    manager: EntityManager,
    roster: Roster,
  ): Promise<Roster | null> {
    if (roster.starterPosition === null) return null;
    const candidates = await manager.find(Roster, {
      where: {
        careerTeamId: roster.careerTeamId,
        role: RosterRole.BENCH,
      },
      relations: { careerPlayer: true },
      lock: { mode: 'pessimistic_write' },
    });
    return (
      candidates
        .filter(
          (candidate) =>
            candidate.careerPlayerId !== roster.careerPlayerId &&
            candidate.careerPlayer.currentPosition === roster.starterPosition,
        )
        .sort(
          (left, right) =>
            this.playerAbility(right.careerPlayer) -
              this.playerAbility(left.careerPlayer) || left.id - right.id,
        )[0] ?? null
    );
  }

  private async assertDestinationBenchSpace(
    manager: EntityManager,
    teamId: number,
  ): Promise<void> {
    const count = await manager.countBy(Roster, {
      careerTeamId: teamId,
      role: RosterRole.BENCH,
    });
    if (count >= MAX_BENCH_PLAYERS)
      throw new ConflictException(
        `후보는 최대 ${MAX_BENCH_PLAYERS}명입니다. 영입 전에 자리를 비워 주세요.`,
      );
  }

  private assertMatchingAgreement(
    agreement: TransferAgreement | null,
    destinationTeam: CareerTeam,
    player: CareerPlayer,
  ): void {
    if (!agreement)
      throw new NotFoundException('승인된 이적 합의를 찾을 수 없습니다.');
    if (
      agreement.status !== TransferAgreementStatus.ACCEPTED ||
      agreement.buyerCareerTeamId !== destinationTeam.id ||
      agreement.careerPlayerId !== player.id ||
      agreement.sellerCareerTeamId !== player.currentTeamId
    )
      throw new ConflictException(
        '이적 합의가 현재 선수 및 구단 상태와 일치하지 않습니다.',
      );
  }

  private marketBlockedReason(
    player: CareerPlayer,
    contract: PlayerContract | null,
    allPlayers: CareerPlayer[],
    destinationBenchCount: number,
  ): string | null {
    if (destinationBenchCount >= MAX_BENCH_PLAYERS)
      return `감독 소속 구단 후보가 ${MAX_BENCH_PLAYERS}명으로 가득 찼습니다.`;
    if (player.currentTeamId === null) {
      if (player.roster || contract)
        return 'FA 선수의 소속 또는 계약 데이터가 일치하지 않습니다.';
      return null;
    }
    if (!player.roster || player.roster.careerTeamId !== player.currentTeamId)
      return '선수의 현재 로스터 정보가 일치하지 않습니다.';
    if (player.roster.role !== RosterRole.STARTER) return null;
    const hasReplacement = allPlayers.some(
      (candidate) =>
        candidate.id !== player.id &&
        candidate.currentTeamId === player.currentTeamId &&
        candidate.currentPosition === player.currentPosition &&
        candidate.roster?.role === RosterRole.BENCH,
    );
    return hasReplacement
      ? null
      : '원소속 팀에 같은 포지션 후보가 없어 현재는 이적할 수 없습니다.';
  }

  private requiredTransferFee(
    player: CareerPlayer,
    roster: Roster,
    contract: PlayerContract | null,
    currentDate: string,
  ): number {
    return calculateRequiredTransferFee({
      ability: this.playerAbility(player),
      currentAge: player.currentAge,
      rosterRole: roster.role,
      remainingContractDays: contract
        ? Math.max(0, dateDaysBetween(currentDate, contract.endDate))
        : 0,
    });
  }

  private playerAbility(player: CareerPlayer): number {
    return Math.round(
      (player.currentMechanics +
        player.currentGameSense +
        player.currentLaning +
        player.currentTeamFight +
        player.currentMacro +
        player.currentTeamPlay +
        player.currentMental +
        player.currentChampionPool) /
        8,
    );
  }

  private async findCareerPlayer(
    manager: EntityManager,
    careerId: number,
    playerId: number,
    lock: boolean,
  ): Promise<CareerPlayer> {
    const player = await manager.findOne(CareerPlayer, {
      where: { id: playerId, careerId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!player)
      throw new NotFoundException(`CareerPlayer ${playerId} was not found`);
    return player;
  }

  private async findPlayerRoster(
    manager: EntityManager,
    playerId: number,
    lock: boolean,
  ): Promise<Roster | null> {
    return manager.findOne(Roster, {
      where: { careerPlayerId: playerId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  private async lockTeams(
    manager: EntityManager,
    careerId: number,
    teamIds: number[],
  ): Promise<void> {
    const uniqueIds = [...new Set(teamIds)].sort((left, right) => left - right);
    const teams = await manager.find(CareerTeam, {
      where: { careerId, id: In(uniqueIds) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    if (teams.length !== uniqueIds.length)
      throw new NotFoundException('커리어 구단 정보를 찾을 수 없습니다.');
  }

  private async createRecord(
    manager: EntityManager,
    data: Pick<
      TransferRecord,
      | 'careerId'
      | 'careerPlayerId'
      | 'sourceCareerTeamId'
      | 'destinationCareerTeamId'
      | 'transferAgreementId'
      | 'contractOfferId'
      | 'type'
      | 'transferFee'
      | 'completedDate'
    >,
  ): Promise<TransferRecord> {
    return manager.save(TransferRecord, manager.create(TransferRecord, data));
  }

  private async assertOwnedCareer(
    manager: EntityManager,
    accountId: number,
    careerId: number,
    lock = false,
  ): Promise<Career> {
    const career = await manager.findOne(Career, {
      where: { id: careerId, accountId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!career)
      throw new NotFoundException(`Career ${careerId} was not found`);
    return career;
  }

  private async findManagedTeam(
    manager: EntityManager,
    careerId: number,
  ): Promise<CareerTeam> {
    const team = await manager.findOneBy(CareerTeam, {
      careerId,
      isUserControlled: true,
    });
    if (!team)
      throw new NotFoundException('감독 소속 구단을 찾을 수 없습니다.');
    return team;
  }
}

function dateDaysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
