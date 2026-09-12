import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { isChampionArchetypeAllowed } from '../careers/config/champion-archetype.config';
import {
  DEFAULT_CAREER_START_YEAR,
  INITIAL_CAREER_TEAM_COUNT,
  MAX_BENCH_PLAYERS,
  MAX_CAREER_TEAM_COUNT,
  STARTER_POSITIONS,
} from '../careers/constants/career.constants';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { LEAGUE_CONFIG } from '../leagues/config/league.config';
import { PlayerCardResponseDto } from '../players/dto/player-card-response.dto';
import { PlayerCard } from '../players/entities/player-card.entity';
import { CareerInitialization } from './career-initialization.types';
import { ClubCatalogResponseDto } from './dto/club-response.dto';
import { Club } from './entities/club.entity';

export function readClubCatalog(manager: EntityManager): Promise<Club[]> {
  return manager.find(Club, {
    relations: { rosters: { playerCard: { player: true, theme: true } } },
    order: { code: 'ASC', rosters: { id: 'ASC' } },
  });
}

export function assessClubCatalog(clubs: Club[]): {
  reason: string | null;
  clubReasons: Map<string, string>;
} {
  const activeClubs = clubs.filter((club) => club.enabled);
  const clubReasons = new Map<string, string>();
  const cardOwners = new Map<number, string>();
  const playerOwners = new Map<number, string>();
  const fail = (code: string, reason: string) => {
    if (!clubReasons.has(code)) clubReasons.set(code, reason);
  };
  const validState = (value: number | null | undefined) =>
    value == null || (Number.isInteger(value) && value >= 0 && value <= 100);

  for (const club of activeClubs) {
    const rosters = club.rosters ?? [];
    const starters = rosters.filter(
      (roster) => roster.role === RosterRole.STARTER,
    );
    const benches = rosters.filter(
      (roster) => roster.role === RosterRole.BENCH,
    );
    if (
      starters.length !== STARTER_POSITIONS.length ||
      !STARTER_POSITIONS.every(
        (position) =>
          starters.filter((roster) => roster.position === position).length ===
          1,
      )
    ) {
      fail(
        club.code,
        `${club.name}: TOP/JUNGLE/MID/ADC/SUPPORT 주전을 한 명씩 등록해야 합니다.`,
      );
    }
    if (
      benches.length > MAX_BENCH_PLAYERS ||
      benches.some((roster) => roster.position !== null)
    ) {
      fail(
        club.code,
        `${club.name}: 후보는 최대 ${MAX_BENCH_PLAYERS}명이며 주전 포지션을 지정할 수 없습니다.`,
      );
    }
    if (
      starters.length + benches.length !== rosters.length ||
      !validState(club.initialChemistry)
    ) {
      fail(club.code, `${club.name}: 구단 초기 설정을 확인해 주세요.`);
    }
    for (const roster of rosters) {
      const card = roster.playerCard;
      if (!card?.player || !card.theme) {
        fail(club.code, `${club.name}: 등록된 선수 카드를 찾을 수 없습니다.`);
        continue;
      }
      if (
        !validState(roster.initialForm) ||
        !validState(roster.initialCoachTrust) ||
        (roster.championArchetype != null &&
          (roster.position === null ||
            !isChampionArchetypeAllowed(
              roster.position,
              roster.championArchetype,
            )))
      ) {
        fail(
          club.code,
          `${club.name}: 선수 초기 상태 또는 챔피언 유형 설정을 확인해 주세요.`,
        );
      }
      for (const [owners, id] of [
        [cardOwners, card.id],
        [playerOwners, card.playerId],
      ] as const) {
        const otherCode = owners.get(id);
        if (otherCode !== undefined) {
          const reason = `${otherCode}/${club.code}: 같은 선수는 세계 로스터에 한 번만 등록할 수 있습니다.`;
          fail(club.code, reason);
          fail(otherCode, reason);
        } else {
          owners.set(id, club.code);
        }
      }
    }
  }
  if (
    activeClubs.length < INITIAL_CAREER_TEAM_COUNT ||
    activeClubs.length > MAX_CAREER_TEAM_COUNT
  ) {
    return {
      reason: `시작하려면 활성 구단을 ${INITIAL_CAREER_TEAM_COUNT}~${MAX_CAREER_TEAM_COUNT}개 등록해야 합니다.`,
      clubReasons,
    };
  }
  for (const region of new Set(activeClubs.map((club) => club.region))) {
    if (
      activeClubs.filter((club) => club.region === region).length <
      LEAGUE_CONFIG.minTeams
    ) {
      return {
        reason: `${region} 리그에 활성 구단이 최소 ${LEAGUE_CONFIG.minTeams}개 필요합니다.`,
        clubReasons,
      };
    }
  }
  return { reason: [...clubReasons.values()][0] ?? null, clubReasons };
}

