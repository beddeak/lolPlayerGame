import { assertManagerActive } from '../manager-career/manager-access';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Between, DataSource, EntityManager, In, LessThan } from 'typeorm';
import {
  assertTransferWindow,
  getTransferWindow,
} from '../transfers/transfer-window';
import { TransferAgreement } from '../transfers/entities/transfer-agreement.entity';
import { TransferAgreementStatus } from '../transfers/transfer.types';
import { addCalendarDays } from '../calendars/calendar-date';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { CONTRACT_CONFIG } from './config/contract.config';
import {
  evaluateContractOffer,
  getResponseDelayDays,
  validateContractTerms,
} from './contract-policy';
import {
  ContractDecisionAction,
  ContractOfferStatus,
  ContractOfferType,
  type ContractTerms,
  PlayerContractStatus,
} from './contract.types';
import { CreateContractOfferDto } from './dto/create-contract-offer.dto';
import { RespondContractOfferDto } from './dto/respond-contract-offer.dto';
import type { ContractOfferResponseDto } from './dto/contract-offer-response.dto';
import { ContractOffer } from './entities/contract-offer.entity';
import { PlayerContract } from './entities/player-contract.entity';
import { TransfersService } from '../transfers/transfers.service';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { MAX_BENCH_PLAYERS } from '../careers/constants/career.constants';
import { LegendEventPlayer } from '../legends/entities/legend-event-player.entity';
import { AiClubBudgetService } from '../ai-clubs/ai-club-budget.service';

const OPEN_STATUSES = [
  ContractOfferStatus.WAITING_PLAYER_RESPONSE,
  ContractOfferStatus.PLAYER_ACCEPTED,
  ContractOfferStatus.COUNTER_OFFERED,
  ContractOfferStatus.REJECTED,
];

