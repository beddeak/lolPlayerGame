import { EntityManager } from 'typeorm';
import { isChampionArchetypeAllowed } from '../../careers/config/champion-archetype.config';
import {
  MAX_BENCH_PLAYERS,
  STARTER_POSITIONS,
} from '../../careers/constants/career.constants';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { Region } from '../../careers/enums/region.enum';
import { RosterRole } from '../../careers/enums/roster-role.enum';
import { Club } from '../../clubs/entities/club.entity';
import { ClubRoster } from '../../clubs/entities/club-roster.entity';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { Position } from '../../players/enums/position.enum';

export interface ClubSeedData {
  code: string;
  name: string;
  region: Region;
  enabled?: boolean;
  logoUrl?: string | null;
  initialChemistry?: number;
  starters: Array<{
    position: Position;
    playerCardKey: string;
    championArchetype?: ChampionArchetype;
    initialCoachTrust?: number;
  }>;
  benches?: Array<{ playerCardKey: string; initialForm?: number }>;
}

function score(value: number | undefined, label: string): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 0 || value > 100)
  ) {
    throw new Error(`${label}: 0~100 사이의 정수를 입력하세요.`);
  }
}

/** Reject malformed imports before touching catalog or saved career data. */
export function validateClubSeeds(
  teams: ClubSeedData[],
  cardKeys: Set<string>,
): void {
  if (!Array.isArray(teams)) throw new Error('teams 배열이 필요합니다.');
  const codes = new Set<string>();
  const activeCards = new Set<string>();
  for (const team of teams) {
    if (
      !team ||
      typeof team.code !== 'string' ||
      !/^[A-Z0-9_]{1,32}$/.test(team.code)
    ) {
      throw new Error('구단 code는 1~32자 영문 대문자·숫자·밑줄이어야 합니다.');
    }
    if (codes.has(team.code)) throw new Error(`중복 구단 code: ${team.code}`);
    codes.add(team.code);
    if (
      typeof team.name !== 'string' ||
      !team.name.trim() ||
      team.name.length > 100
    ) {
      throw new Error(`${team.code}: 구단 name은 1~100자입니다.`);
    }
    if (!Object.values(Region).includes(team.region))
      throw new Error(`${team.code}: 잘못된 region`);
    if (team.enabled !== undefined && typeof team.enabled !== 'boolean')
      throw new Error(`${team.code}: enabled는 true/false입니다.`);
    if (
      team.logoUrl != null &&
      (typeof team.logoUrl !== 'string' ||
        team.logoUrl.length > 500 ||
        !/^(\/(?!\/)|https?:\/\/)/.test(team.logoUrl))
    ) {
      throw new Error(
        `${team.code}: logoUrl은 /club-logos/... 또는 http(s) URL이어야 합니다.`,
      );
    }
    score(team.initialChemistry, `${team.code}.initialChemistry`);
    if (
      !Array.isArray(team.starters) ||
      team.starters.length > STARTER_POSITIONS.length
    )
      throw new Error(`${team.code}: starters는 최대 5명입니다.`);
    if (
      team.benches !== undefined &&
      (!Array.isArray(team.benches) || team.benches.length > MAX_BENCH_PLAYERS)
    )
      throw new Error(
        `${team.code}: benches는 최대 ${MAX_BENCH_PLAYERS}명입니다.`,
      );
    const slots = new Set<Position>();
    const members = new Set<string>();
    const member = (key: string) => {
      if (!cardKeys.has(key))
        throw new Error(`${team.code}: 없는 playerCardKey ${key}`);
      if (members.has(key)) throw new Error(`${team.code}: 중복 선수 ${key}`);
      members.add(key);
      if (team.enabled !== false) {
        if (activeCards.has(key))
          throw new Error(`활성 구단 사이의 중복 선수: ${key}`);
        activeCards.add(key);
      }
    };
    for (const row of team.starters) {
      if (
        !row ||
        !STARTER_POSITIONS.includes(row.position) ||
        slots.has(row.position)
      )
        throw new Error(`${team.code}: 잘못되거나 중복된 주전 포지션`);
      slots.add(row.position);
      member(row.playerCardKey);
      score(
        row.initialCoachTrust,
        `${team.code}.${row.position}.initialCoachTrust`,
      );
      if (
        row.championArchetype !== undefined &&
        !isChampionArchetypeAllowed(row.position, row.championArchetype)
      )
        throw new Error(`${team.code}: 포지션에 맞지 않는 championArchetype`);
    }
    for (const row of team.benches ?? []) {
      if (!row) throw new Error(`${team.code}: 잘못된 후보 선수`);
      member(row.playerCardKey);
      score(row.initialForm, `${team.code}.bench.initialForm`);
    }
  }
}

