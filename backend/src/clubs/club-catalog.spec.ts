import { ConflictException, NotFoundException } from '@nestjs/common';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { ChampionArchetype } from '../careers/enums/champion-archetype.enum';
import { Region } from '../careers/enums/region.enum';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { PlayerCard } from '../players/entities/player-card.entity';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import {
  assessClubCatalog,
  buildClubCareer,
  toClubCatalogResponse,
} from './club-catalog';
import { ClubRoster } from './entities/club-roster.entity';
import { Club } from './entities/club.entity';

function makeClubs(): Club[] {
  return ['TEST_A', 'TEST_B'].map((code, teamIndex) => {
    const club = Object.assign(new Club(), {
      id: teamIndex + 1,
      code,
      name: code,
      region: Region.LCK,
      logoUrl: `/clubs/${code}.png`,
      enabled: true,
      initialChemistry: 78,
    });
    club.rosters = STARTER_POSITIONS.map((position, playerIndex) => {
      const id = teamIndex * 10 + playerIndex + 1;
      return Object.assign(new ClubRoster(), {
        id,
        clubId: club.id,
        role: RosterRole.STARTER,
        position,
        playerCardId: id,
        initialCoachTrust: 91,
        initialForm: null,
        championArchetype:
          playerIndex === 0 ? ChampionArchetype.TOP_TANK : null,
        playerCard: Object.assign(new PlayerCard(), {
          id,
          playerId: id,
          themeId: 1,
          cardYear: 2026,
          startingAge: 20,
          imageUrl: null,
          mainPosition: position,
          mechanics: 81,
          gameSense: 81,
          laning: 81,
          teamFight: 81,
          macro: 81,
          teamPlay: 81,
          mental: 81,
          championPool: 81,
          personality: PlayerPersonality.PROFESSIONAL,
          potential: 99,
          player: { id, nickname: `Test ${id}`, nationality: 'KR' },
          theme: { id: 1, code: 'TEST', name: 'Test', description: null },
        }),
      });
    });
    return club;
  });
}

describe('club catalog', () => {
  it('publishes registered player cards and strength without private growth data', () => {
    const response = toClubCatalogResponse(makeClubs());
    expect(response).toMatchObject({
      ready: true,
      worldTeamCount: 2,
      startYear: 2026,
    });
    expect(response.clubs[0]).toMatchObject({
      selectable: true,
      startingStrength: 81,
    });
    expect(response.clubs[0].starters).toHaveLength(5);
    expect(JSON.stringify(response)).not.toContain('potential');
  });

  it('blocks every club when any enabled world roster is incomplete', () => {
    const clubs = makeClubs();
    clubs[1].rosters.pop();
    const response = toClubCatalogResponse(clubs);
    expect(response.ready).toBe(false);
    expect(response.clubs.every((club) => !club.selectable)).toBe(true);
    expect(() => buildClubCareer(clubs, 'TEST_A')).toThrow(ConflictException);
  });

  it('allows unfinished disabled clubs to remain in the catalog without joining a career', () => {
    const clubs = makeClubs();
    clubs.push(
      Object.assign(new Club(), {
        id: 3,
        code: 'DRAFT',
        enabled: false,
        rosters: [],
      }),
    );
    expect(toClubCatalogResponse(clubs)).toMatchObject({
      ready: true,
      worldTeamCount: 2,
    });
    expect(buildClubCareer(clubs, 'TEST_A').teams).toHaveLength(2);
    expect(() => buildClubCareer(clubs, 'DRAFT')).toThrow(ConflictException);
    expect(() => buildClubCareer(clubs, 'MISSING')).toThrow(NotFoundException);
  });

  it('rejects alternate cards belonging to the same real player across clubs', () => {
    const clubs = makeClubs();
    clubs[1].rosters[0].playerCard.playerId =
      clubs[0].rosters[0].playerCard.playerId;
    expect(assessClubCatalog(clubs).clubReasons.size).toBe(2);
    expect(() => buildClubCareer(clubs, 'TEST_A')).toThrow(ConflictException);
  });

  it('rejects a region with only one enabled opponent team', () => {
    const clubs = makeClubs();
    clubs[1].region = Region.LPL;
    expect(toClubCatalogResponse(clubs).unavailableReason).toContain('LCK');
    expect(() => buildClubCareer(clubs, 'TEST_A')).toThrow(ConflictException);
  });

  it('copies the club and roster initial state into server-owned career setup', () => {
    const clubs = makeClubs();
    const bench = Object.assign(new ClubRoster(), {
      ...clubs[0].rosters[0],
      id: 90,
      role: RosterRole.BENCH,
      position: null,
      playerCardId: 90,
      initialForm: 64,
      championArchetype: null,
      playerCard: { ...clubs[0].rosters[0].playerCard, id: 90, playerId: 90 },
    });
    clubs[0].rosters.push(bench);
    const setup = buildClubCareer(clubs, 'TEST_B');
    expect(setup).toMatchObject({
      managedTeamCode: 'TEST_B',
      startYear: 2026,
      autoSchedule: true,
    });
    expect(setup.teams[0]).toMatchObject({
      clubCode: 'TEST_A',
      logoUrl: '/clubs/TEST_A.png',
      initialChemistry: 78,
    });
    expect(setup.teams[0].starters[0]).toMatchObject({
      initialCoachTrust: 91,
      championArchetype: ChampionArchetype.TOP_TANK,
    });
    expect(setup.teams[0].benches).toEqual([
      { playerCardId: 90, initialCoachTrust: 91, initialForm: 64 },
    ]);
  });

  it('blocks invalid initial state instead of silently altering it', () => {
    const clubs = makeClubs();
    clubs[0].rosters[0].initialCoachTrust = 101;
    expect(() => buildClubCareer(clubs, 'TEST_A')).toThrow(ConflictException);
    clubs[0].rosters[0].initialCoachTrust = 100;
    clubs[0].rosters[0].championArchetype = ChampionArchetype.HYPER_CARRY;
    expect(() => buildClubCareer(clubs, 'TEST_A')).toThrow(ConflictException);
  });
});
