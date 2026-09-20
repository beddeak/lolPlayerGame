import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { ContractOfferStatus } from '../contracts/contract.types';
import { ContractOffer } from '../contracts/entities/contract-offer.entity';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { getSeriesWinsRequired } from '../match-series/config/bo3-series.config';
import { TransferAgreement } from '../transfers/entities/transfer-agreement.entity';
import { TransferAgreementStatus } from '../transfers/transfer.types';
import { assertTransferWindow } from '../transfers/transfer-window';
import { ManagerJobOffer } from './entities/manager-job-offer.entity';
import { ManagerCareerService } from './manager-career.service';
import {
  describeManagerJobOffers,
  isCurrentJobOffer,
  prepareManagerJobOffers,
} from './manager-job-offers';

@Injectable()
export class ManagerJobOffersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly managerCareer: ManagerCareerService,
  ) {}

  async findAll(accountId: number, careerId: number) {
    const career = await this.ownedCareer(
      this.dataSource.manager,
      accountId,
      careerId,
    );
    return describeManagerJobOffers(this.dataSource.manager, career);
  }

  async check(accountId: number, careerId: number) {
    return this.dataSource.transaction(async (manager) => {
      const career = await this.ownedCareer(manager, accountId, careerId, true);
      assertTransferWindow(career.currentDate);
      const state = await this.managerCareer.initialize(manager, career);
      await prepareManagerJobOffers(manager, career, state);
      return describeManagerJobOffers(manager, career);
    });
  }

  async respond(
    accountId: number,
    careerId: number,
    offerId: number,
    accept: boolean,
  ) {
    return this.dataSource.transaction(async (manager) => {
      // Re-employment during an open stove league is allowed, including dismissed managers.
      // Other calendar and club-management dismissal guards remain unchanged.
      const career = await this.ownedCareer(manager, accountId, careerId, true);
      const offer = await manager.findOne(ManagerJobOffer, {
        where: { id: offerId, careerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!offer)
        throw new NotFoundException('감독 영입 제안을 찾을 수 없습니다.');
      assertTransferWindow(career.currentDate, offer.offeredDate);
      if (!isCurrentJobOffer(offer, career))
        throw new ConflictException(
          '이미 처리되었거나 만료된 감독 영입 제안입니다.',
        );
      const teams = await manager.find(CareerTeam, {
        where: { careerId },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const source = teams.find((team) => team.id === offer.fromCareerTeamId);
      const target = teams.find((team) => team.id === offer.toCareerTeamId);
      if (
        !source?.isUserControlled ||
        !target ||
        target.isUserControlled ||
        source.id === target.id ||
        teams.filter((team) => team.isUserControlled).length !== 1
      ) {
        throw new ConflictException(
          '제안 당시 소속 구단이 변경되어 이 제안을 처리할 수 없습니다.',
        );
      }
      const state = await this.managerCareer.initialize(manager, career);
      if (state.careerTeamId !== source.id)
        throw new ConflictException(
          '현재 감독 소속과 구단 정보가 일치하지 않습니다.',
        );
      if (accept) {
        await this.assertNoOngoingSeries(manager, careerId, [
          source.id,
          target.id,
        ]);
        await this.closeClubNegotiations(manager, career, [
          source.id,
          target.id,
        ]);
        source.isUserControlled = false;
        target.isUserControlled = true;
        await manager.save(CareerTeam, [source, target]);
        await this.managerCareer.adoptTeam(
          manager,
          career,
          state,
          target,
          source,
        );
        await manager.update(
          ManagerJobOffer,
          { careerId, status: 'PENDING' },
          { status: 'EXPIRED', resolvedDate: career.currentDate },
        );
      }
      offer.status = accept ? 'ACCEPTED' : 'DECLINED';
      offer.resolvedDate = career.currentDate;
      await manager.save(ManagerJobOffer, offer);
      return describeManagerJobOffers(manager, career);
    });
  }

  private async assertNoOngoingSeries(
    manager: EntityManager,
    careerId: number,
    teamIds: number[],
  ) {
    const series = await manager.find(MatchSeries, {
      where: [
        { careerId, teamAId: In(teamIds) },
        { careerId, teamBId: In(teamIds) },
      ],
      relations: { games: true },
    });
    if (
      series.some(
        (entry) =>
          entry.games.length > 0 &&
          [entry.teamAId, entry.teamBId].every(
            (teamId) =>
              entry.games.filter((game) => game.winnerTeamId === teamId)
                .length < getSeriesWinsRequired(entry.bestOf),
          ),
      )
    )
      throw new ConflictException(
        '이전 구단 또는 제안 구단에 진행 중인 시리즈가 있어 부임할 수 없습니다. 시리즈를 마친 뒤 다시 시도하세요.',
      );
  }

  private async closeClubNegotiations(
    manager: EntityManager,
    career: Career,
    teamIds: number[],
  ) {
    const open = In([
      ContractOfferStatus.WAITING_PLAYER_RESPONSE,
      ContractOfferStatus.PLAYER_ACCEPTED,
      ContractOfferStatus.COUNTER_OFFERED,
      ContractOfferStatus.REJECTED,
    ]);
    const offers = await manager.find(ContractOffer, {
      where: [
        { careerId: career.id, careerTeamId: In(teamIds), status: open },
        { careerId: career.id, sourceCareerTeamId: In(teamIds), status: open },
      ],
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    for (const offer of offers) {
      offer.status = ContractOfferStatus.WITHDRAWN;
      offer.history.push({
        action: 'MANAGER_CHANGED',
        date: career.currentDate,
        revision: offer.revision,
        terms: offer.terms,
      });
      if (offer.responseEventId) {
        await manager.update(
          CalendarEvent,
          { id: offer.responseEventId, careerId: career.id },
          {
            status: CalendarEventStatus.COMPLETED,
            requiresUserAction: false,
            completedAt: new Date(),
          },
        );
      }
      await manager.save(ContractOffer, offer);
    }
    await manager.update(
      TransferAgreement,
      [
        {
          careerId: career.id,
          buyerCareerTeamId: In(teamIds),
          status: TransferAgreementStatus.ACCEPTED,
        },
        {
          careerId: career.id,
          sellerCareerTeamId: In(teamIds),
          status: TransferAgreementStatus.ACCEPTED,
        },
      ],
      {
        status: TransferAgreementStatus.CANCELLED,
        resolvedDate: career.currentDate,
        reason:
          '감독 부임에 따라 양 구단의 진행 중인 선수 영입·매각 협상을 종료했습니다.',
      },
    );
  }

  private async ownedCareer(
    manager: EntityManager,
    accountId: number,
    careerId: number,
    lock = false,
  ) {
    const career = await manager.findOne(Career, {
      where: { id: careerId, accountId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!career)
      throw new NotFoundException(`Career ${careerId} was not found`);
    return career;
  }
}
