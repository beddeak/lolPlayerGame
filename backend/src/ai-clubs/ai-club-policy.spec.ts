import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { Position } from '../players/enums/position.enum';
import {
  AiPlayerSnapshot,
  AiRosterSlot,
  assessAiRoster,
  chooseAiBenchPromotion,
  chooseAiTeamStrategy,
  getAiPlayerAbility,
  rankAiTransferCandidates,
} from './ai-club-policy';
import { AI_CLUB_CONFIG } from './config/ai-club.config';

function player(
  id: number,
  position: Position,
  ability = 70,
): AiPlayerSnapshot {
  return {
    id,
    currentPosition: position,
    currentMechanics: ability,
    currentGameSense: ability,
    currentLaning: ability,
    currentTeamFight: ability,
    currentMacro: ability,
    currentTeamPlay: ability,
    currentMental: ability,
    currentChampionPool: ability,
  };
}
function lineup(): AiRosterSlot[] {
  return STARTER_POSITIONS.map((position, index) => ({
    role: RosterRole.STARTER,
    starterPosition: position,
    careerPlayer: player(index + 1, position),
  }));
}
function bench(candidate: AiPlayerSnapshot): AiRosterSlot {
  return {
    role: RosterRole.BENCH,
    starterPosition: null,
    careerPlayer: candidate,
  };
}