/** The caller owns one transaction for Player/Theme/Card and club templates. Never touches careers. */
export async function seedClubCatalog(
  manager: EntityManager,
  teams: ClubSeedData[],
  cards: Map<string, PlayerCard>,
): Promise<number> {
  validateClubSeeds(teams, new Set(cards.keys()));
  const activePlayers = new Set<number>();
  for (const team of teams.filter((item) => item.enabled !== false)) {
    for (const row of [...team.starters, ...(team.benches ?? [])]) {
      const card = cards.get(row.playerCardKey)!;
      if (activePlayers.has(card.playerId))
        throw new Error(
          `활성 구단에 동일 선수가 여러 카드로 등록되었습니다: ${row.playerCardKey}`,
        );
      activePlayers.add(card.playerId);
    }
  }
  const existing = await manager.find(Club, {
    lock: { mode: 'pessimistic_write' },
  });
  const incoming = new Set(teams.map((team) => team.code));
  // Removed definitions are disabled, not deleted; saved team snapshots remain independent.
  for (const club of existing) {
    if (!incoming.has(club.code) && club.enabled) {
      club.enabled = false;
      await manager.save(Club, club);
    }
  }
  for (const team of teams) {
    const club =
      existing.find((item) => item.code === team.code) ??
      manager.create(Club, { code: team.code });
    Object.assign(club, {
      name: team.name.trim(),
      region: team.region,
      enabled: team.enabled !== false,
      logoUrl: team.logoUrl ?? null,
      initialChemistry: team.initialChemistry ?? null,
    });
    const saved = await manager.save(Club, club);
    const rows = [
      ...team.starters.map((row) => ({
        playerCardId: cards.get(row.playerCardKey)!.id,
        role: RosterRole.STARTER,
        position: row.position,
        championArchetype: row.championArchetype ?? null,
        initialCoachTrust: row.initialCoachTrust ?? null,
        initialForm: null,
      })),
      ...(team.benches ?? []).map((row) => ({
        playerCardId: cards.get(row.playerCardKey)!.id,
        role: RosterRole.BENCH,
        position: null,
        championArchetype: null,
        initialCoachTrust: null,
        initialForm: row.initialForm ?? null,
      })),
    ];
    const stored = await manager.find(ClubRoster, {
      where: { clubId: saved.id },
    });
    const normalized = stored.map((row) => ({
      playerCardId: row.playerCardId,
      role: row.role,
      position: row.position,
      championArchetype: row.championArchetype,
      initialCoachTrust: row.initialCoachTrust,
      initialForm: row.initialForm,
    }));
    const ordered = (items: typeof normalized) =>
      JSON.stringify(
        [...items].sort((a, b) => a.playerCardId - b.playerCardId),
      );
    if (ordered(rows) === ordered(normalized)) continue;
    await manager.delete(ClubRoster, { clubId: saved.id });
    if (rows.length)
      await manager.save(
        ClubRoster,
        rows.map((row) =>
          manager.create(ClubRoster, { ...row, clubId: saved.id }),
        ),
      );
  }
  return teams.filter((team) => team.enabled !== false).length;
}
