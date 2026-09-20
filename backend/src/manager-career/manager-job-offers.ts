import { EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { getTransferWindow } from '../transfers/transfer-window';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import {
  ManagerJobOffer,
  ManagerJobOfferStatus,
} from './entities/manager-job-offer.entity';

type TeamSummary = Pick<CareerTeam, 'id' | 'code' | 'name' | 'region'>;
export interface ManagerJobOffersResponse {
  careerId: number;
  currentDate: string;
  window: { isOpen: boolean; opensAt: string; endsAt: string };
  canCheckOffers: boolean;
  offers: Array<{
    id: number;
    seasonYear: number;
    status: ManagerJobOfferStatus;
    offeredDate: string;
    expiresDate: string;
    reason: string;
    fromTeam: TeamSummary;
    toTeam: TeamSummary;
    canRespond: boolean;
  }>;
}

export function isCurrentJobOffer(
  offer: ManagerJobOffer,
  career: Career,
): boolean {
  const window = getTransferWindow(career.currentDate);
  return (
    offer.status === 'PENDING' &&
    window.isOpen &&
    offer.seasonYear === window.seasonYear &&
    offer.offeredDate >= window.opensAt &&
    offer.offeredDate <= career.currentDate &&
    offer.expiresDate >= career.currentDate
  );
}

/** One batch per stove league, under the existing Career write lock. */
export async function prepareManagerJobOffers(
  manager: EntityManager,
  career: Career,
  state: ManagerCareerState,
): Promise<CalendarEvent[]> {
  const window = getTransferWindow(career.currentDate);
  // Outside recruitment season, only the first day after closing needs expiry writes.
  // Read responses also derive expiry, so skipped dates never revive an old offer.
  if (!window.isOpen && !career.currentDate.endsWith('-01-01')) return [];
  const previous = await manager.find(ManagerJobOffer, {
    where: { careerId: career.id },
    order: { id: 'ASC' },
  });
  for (const offer of previous) {
    if (offer.status === 'PENDING' && offer.expiresDate < career.currentDate) {
      offer.status = 'EXPIRED';
      offer.resolvedDate = career.currentDate;
      await manager.save(ManagerJobOffer, offer);
    }
  }
  if (
    !window.isOpen ||
    previous.some((offer) => offer.seasonYear === window.seasonYear)
  )
    return [];
  const teams = await manager.find(CareerTeam, {
    where: { careerId: career.id },
    order: { id: 'ASC' },
  });
  const current = teams.find(
    (team) => team.id === state.careerTeamId && team.isUserControlled,
  );
  if (!current) return [];
  // Prototype recruitment: nearby clubs make up to three invitations each winter.
  // Public career results explain the invitation; hidden player potential is never used.
  const candidates = teams
    .filter((team) => !team.isUserControlled && team.id !== current.id)
    .sort(
      (a, b) =>
        Number(b.region === current.region) -
          Number(a.region === current.region) || a.id - b.id,
    )
    .slice(0, 3);
  const news: CalendarEvent[] = [];
  for (const team of candidates) {
    const reason =
      state.played > 0
        ? `${team.name}이(가) 당신의 공식 시리즈 ${state.wins}승 ${state.played - state.wins}패 기록을 참고해 새 시즌 감독직을 제안했습니다.`
        : `${team.name}이(가) 새 시즌 선수단 운영을 맡을 감독을 찾고 있습니다. 스토브리그 동안 부임 여부를 결정할 수 있습니다.`;
    const offer = await manager.save(
      ManagerJobOffer,
      manager.create(ManagerJobOffer, {
        careerId: career.id,
        seasonYear: window.seasonYear,
        fromCareerTeamId: current.id,
        toCareerTeamId: team.id,
        status: 'PENDING',
        offeredDate: career.currentDate,
        expiresDate: window.endsAt,
        resolvedDate: null,
        reason,
      }),
    );
    news.push(
      await manager.save(
        CalendarEvent,
        manager.create(CalendarEvent, {
          careerId: career.id,
          scheduledDate: career.currentDate,
          type: CalendarEventType.AI_CLUB_UPDATE,
          status: CalendarEventStatus.COMPLETED,
          requiresUserAction: false,
          completedAt: new Date(),
          payload: {
            title: '감독 영입 제안',
            message: reason,
            managerJobOfferId: offer.id,
          },
        }),
      ),
    );
  }
  return news;
}

export async function describeManagerJobOffers(
  manager: EntityManager,
  career: Career,
): Promise<ManagerJobOffersResponse> {
  const window = getTransferWindow(career.currentDate);
  const [offers, teams] = await Promise.all([
    manager.find(ManagerJobOffer, {
      where: { careerId: career.id },
      order: { seasonYear: 'DESC', id: 'ASC' },
    }),
    manager.find(CareerTeam, {
      where: { careerId: career.id },
      order: { id: 'ASC' },
    }),
  ]);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const summary = (team: CareerTeam): TeamSummary => ({
    id: team.id,
    code: team.code,
    name: team.name,
    region: team.region,
  });
  return {
    careerId: career.id,
    currentDate: career.currentDate,
    window: {
      isOpen: window.isOpen,
      opensAt: window.opensAt,
      endsAt: window.endsAt,
    },
    canCheckOffers:
      window.isOpen &&
      !offers.some((offer) => offer.seasonYear === window.seasonYear),
    offers: offers.flatMap((offer) => {
      const from = teamsById.get(offer.fromCareerTeamId);
      const to = teamsById.get(offer.toCareerTeamId);
      if (!from || !to) return [];
      const canRespond =
        isCurrentJobOffer(offer, career) &&
        from.isUserControlled &&
        !to.isUserControlled;
      return [
        {
          id: offer.id,
          seasonYear: offer.seasonYear,
          status:
            offer.status === 'PENDING' && !isCurrentJobOffer(offer, career)
              ? ('EXPIRED' as const)
              : offer.status,
          offeredDate: offer.offeredDate,
          expiresDate: offer.expiresDate,
          reason: offer.reason,
          fromTeam: summary(from),
          toTeam: summary(to),
          canRespond,
        },
      ];
    }),
  };
}