export function buildClubCareer(
  clubs: Club[],
  clubCode: string,
): CareerInitialization {
  const selectedClub = clubs.find((club) => club.code === clubCode);
  if (!selectedClub)
    throw new NotFoundException(`Club ${clubCode} was not found`);
  if (!selectedClub.enabled)
    throw new ConflictException(
      '이 구단은 현재 새 게임에서 선택할 수 없습니다.',
    );
  const { reason } = assessClubCatalog(clubs);
  if (reason !== null) throw new ConflictException(reason);
  return {
    startYear: DEFAULT_CAREER_START_YEAR,
    managedTeamCode: clubCode,
    autoSchedule: true,
    teams: clubs
      .filter((club) => club.enabled)
      .map((club) => ({
        code: club.code,
        clubCode: club.code,
        name: club.name,
        region: club.region,
        logoUrl: club.logoUrl,
        initialChemistry: club.initialChemistry,
        starters: STARTER_POSITIONS.map((position) => {
          const roster = club.rosters.find(
            (entry) =>
              entry.role === RosterRole.STARTER && entry.position === position,
          )!;
          return {
            playerCardId: roster.playerCardId,
            position,
            championArchetype: roster.championArchetype,
            initialCoachTrust: roster.initialCoachTrust,
            initialForm: roster.initialForm,
          };
        }),
        benches: club.rosters
          .filter((roster) => roster.role === RosterRole.BENCH)
          .map((roster) => ({
            playerCardId: roster.playerCardId,
            initialCoachTrust: roster.initialCoachTrust,
            initialForm: roster.initialForm,
          })),
      })),
  };
}

export function toClubCatalogResponse(clubs: Club[]): ClubCatalogResponseDto {
  const { reason, clubReasons } = assessClubCatalog(clubs);
  return {
    startYear: DEFAULT_CAREER_START_YEAR,
    worldTeamCount: clubs.filter((club) => club.enabled).length,
    ready: reason === null,
    unavailableReason: reason,
    clubs: clubs.map((club) => {
      const roster = (club.rosters ?? []).filter(
        (entry) => entry.playerCard?.player && entry.playerCard.theme,
      );
      const starters = roster
        .filter(
          (entry) =>
            entry.role === RosterRole.STARTER && entry.position !== null,
        )
        .sort(
          (left, right) =>
            STARTER_POSITIONS.indexOf(left.position!) -
            STARTER_POSITIONS.indexOf(right.position!),
        );
      const unavailableReason = !club.enabled
        ? '이 구단은 현재 새 게임에서 선택할 수 없습니다.'
        : (clubReasons.get(club.code) ?? reason);
      const statValues = starters.flatMap(({ playerCard }) => [
        playerCard.mechanics,
        playerCard.gameSense,
        playerCard.laning,
        playerCard.teamFight,
        playerCard.macro,
        playerCard.teamPlay,
        playerCard.mental,
        playerCard.championPool,
      ]);
      return {
        code: club.code,
        name: club.name,
        region: club.region,
        logoUrl: club.logoUrl ?? null,
        selectable: unavailableReason === null,
        unavailableReason,
        startingStrength:
          starters.length === STARTER_POSITIONS.length
            ? Math.round(
                (statValues.reduce((sum, stat) => sum + stat, 0) /
                  statValues.length) *
                  10,
              ) / 10
            : null,
        starters: starters.map((entry) => ({
          position: entry.position!,
          playerCard: toPublicPlayerCard(entry.playerCard),
        })),
        benches: roster
          .filter((entry) => entry.role === RosterRole.BENCH)
          .map((entry) => ({
            playerCard: toPublicPlayerCard(entry.playerCard),
          })),
      };
    }),
  };
}

// Explicit projection keeps hidden growth potential out of catalog responses.
function toPublicPlayerCard(card: PlayerCard): PlayerCardResponseDto {
  return {
    id: card.id,
    playerId: card.playerId,
    themeId: card.themeId,
    cardYear: card.cardYear,
    startingAge: card.startingAge,
    imageUrl: card.imageUrl,
    mainPosition: card.mainPosition,
    mechanics: card.mechanics,
    gameSense: card.gameSense,
    laning: card.laning,
    teamFight: card.teamFight,
    macro: card.macro,
    teamPlay: card.teamPlay,
    mental: card.mental,
    championPool: card.championPool,
    personality: card.personality,
    player: {
      id: card.player.id,
      nickname: card.player.nickname,
      nationality: card.player.nationality,
    },
    theme: {
      id: card.theme.id,
      code: card.theme.code,
      name: card.theme.name,
      description: card.theme.description,
    },
  };
}