describe('EASY AI club policy', () => {
  it('uses only the arithmetic mean of current stats without hidden ability boosts', () => {
    const candidate = { ...player(1, Position.TOP), currentMechanics: 86 };
    Object.defineProperty(candidate, 'potential', {
      get: () => {
        throw new Error('Hidden potential accessed');
      },
    });
    expect(getAiPlayerAbility(candidate)).toBe(72);
    expect(() =>
      getAiPlayerAbility({ ...candidate, currentMental: Number.NaN }),
    ).toThrow();
  });

  it('detects missing positions before weak but occupied slots', () => {
    const rosters = lineup().filter(
      (slot) => slot.starterPosition !== Position.SUPPORT,
    );
    rosters[0].careerPlayer = player(1, Position.TOP, 0);
    const result = assessAiRoster(rosters);
    expect(result.weakestPosition).toBe(Position.SUPPORT);
    expect(result.positions[4]).toEqual({
      position: Position.SUPPORT,
      starterId: null,
      ability: 0,
      missing: true,
    });
    expect(result.teamStrength).toBe(42);
  });

  it('respects ordinary off-position proficiency when assessing an existing starter', () => {
    const rosters = lineup();
    rosters[0].careerPlayer = player(1, Position.MID, 80);
    expect(assessAiRoster(rosters).positions[0].ability).toBe(68);
    rosters[0].careerPlayer.positionProficiencies = [
      { position: Position.TOP, proficiency: 100 },
    ];
    expect(assessAiRoster(rosters).positions[0].ability).toBe(80);
  });

  it('promotes only natural same-position bench players above the threshold', () => {
    const rosters = lineup();
    rosters.push(
      bench(player(7, Position.TOP, 71)),
      bench(player(8, Position.TOP, 72)),
    );
    expect(chooseAiBenchPromotion(rosters)).toEqual({
      position: Position.TOP,
      incomingPlayerId: 8,
      outgoingPlayerId: 1,
      upgrade: 2,
    });
    expect(
      chooseAiBenchPromotion([...lineup(), bench(player(7, Position.TOP, 71))]),
    ).toBeNull();
    const withoutTop = lineup().filter(
      (slot) => slot.starterPosition !== Position.TOP,
    );
    expect(
      chooseAiBenchPromotion([
        ...withoutTop,
        bench(player(9, Position.MID, 70)),
      ]),
    ).toBeNull();
  });

  it('fills an empty slot before replacing an occupied starter, with stable ties', () => {
    const rosters = lineup().filter(
      (slot) => slot.starterPosition !== Position.SUPPORT,
    );
    rosters.push(
      bench(player(9, Position.TOP, 99)),
      bench(player(8, Position.SUPPORT, 50)),
      bench(player(7, Position.SUPPORT, 50)),
    );
    const expected = {
      position: Position.SUPPORT,
      incomingPlayerId: 7,
      outgoingPlayerId: null,
      upgrade: 50,
    };
    expect(chooseAiBenchPromotion(rosters)).toEqual(expected);
    expect(chooseAiBenchPromotion([...rosters].reverse())).toEqual(expected);
  });

  it('ranks positive upgrades only for the weakest position and leaves the roster unchanged', () => {
    const rosters = lineup();
    const original = structuredClone(rosters);
    const assessment = assessAiRoster(rosters);
    const candidates = [
      player(9, Position.ADC, 99),
      player(8, Position.TOP, 72),
      player(7, Position.TOP, 75),
      player(6, Position.TOP, 75),
      player(10, Position.TOP, 73),
    ];
    expect(rankAiTransferCandidates(candidates, assessment)).toEqual([
      { careerPlayerId: 6, position: Position.TOP, upgrade: 5, score: 5 },
      { careerPlayerId: 7, position: Position.TOP, upgrade: 5, score: 5 },
      { careerPlayerId: 10, position: Position.TOP, upgrade: 3, score: 3 },
    ]);
    expect(
      rankAiTransferCandidates([...candidates].reverse(), assessment),
    ).toEqual(rankAiTransferCandidates(candidates, assessment));
    expect(rosters).toEqual(original);
  });

  it('considers vacancies before ordinary upgrades and excludes duplicate or incumbent candidates', () => {
    const rosters = lineup().filter(
      (slot) => slot.starterPosition !== Position.TOP,
    );
    const candidate = player(6, Position.TOP, 10);
    const ranked = rankAiTransferCandidates(
      [
        candidate,
        candidate,
        player(7, Position.MID, 99),
        rosters[0].careerPlayer,
      ],
      assessAiRoster(rosters),
    );
    expect(ranked).toEqual([
      { careerPlayerId: 6, position: Position.TOP, upgrade: 10, score: 10 },
    ]);
  });

  it('retains the same strategy about 85 percent of decisions reproducibly', () => {
    const rosters = lineup();
    let retained = 0;
    const samples = 2000;
    for (let index = 0; index < samples; index += 1) {
      const seed = `retention:${index}`;
      const strategy = chooseAiTeamStrategy(
        TeamStrategy.TOP_CARRY,
        rosters,
        seed,
      );
      expect(chooseAiTeamStrategy(TeamStrategy.TOP_CARRY, rosters, seed)).toBe(
        strategy,
      );
      if (strategy === TeamStrategy.TOP_CARRY) retained += 1;
    }
    expect(
      Math.abs(retained / samples - AI_CLUB_CONFIG.strategyRetention),
    ).toBeLessThan(0.035);
  });

  it('chooses existing pressure or carry strategies from ordinary bot stats when reconsidering', () => {
    const balanced = lineup();
    const seed = Array.from(
      { length: 100 },
      (_, index) => `choice:${index}`,
    ).find(
      (value) =>
        chooseAiTeamStrategy(TeamStrategy.TOP_CARRY, balanced, value) !==
        TeamStrategy.TOP_CARRY,
    )!;
    expect(seed).toBeDefined();
    const early = structuredClone(balanced);
    for (const slot of early.slice(3)) {
      slot.careerPlayer.currentMechanics = 90;
      slot.careerPlayer.currentLaning = 90;
    }
    const scaling = structuredClone(balanced);
    for (const slot of scaling.slice(3)) {
      slot.careerPlayer.currentTeamFight = 90;
      slot.careerPlayer.currentMacro = 90;
      slot.careerPlayer.currentTeamPlay = 90;
      slot.careerPlayer.currentChampionPool = 90;
    }
    expect(chooseAiTeamStrategy(TeamStrategy.TOP_CARRY, early, seed)).toBe(
      TeamStrategy.BOT_PRESSURE,
    );
    expect(chooseAiTeamStrategy(TeamStrategy.TOP_CARRY, scaling, seed)).toBe(
      TeamStrategy.BOT_CARRY,
    );
    expect(chooseAiTeamStrategy(TeamStrategy.TOP_CARRY, balanced, seed)).toBe(
      TeamStrategy.BALANCED,
    );
    expect(chooseAiTeamStrategy(TeamStrategy.TOP_CARRY, [], seed)).toBe(
      TeamStrategy.BALANCED,
    );
  });
});