@Injectable()
export class ContractsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transfersService: TransfersService,
    private readonly aiBudget: AiClubBudgetService,
  ) {}

  async findContracts(
    accountId: number,
    careerId: number,
  ): Promise<PlayerContract[]> {
    await this.assertOwnedCareer(this.dataSource.manager, accountId, careerId);
    return this.dataSource.manager.find(PlayerContract, {
      where: { careerId, status: PlayerContractStatus.ACTIVE },
      order: { id: 'ASC' },
    });
  }

  async findOffers(
    accountId: number,
    careerId: number,
  ): Promise<ContractOfferResponseDto[]> {
    await this.assertOwnedCareer(this.dataSource.manager, accountId, careerId);
    const team = await this.findManagedTeam(this.dataSource.manager, careerId);
    const offers = await this.dataSource.manager.find(ContractOffer, {
      where: { careerId, careerTeamId: team.id },
      relations: { careerPlayer: { playerCard: { player: true } } },
      order: { id: 'DESC' },
    });
    return offers.map(({ careerPlayer, ...offer }) => ({
      ...offer,
      player: {
        nickname: careerPlayer.playerCard.player.nickname,
        currentPosition: careerPlayer.currentPosition,
        currentAge: careerPlayer.currentAge,
      },
    }));
  }

  async createOffer(
    accountId: number,
    careerId: number,
    dto: CreateContractOfferDto,
  ): Promise<ContractOffer> {
    validateContractTerms(dto.terms);
    return this.dataSource.transaction(async (manager) => {
      const career = await this.assertOwnedCareer(
        manager,
        accountId,
        careerId,
        true,
      );
      const team = await this.findManagedTeam(manager, careerId);
      const prepared = await this.transfersService.prepareContractOffer(
        manager,
        career,
        team,
        dto.careerPlayerId,
        dto.transferAgreementId,
      );
      const openOffer = await manager.findOne(ContractOffer, {
        where: {
          careerId,
          careerTeamId: team.id,
          careerPlayerId: dto.careerPlayerId,
          status: In(OPEN_STATUSES),
        },
      });
      if (openOffer) {
        throw new ConflictException(
          '이미 진행 중인 계약 협상이 있습니다. 기존 제안을 처리해 주세요.',
        );
      }
      const offer = manager.create(ContractOffer, {
        careerId,
        careerTeamId: team.id,
        careerPlayerId: dto.careerPlayerId,
        offerType: prepared.offerType,
        sourceCareerTeamId: prepared.sourceCareerTeamId,
        transferAgreementId: prepared.transferAgreementId,
        status: ContractOfferStatus.WAITING_PLAYER_RESPONSE,
        revision: 1,
        offeredDate: career.currentDate,
        responseDate: career.currentDate,
        responseEventId: null,
        terms: structuredClone(dto.terms),
        counterTerms: null,
        response: null,
        extensionsUsed: 0,
        history: [
          {
            action: 'OFFER',
            date: career.currentDate,
            revision: 1,
            terms: structuredClone(dto.terms),
          },
        ],
      });
      await manager.save(ContractOffer, offer);
      await this.scheduleResponse(manager, offer, career.currentDate);
      return manager.save(ContractOffer, offer);
    });
  }

  /** Creates a delayed, non-blocking AI negotiation inside the calendar transaction. */
  async createAiOffer(
    manager: EntityManager,
    career: Career,
    teamId: number,
    careerPlayerId: number,
    terms: ContractTerms,
  ): Promise<ContractOffer | null> {
    validateContractTerms(terms);
    contractEndDate(career.currentDate, terms.years);
    const team = await manager.findOne(CareerTeam, {
      where: { id: teamId, careerId: career.id, isUserControlled: false },
      lock: { mode: 'pessimistic_write' },
    });
    const player = await manager.findOne(CareerPlayer, {
      where: { id: careerPlayerId, careerId: career.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!team || team.isUserControlled || !player) return null;
    const renewal = player.currentTeamId === team.id;
    if (!renewal && !getTransferWindow(career.currentDate).isOpen) return null;
    if (
      renewal &&
      (await this.hasAcceptedAiSale(manager, career, team.id, player.id))
    )
      return null;
    if (
      await manager.findOne(ContractOffer, {
        where: {
          careerId: career.id,
          careerTeamId: team.id,
          careerPlayerId,
          status: In(OPEN_STATUSES),
        },
        lock: { mode: 'pessimistic_write' },
      })
    )
      return null;
    if (!renewal) {
      if (
        (await manager.countBy(Roster, {
          careerTeamId: team.id,
          role: RosterRole.BENCH,
        })) >= MAX_BENCH_PLAYERS
      )
        return null;
      if (player.currentTeamId === null) {
        const legend = await manager.findOneBy(LegendEventPlayer, {
          careerId: career.id,
          careerPlayerId,
        });
        if (
          legend &&
          (legend.aiProcessedDate === null ||
            legend.aiProcessedDate >= career.currentDate)
        )
          return null;
      }
    }

    const candidate = manager.create(ContractOffer, {
      careerId: career.id,
      careerTeamId: team.id,
      careerPlayerId,
      offerType: renewal
        ? ContractOfferType.RENEWAL
        : player.currentTeamId === null
          ? ContractOfferType.FREE_AGENT
          : ContractOfferType.TRANSFER,
      sourceCareerTeamId: player.currentTeamId,
      transferAgreementId: null,
    });
    let transferFee = 0;
    if (candidate.offerType === ContractOfferType.TRANSFER) {
      const quote = await this.transfersService.quoteAiTransfer(
        manager,
        career,
        team,
        careerPlayerId,
      );
      if (!quote) return null;
      transferFee = quote.requiredFee;
    } else if (
      !(await this.transfersService.isContractOfferEligible(
        manager,
        candidate,
        team,
      ))
    ) {
      return null;
    }
    if (
      !(await this.aiBudget.canAfford(
        manager,
        career,
        team.id,
        player.id,
        terms.annualSalary,
        transferFee,
      ))
    )
      return null;
    if (candidate.offerType === ContractOfferType.TRANSFER) {
      const agreement = await this.transfersService.createAiAgreement(
        manager,
        career,
        team,
        player.id,
        transferFee,
      );
      if (!agreement) return null;
      candidate.transferAgreementId = agreement.id;
    }
    Object.assign(candidate, {
      status: ContractOfferStatus.WAITING_PLAYER_RESPONSE,
      revision: 1,
      offeredDate: career.currentDate,
      responseDate: career.currentDate,
      responseEventId: null,
      terms: structuredClone(terms),
      counterTerms: null,
      response: null,
      extensionsUsed: 0,
      history: [
        {
          action: 'AI_OFFER',
          date: career.currentDate,
          revision: 1,
          terms: structuredClone(terms),
        },
      ],
    });
    // After the first agreement/offer write, unexpected errors must roll back the caller transaction.
    await manager.save(ContractOffer, candidate);
    await this.scheduleResponse(manager, candidate, career.currentDate, false);
    return manager.save(ContractOffer, candidate);
  }

  async respond(
    accountId: number,
    careerId: number,
    offerId: number,
    dto: RespondContractOfferDto,
  ): Promise<ContractOffer> {
    if (dto.action === ContractDecisionAction.COUNTER) {
      if (!dto.terms)
        throw new BadRequestException('재협상할 계약 조건을 입력해 주세요.');
      validateContractTerms(dto.terms);
    } else if (dto.terms !== undefined) {
      throw new BadRequestException(
        '계약 조건은 재협상할 때만 변경할 수 있습니다.',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const career = await this.assertOwnedCareer(
        manager,
        accountId,
        careerId,
        true,
      );
      const offer = await manager.findOne(ContractOffer, {
        where: { id: offerId, careerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!offer)
        throw new NotFoundException(`ContractOffer ${offerId} was not found`);
      const team = await this.findManagedTeam(manager, careerId);
      if (offer.careerTeamId !== team.id)
        throw new ConflictException(
          '감독 소속 구단의 계약만 처리할 수 있습니다.',
        );
      if (!OPEN_STATUSES.includes(offer.status))
        throw new ConflictException('이미 종료된 계약 협상입니다.');

      const event = offer.responseEventId
        ? await manager.findOne(CalendarEvent, {
            where: { id: offer.responseEventId, careerId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (
        !event ||
        event.payload?.contractOfferId !== offer.id ||
        event.payload?.revision !== offer.revision
      ) {
        throw new ConflictException('계약 응답 일정이 일치하지 않습니다.');
      }
      if (dto.action === ContractDecisionAction.WITHDRAW) {
        offer.status = ContractOfferStatus.WITHDRAWN;
        this.recordDecision(offer, dto.action, career.currentDate);
        await this.completeEvent(manager, event);
        return manager.save(ContractOffer, offer);
      }
      if (
        event.status !== CalendarEventStatus.READY ||
        event.scheduledDate > career.currentDate ||
        offer.status === ContractOfferStatus.WAITING_PLAYER_RESPONSE
      ) {
        throw new ConflictException('선수의 답변 날짜까지 기다려 주세요.');
      }
      await this.transfersService.assertContractOfferEligible(
        manager,
        offer,
        team,
      );
      if (offer.offerType !== ContractOfferType.RENEWAL) {
        assertTransferWindow(career.currentDate, offer.offeredDate);
      }

      if (dto.action === ContractDecisionAction.ACCEPT) {
        if (
          offer.status !== ContractOfferStatus.PLAYER_ACCEPTED &&
          offer.status !== ContractOfferStatus.COUNTER_OFFERED
        ) {
          throw new ConflictException(
            '선수가 수락하거나 역제안한 조건만 확정할 수 있습니다.',
          );
        }
        const signedTerms =
          offer.status === ContractOfferStatus.COUNTER_OFFERED
            ? offer.counterTerms
            : offer.terms;
        if (!signedTerms)
          throw new ConflictException('확정할 계약 조건이 없습니다.');
        validateContractTerms(signedTerms);
        await this.signContract(manager, career, offer, signedTerms);
        offer.terms = structuredClone(signedTerms);
        offer.status = ContractOfferStatus.SIGNED;
        this.recordDecision(offer, dto.action, career.currentDate);
        await this.completeEvent(manager, event);
      } else if (dto.action === ContractDecisionAction.REQUEST_TIME) {
        if (offer.status === ContractOfferStatus.REJECTED)
          throw new ConflictException(
            '거절된 제안은 재협상하거나 철회해 주세요.',
          );
        if (offer.extensionsUsed >= CONTRACT_CONFIG.maxDecisionExtensions)
          throw new ConflictException('답변 시간 연장은 이미 사용했습니다.');
        offer.extensionsUsed += 1;
        offer.responseDate = addCalendarDays(
          career.currentDate,
          CONTRACT_CONFIG.decisionExtensionDays,
        );
        event.scheduledDate = offer.responseDate;
        event.status = CalendarEventStatus.SCHEDULED;
        event.completedAt = null;
        this.recordDecision(offer, dto.action, career.currentDate);
        await manager.save(CalendarEvent, event);
      } else if (
        dto.action === ContractDecisionAction.COUNTER ||
        dto.action === ContractDecisionAction.KEEP
      ) {
        if (
          dto.action === ContractDecisionAction.KEEP &&
          offer.status === ContractOfferStatus.REJECTED
        )
          throw new ConflictException(
            '거절된 조건은 수정해서 다시 제안해 주세요.',
          );
        if (offer.revision >= CONTRACT_CONFIG.maxNegotiationRounds)
          throw new ConflictException(
            '재협상 횟수를 모두 사용했습니다. 제안을 확정하거나 철회해 주세요.',
          );
        await this.completeEvent(manager, event);
        offer.revision += 1;
        if (dto.terms) offer.terms = structuredClone(dto.terms);
        offer.status = ContractOfferStatus.WAITING_PLAYER_RESPONSE;
        offer.counterTerms = null;
        offer.response = null;
        this.recordDecision(offer, dto.action, career.currentDate);
        await this.scheduleResponse(manager, offer, career.currentDate);
      } else {
        throw new BadRequestException('지원하지 않는 계약 결정입니다.');
      }
      return manager.save(ContractOffer, offer);
    });
  }

  // Called inside the calendar's existing transaction. Reads never advance negotiations.
  async closeExpiredTransferNegotiations(
    manager: EntityManager,
    careerId: number,
    date: string,
  ): Promise<void> {
    const window = getTransferWindow(date);
    const cutoff = window.isOpen ? window.opensAt : addCalendarDays(date, 1);
    const offers = await manager.find(ContractOffer, {
      where: {
        careerId,
        offerType: In([
          ContractOfferType.FREE_AGENT,
          ContractOfferType.TRANSFER,
        ]),
        status: In(OPEN_STATUSES),
        offeredDate: LessThan(cutoff),
      },
      lock: { mode: 'pessimistic_write' },
    });
    for (const offer of offers) {
      offer.status = ContractOfferStatus.WITHDRAWN;
      this.recordDecision(offer, 'TRANSFER_WINDOW_CLOSED', date);
      if (offer.responseEventId) {
        const event = await manager.findOne(CalendarEvent, {
          where: { id: offer.responseEventId, careerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (event) {
          event.requiresUserAction = false;
          await this.completeEvent(manager, event);
        }
      }
      await manager.save(ContractOffer, offer);
    }
    await manager.update(
      TransferAgreement,
      {
        careerId,
        status: TransferAgreementStatus.ACCEPTED,
        offeredDate: LessThan(cutoff),
      },
      {
        status: TransferAgreementStatus.CANCELLED,
        resolvedDate: date,
        reason: '이적시장 종료로 합의가 만료되었습니다.',
      },
    );
  }

  async areAcquisitionResponseEvents(
    manager: EntityManager,
    careerId: number,
    eventIds: number[],
  ): Promise<boolean> {
    if (eventIds.length === 0) return false;
    const offers = await manager.find(ContractOffer, {
      where: {
        careerId,
        responseEventId: In(eventIds),
        offerType: In([
          ContractOfferType.FREE_AGENT,
          ContractOfferType.TRANSFER,
        ]),
        status: In(OPEN_STATUSES),
      },
    });
    const coveredEventIds = new Set(
      offers.map((offer) => offer.responseEventId),
    );
    return eventIds.every((eventId) => coveredEventIds.has(eventId));
  }

  async processResponseEvent(
    manager: EntityManager,
    event: CalendarEvent,
    date: string,
  ): Promise<void> {
    const offerId = event.payload?.contractOfferId;
    if (typeof offerId !== 'number' || !Number.isInteger(offerId)) return;
    const offer = await manager.findOne(ContractOffer, {
      where: { id: offerId, careerId: event.careerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !offer ||
      offer.responseEventId !== event.id ||
      offer.revision !== event.payload?.revision ||
      !OPEN_STATUSES.includes(offer.status)
    ) {
      event.requiresUserAction = false;
      return;
    }
    const player = await manager.findOneBy(CareerPlayer, {
      id: offer.careerPlayerId,
      careerId: offer.careerId,
    });
    const team = await manager.findOneBy(CareerTeam, {
      id: offer.careerTeamId,
      careerId: offer.careerId,
    });
    const eligible =
      player &&
      team &&
      (await this.transfersService.isContractOfferEligible(
        manager,
        offer,
        team,
      ));
    if (!eligible) {
      offer.status = ContractOfferStatus.WITHDRAWN;
      event.requiresUserAction = false;
      if (team && !team.isUserControlled)
        await this.cancelAiAgreement(manager, offer, date);
      await manager.save(ContractOffer, offer);
      return;
    }
    if (!team.isUserControlled) {
      await this.processAiResponse(manager, event, offer, team, player, date);
      return;
    }
    if (offer.status !== ContractOfferStatus.WAITING_PLAYER_RESPONSE) {
      // Retain a postponed response only while its player and club are still eligible.
      event.requiresUserAction = true;
      return;
    }
    const teammates = await manager.findBy(CareerPlayer, {
      careerId: offer.careerId,
      currentTeamId: team.id,
    });
    const contract = await manager.findOneBy(PlayerContract, {
      careerPlayerId: player.id,
      careerId: offer.careerId,
    });
    const result = evaluateContractOffer(offer.terms, {
      ability: this.playerAbility(player),
      teamStrength:
        teammates.reduce(
          (total, member) => total + this.playerAbility(member),
          0,
        ) / Math.max(teammates.length, 1),
      coachTrust:
        offer.offerType === ContractOfferType.RENEWAL
          ? player.coachTrust
          : CONTRACT_CONFIG.negotiation.trustNeutral,
      personality: player.personality,
      currentAnnualSalary:
        contract?.status === PlayerContractStatus.ACTIVE
          ? contract.terms.annualSalary
          : null,
    });
    offer.status =
      result.kind === 'ACCEPTED'
        ? ContractOfferStatus.PLAYER_ACCEPTED
        : result.kind === 'COUNTER_OFFER'
          ? ContractOfferStatus.COUNTER_OFFERED
          : ContractOfferStatus.REJECTED;
    offer.counterTerms = result.counterTerms;
    offer.response = {
      kind: result.kind,
      reason: result.reason,
      evaluatedDate: date,
    };
    event.requiresUserAction = true;
    event.payload = {
      ...event.payload,
      responseKind: result.kind,
      reason: result.reason,
    };
    this.recordDecision(offer, `PLAYER_${result.kind}`, date);
    await manager.save(ContractOffer, offer);
  }

  private async processAiResponse(
    manager: EntityManager,
    event: CalendarEvent,
    offer: ContractOffer,
    team: CareerTeam,
    player: CareerPlayer,
    date: string,
  ): Promise<void> {
    event.requiresUserAction = false;
    const savedCareer = await manager.findOneBy(Career, { id: offer.careerId });
    if (!savedCareer)
      throw new NotFoundException(`Career ${offer.careerId} was not found`);
    const career = {
      ...savedCareer,
      currentDate: date,
      currentYear: Number(date.slice(0, 4)),
    };
    const window = getTransferWindow(date);
    if (
      offer.status !== ContractOfferStatus.WAITING_PLAYER_RESPONSE ||
      (offer.offerType === ContractOfferType.RENEWAL &&
        (await this.hasAcceptedAiSale(manager, career, team.id, player.id))) ||
      (offer.offerType !== ContractOfferType.RENEWAL &&
        (!window.isOpen ||
          offer.offeredDate < window.opensAt ||
          offer.offeredDate > date)) ||
      (offer.offerType !== ContractOfferType.RENEWAL &&
        (await manager.countBy(Roster, {
          careerTeamId: team.id,
          role: RosterRole.BENCH,
        })) >= MAX_BENCH_PLAYERS)
    ) {
      offer.status = ContractOfferStatus.WITHDRAWN;
      this.recordDecision(offer, 'AI_NEGOTIATION_INVALIDATED', date);
      await this.cancelAiAgreement(manager, offer, date);
      await manager.save(ContractOffer, offer);
      return;
    }
    const teammates = await manager.findBy(CareerPlayer, {
      careerId: offer.careerId,
      currentTeamId: team.id,
    });
    const contract = await manager.findOneBy(PlayerContract, {
      careerId: offer.careerId,
      careerPlayerId: player.id,
    });
    const result = evaluateContractOffer(offer.terms, {
      ability: this.playerAbility(player),
      teamStrength:
        teammates.reduce(
          (total, member) => total + this.playerAbility(member),
          0,
        ) / Math.max(teammates.length, 1),
      coachTrust:
        offer.offerType === ContractOfferType.RENEWAL
          ? player.coachTrust
          : CONTRACT_CONFIG.negotiation.trustNeutral,
      personality: player.personality,
      currentAnnualSalary:
        contract?.status === PlayerContractStatus.ACTIVE
          ? contract.terms.annualSalary
          : null,
    });
    offer.response = {
      kind: result.kind,
      reason: result.reason,
      evaluatedDate: date,
    };
    offer.counterTerms = result.counterTerms;
    this.recordDecision(offer, `PLAYER_${result.kind}`, date);
    const agreement =
      offer.transferAgreementId === null
        ? null
        : await manager.findOneBy(TransferAgreement, {
            id: offer.transferAgreementId,
            careerId: offer.careerId,
          });
    const fee = agreement?.offeredFee ?? 0;
    if (
      result.kind !== 'ACCEPTED' ||
      !(await this.aiBudget.canAfford(
        manager,
        career,
        team.id,
        player.id,
        offer.terms.annualSalary,
        fee,
        offer.id,
      ))
    ) {
      // REJECTED is reopenable for users; AI uses WITHDRAWN as its terminal state.
      offer.status = ContractOfferStatus.WITHDRAWN;
      this.recordDecision(
        offer,
        result.kind === 'ACCEPTED'
          ? 'AI_BUDGET_DECLINED'
          : 'AI_NEGOTIATION_ENDED',
        date,
      );
      await this.cancelAiAgreement(manager, offer, date);
      await manager.save(ContractOffer, offer);
      return;
    }
    await this.signContract(manager, career, offer, offer.terms);
    offer.status = ContractOfferStatus.SIGNED;
    this.recordDecision(offer, 'AI_SIGNED', date);
    await this.aiBudget.recordTransferFee(manager, career, team.id, fee);
    await manager.save(ContractOffer, offer);
    const signedPlayer = await manager.findOne(CareerPlayer, {
      where: { id: player.id, careerId: career.id },
      relations: { playerCard: { player: true } },
    });
    const nickname =
      signedPlayer?.playerCard?.player?.nickname ?? `선수 #${player.id}`;
    event.type = CalendarEventType.AI_CLUB_UPDATE;
    event.payload = {
      ...event.payload,
      kind: 'AI_CONTRACT_SIGNED',
      careerTeamId: team.id,
      careerPlayerId: player.id,
      offerType: offer.offerType,
      transferFee: fee,
      message: `${team.name} 구단이 ${nickname} 선수와 ${offer.offerType === ContractOfferType.RENEWAL ? '재계약' : '계약'}했습니다.`,
    };
  }

  private async cancelAiAgreement(
    manager: EntityManager,
    offer: ContractOffer,
    date: string,
  ): Promise<void> {
    if (offer.transferAgreementId === null) return;
    await manager.update(
      TransferAgreement,
      {
        id: offer.transferAgreementId,
        careerId: offer.careerId,
        buyerCareerTeamId: offer.careerTeamId,
        status: TransferAgreementStatus.ACCEPTED,
      },
      {
        status: TransferAgreementStatus.CANCELLED,
        resolvedDate: date,
        reason: '선수 계약 협상이 종료되어 이적 합의가 취소되었습니다.',
      },
    );
  }

  /** EASY renewals must not overturn a sale that this AI seller already accepted. */
  private async hasAcceptedAiSale(
    manager: EntityManager,
    career: Career,
    teamId: number,
    careerPlayerId: number,
  ): Promise<boolean> {
    const window = getTransferWindow(career.currentDate);
    if (!window.isOpen) return false;
    const agreement = await manager.findOne(TransferAgreement, {
      where: {
        careerId: career.id,
        sellerCareerTeamId: teamId,
        careerPlayerId,
        status: TransferAgreementStatus.ACCEPTED,
        offeredDate: Between(window.opensAt, career.currentDate),
      },
      lock: { mode: 'pessimistic_write' },
    });
    return agreement !== null;
  }

  /** Only Legend Event entrants participate in this Phase 22 AI acquisition path. */
  async signLegendFreeAgentForAi(
    manager: EntityManager,
    career: Career,
    teamId: number,
    careerPlayerId: number,
    terms: ContractTerms,
  ): Promise<boolean> {
    validateContractTerms(terms);
    if (!getTransferWindow(career.currentDate).isOpen) return false;
    const entrant = await manager.findOneBy(LegendEventPlayer, {
      careerId: career.id,
      careerPlayerId,
    });
    if (!entrant) return false;
    const team = await manager.findOne(CareerTeam, {
      where: { id: teamId, careerId: career.id, isUserControlled: false },
      lock: { mode: 'pessimistic_write' },
    });
    const player = await manager.findOne(CareerPlayer, {
      where: { id: careerPlayerId, careerId: career.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!team || !player || player.currentTeamId !== null) return false;
    const candidate = manager.create(ContractOffer, {
      careerId: career.id,
      careerTeamId: team.id,
      careerPlayerId: player.id,
      offerType: ContractOfferType.FREE_AGENT,
      sourceCareerTeamId: null,
      transferAgreementId: null,
    });
    if (
      !(await this.transfersService.isContractOfferEligible(
        manager,
        candidate,
        team,
      )) ||
      (await manager.countBy(Roster, {
        careerTeamId: team.id,
        role: RosterRole.BENCH,
      })) >= MAX_BENCH_PLAYERS
    )
      return false;

    const teammates = await manager.findBy(CareerPlayer, {
      careerId: career.id,
      currentTeamId: team.id,
    });
    const result = evaluateContractOffer(terms, {
      ability: this.playerAbility(player),
      teamStrength:
        teammates.reduce(
          (total, member) => total + this.playerAbility(member),
          0,
        ) / Math.max(teammates.length, 1),
      coachTrust: CONTRACT_CONFIG.negotiation.trustNeutral,
      personality: player.personality,
      currentAnnualSalary: null,
    });
    if (result.kind !== 'ACCEPTED') return false;
    if (
      !(await this.aiBudget.canAfford(
        manager,
        career,
        team.id,
        player.id,
        terms.annualSalary,
        0,
      ))
    )
      return false;

    Object.assign(candidate, {
      status: ContractOfferStatus.SIGNED,
      revision: 1,
      offeredDate: career.currentDate,
      responseDate: career.currentDate,
      responseEventId: null,
      terms: structuredClone(terms),
      counterTerms: null,
      response: {
        kind: result.kind,
        reason: result.reason,
        evaluatedDate: career.currentDate,
      },
      extensionsUsed: 0,
      history: [
        {
          action: 'LEGEND_AI_SIGNING',
          date: career.currentDate,
          revision: 1,
          terms: structuredClone(terms),
        },
      ],
    });
    await manager.save(ContractOffer, candidate);
    await this.signContract(manager, career, candidate, terms);
    await this.aiBudget.recordTransferFee(manager, career, team.id, 0);
    return true;
  }

  private async cancelCompetingOffers(
    manager: EntityManager,
    signedOffer: ContractOffer,
    date: string,
  ): Promise<void> {
    const supersededOffers = await manager.find(ContractOffer, {
      where: {
        careerId: signedOffer.careerId,
        careerPlayerId: signedOffer.careerPlayerId,
        status: In(OPEN_STATUSES),
      },
      lock: { mode: 'pessimistic_write' },
    });
    for (const offer of supersededOffers) {
      if (offer.id === signedOffer.id) continue;
      offer.status = ContractOfferStatus.WITHDRAWN;
      this.recordDecision(offer, 'SIGNED_WITH_OTHER_CLUB', date);
      await this.cancelAiAgreement(manager, offer, date);
      if (offer.responseEventId !== null) {
        const event = await manager.findOne(CalendarEvent, {
          where: { id: offer.responseEventId, careerId: signedOffer.careerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (event) {
          event.requiresUserAction = false;
          event.payload = {
            ...event.payload,
            reason: '선수가 다른 구단과 계약했습니다.',
          };
          await this.completeEvent(manager, event);
        }
      }
      await manager.save(ContractOffer, offer);
    }
  }

  private async signContract(
    manager: EntityManager,
    career: Career,
    offer: ContractOffer,
    terms: ContractTerms,
  ): Promise<void> {
    const destinationTeam = await manager.findOneBy(CareerTeam, {
      id: offer.careerTeamId,
      careerId: career.id,
    });
    if (!destinationTeam)
      throw new ConflictException('계약 대상 구단을 찾을 수 없습니다.');
    await this.transfersService.completeAcquisition(
      manager,
      offer,
      destinationTeam,
      career.currentDate,
    );
    const current = await manager.findOne(PlayerContract, {
      where: { careerId: career.id, careerPlayerId: offer.careerPlayerId },
      lock: { mode: 'pessimistic_write' },
    });
    const contract =
      current ??
      manager.create(PlayerContract, {
        careerId: career.id,
        careerPlayerId: offer.careerPlayerId,
      });
    contract.careerTeamId = offer.careerTeamId;
    contract.sourceOfferId = offer.id;
    contract.signedDate = career.currentDate;
    contract.startDate = career.currentDate;
    contract.endDate = contractEndDate(career.currentDate, terms.years);
    contract.status = PlayerContractStatus.ACTIVE;
    contract.endedDate = null;
    contract.endReason = null;
    contract.terms = structuredClone(terms);
    contract.promises = terms.promises.map((promise) => ({
      ...promise,
      status: 'PENDING',
    }));
    const savedContract = await manager.save(PlayerContract, contract);
    await this.scheduleExpiration(manager, savedContract);
    await this.cancelCompetingOffers(manager, offer, career.currentDate);
  }

  async processExpirationEvent(
    manager: EntityManager,
    event: CalendarEvent,
    date: string,
  ): Promise<void> {
    const contractId = event.payload?.playerContractId;
    const sourceOfferId = event.payload?.sourceOfferId;
    if (
      typeof contractId !== 'number' ||
      !Number.isInteger(contractId) ||
      typeof sourceOfferId !== 'number' ||
      !Number.isInteger(sourceOfferId)
    ) {
      event.requiresUserAction = false;
      return;
    }
    const contract = await manager.findOne(PlayerContract, {
      where: { id: contractId, careerId: event.careerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !contract ||
      contract.status !== PlayerContractStatus.ACTIVE ||
      contract.sourceOfferId !== sourceOfferId ||
      addCalendarDays(contract.endDate, 1) > date
    ) {
      event.requiresUserAction = false;
      return;
    }
    const record = await this.transfersService.expireContract(
      manager,
      contract,
      date,
    );
    event.requiresUserAction = false;
    event.payload = {
      ...event.payload,
      expired: record !== null,
      transferRecordId: record?.id ?? null,
    };
  }

  private async scheduleResponse(
    manager: EntityManager,
    offer: ContractOffer,
    date: string,
    requiresUserAction = true,
  ): Promise<void> {
    offer.responseDate = addCalendarDays(
      date,
      getResponseDelayDays(offer.id, offer.revision),
    );
    const event = manager.create(CalendarEvent, {
      careerId: offer.careerId,
      scheduledDate: offer.responseDate,
      type: CalendarEventType.CONTRACT_RESPONSE,
      status: CalendarEventStatus.SCHEDULED,
      requiresUserAction,
      payload: {
        contractOfferId: offer.id,
        revision: offer.revision,
        careerPlayerId: offer.careerPlayerId,
      },
      completedAt: null,
    });
    await manager.save(CalendarEvent, event);
    offer.responseEventId = event.id;
  }

  private async scheduleExpiration(
    manager: EntityManager,
    contract: PlayerContract,
  ): Promise<void> {
    const event = manager.create(CalendarEvent, {
      careerId: contract.careerId,
      scheduledDate: addCalendarDays(contract.endDate, 1),
      type: CalendarEventType.CONTRACT_EXPIRATION,
      status: CalendarEventStatus.SCHEDULED,
      requiresUserAction: false,
      payload: {
        playerContractId: contract.id,
        careerPlayerId: contract.careerPlayerId,
        sourceOfferId: contract.sourceOfferId,
      },
      completedAt: null,
    });
    await manager.save(CalendarEvent, event);
  }

  private async completeEvent(
    manager: EntityManager,
    event: CalendarEvent,
  ): Promise<void> {
    event.status = CalendarEventStatus.COMPLETED;
    event.completedAt = new Date();
    await manager.save(CalendarEvent, event);
  }

  private recordDecision(
    offer: ContractOffer,
    action: string,
    date: string,
  ): void {
    offer.history = [
      ...offer.history,
      {
        action,
        date,
        revision: offer.revision,
        terms: structuredClone(offer.terms),
      },
    ];
  }

  private playerAbility(player: CareerPlayer): number {
    return (
      (player.currentMechanics +
        player.currentGameSense +
        player.currentLaning +
        player.currentTeamFight +
        player.currentMacro +
        player.currentTeamPlay +
        player.currentMental +
        player.currentChampionPool) /
      8
    );
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
    if (lock) await assertManagerActive(manager, careerId);
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

export function contractEndDate(start: string, years: number): string {
  const [year, month, day] = start.split('-').map(Number);
  const targetYear = year + years;
  if (targetYear > 9999)
    throw new BadRequestException('계약 종료 연도가 허용 범위를 초과합니다.');
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const anniversary = new Date(
    Date.UTC(targetYear, month - 1, Math.min(day, lastDay)),
  )
    .toISOString()
    .slice(0, 10);
  return addCalendarDays(anniversary, -1);
}
