import { Position } from '../../players/enums/position.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import {
  RIOT_CHAMPIONS,
  RIOT_DATA_VERSION,
} from '../../drafts/data/riot-champions';
import type { SimpleMatchTeamInput } from '../simulation/simple-match.types';
import {
  createCombatProfile,
  createEngineInput,
  type EngineInputOptions,
} from './input-adapter';

function options(): EngineInputOptions {
  const positions = Object.values(Position);
  const teams = [10, 20].map((teamId): SimpleMatchTeamInput => ({
    teamId,
    teamCode: `TEAM${teamId}`,
    teamStrategy: TeamStrategy.BALANCED,
    strategyProficiency: 75,
    chemistry: 90,
    activeSetBonuses: [],
    players: positions.map((position, i) => ({
      careerPlayerId: teamId * 10 + i,
      position,
      mechanics: 80,
      gameSense: 80,
      laning: 80,
      teamFight: 80,
      macro: 80,
      teamPlay: 80,
      mental: 80,
      championPool: 80,
      form: 50,
      condition: 100,
      playerInstruction: null,
      roleProficiency: null,
      positionProficiency: 100,
      championArchetype: null,
    })),
  })) as [SimpleMatchTeamInput, SimpleMatchTeamInput];
  const ids = [
    'Aatrox',
    'LeeSin',
    'Ahri',
    'Jinx',
    'Lulu',
    'Garen',
    'Vi',
    'Annie',
    'Ashe',
    'Leona',
  ];
  return {
    careerId: 7,
    seriesId: 8,
    gameId: 9,
    seed: 42,
    blueTeamId: 10,
    teams,
    picks: teams.flatMap((team, t) =>
      positions.map((position, p) => ({
        teamId: team.teamId,
        position,
        championId: ids[t * 5 + p],
      })),
    ),
  };
}

describe('tactical immutable input adapter', () => {
  it('supports all 173 pinned champions with real base fields and explicitly approximate remaining behavior', () => {
    expect(RIOT_CHAMPIONS).toHaveLength(173);
    for (const champion of RIOT_CHAMPIONS) {
      const profile = createCombatProfile(champion.id);
      expect(profile).toMatchObject({
        maxHp: champion.health,
        attackDamage: champion.attack,
        armor: champion.armor,
        attackRange: champion.range,
      });
      expect(
        Object.values(profile).every(
          (value) => Number.isFinite(value) && value > 0,
        ),
      ).toBe(true);
    }
    expect(() => createCombatProfile('UNSUPPORTED_VARIANT')).toThrow(
      'Unsupported champion',
    );
    const input = createEngineInput(options());
    expect(input.catalogVersion).toBe(RIOT_DATA_VERSION);
    expect(input.rules.sourcePatch).toBe('26.1');
    expect(input.rules.provenance.championCatalog).toContain('16.19.1');
    expect(input.rules.provenance.championCatalog).toContain('MODEL');
  });

  it('keeps all original 119 stats, nullable mastery, feedback and source snapshots without mutating or retaining references', () => {
    const source = options();
    const player = source.teams[0].players[0];
    player.mechanics = 119;
    player.feedback = {
      mental: -10,
      form: 3,
      confidence: 4,
      motivation: 2,
      pressure: 1,
      aggression: 8,
      riskTaking: 5,
      carryBonus: 2,
    };
    source.teams[0].activeSetBonuses = [
      {
        id: 4,
        code: 'TEST',
        name: 'Test',
        chemistryBonus: 3,
        laningBonus: 1,
        teamFightBonus: 2,
        macroBonus: 3,
        teamPlayBonus: 4,
      },
    ];
    const before = structuredClone(source);
    const input = createEngineInput(source);
    expect(source).toEqual(before);
    expect(input.context).toEqual({ careerId: 7, seriesId: 8, gameId: 9 });
    expect(input.actors).toHaveLength(10);
    expect(input.actors[0].playerStats.mechanics).toBe(119);
    expect(input.actors[0].roleProficiency).toBeNull();
    expect(input.actors[0].feedback).toEqual(player.feedback);
    expect(input.actors[0].sourcePlayer).toEqual(player);
    expect(input.teams[0].sourceTeam).toEqual(source.teams[0]);
    expect(input.actors[0].profile.attackDamage).toBe(60);
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.actors[0].feedback)).toBe(true);
    expect(
      Object.isFrozen(input.teams[0].sourceTeam!.activeSetBonuses[0]),
    ).toBe(true);
    player.mechanics = 1;
    player.feedback.mental = 0;
    expect(input.actors[0].playerStats.mechanics).toBe(119);
    expect(input.actors[0].feedback!.mental).toBe(-10);
  });

  it('allows ADC and support champions in any assigned lane without position restrictions', () => {
    const source = options();
    [source.picks[0].championId, source.picks[3].championId] = [
      source.picks[3].championId,
      source.picks[0].championId,
    ];
    [source.picks[2].championId, source.picks[4].championId] = [
      source.picks[4].championId,
      source.picks[2].championId,
    ];
    const input = createEngineInput(source);
    expect(input.actors[0]).toMatchObject({
      position: 'TOP',
      championId: 'Jinx',
    });
    expect(input.actors[2]).toMatchObject({
      position: 'MID',
      championId: 'Lulu',
    });
  });

  it('uses form, condition and feedback once and bounds execution separately from champion stats', () => {
    const source = options();
    const normal = createEngineInput(source).actors[0];
    source.teams[0].players[0].condition = 10;
    source.teams[0].players[0].form = 5;
    const tired = createEngineInput(source).actors[0];
    expect(tired.execution).toBeLessThan(normal.execution);
    expect(tired.profile).toEqual(normal.profile);
    source.teams[0].players[0].feedback = {
      mental: -20,
      form: -5,
      confidence: -20,
      motivation: -20,
      pressure: 20,
      aggression: 20,
      riskTaking: 20,
      carryBonus: -4,
    };
    const pressured = createEngineInput(source).actors[0];
    expect(pressured.execution).toBeLessThan(tired.execution);
    expect(pressured.aggression).toBeGreaterThan(tired.aggression);
    expect(pressured.risk).toBeGreaterThan(tired.risk);
    expect(pressured.form).toBe(5);
    expect(pressured.playerStats.mental).toBe(80);
    expect(pressured.execution).toBeGreaterThanOrEqual(0);
    expect(pressured.execution).toBeLessThanOrEqual(1.19);
  });

  it('applies off-role and known role proficiency only to execution, not the original card or champion HP', () => {
    const source = options();
    const native = createEngineInput(source).actors[0];
    source.teams[0].players[0].positionProficiency = 0;
    const offRole = createEngineInput(source).actors[0];
    expect(offRole.execution).toBeCloseTo(native.execution * 0.6);
    expect(offRole.profile).toEqual(native.profile);
    expect(offRole.playerStats).toEqual(native.playerStats);
    source.teams[0].players[0].roleProficiency = 0;
    expect(createEngineInput(source).actors[0].execution).toBeCloseTo(
      offRole.execution * 0.94,
    );
  });

  it('uses stable side and position ordering independent of input array ordering', () => {
    const source = options();
    const original = createEngineInput(source);
    source.teams.reverse();
    source.teams.forEach((team) => team.players.reverse());
    source.picks.reverse();
    const reversed = createEngineInput(source);
    expect(reversed.actors).toEqual(original.actors);
    expect(reversed.teams.map((team) => team.side)).toEqual(['BLUE', 'RED']);
  });

  it.each([
    [
      'non-finite stat',
      (source: EngineInputOptions) => {
        source.teams[0].players[0].mechanics = NaN;
      },
    ],
    [
      'stat above 119',
      (source: EngineInputOptions) => {
        source.teams[0].players[0].mechanics = 120;
      },
    ],
    [
      'negative condition',
      (source: EngineInputOptions) => {
        source.teams[0].players[0].condition = -1;
      },
    ],
    [
      'missing mastery',
      (source: EngineInputOptions) => {
        source.teams[0].players[0].roleProficiency =
          undefined as unknown as number;
      },
    ],
    [
      'duplicate player',
      (source: EngineInputOptions) => {
        source.teams[1].players[0].careerPlayerId =
          source.teams[0].players[0].careerPlayerId;
      },
    ],
    [
      'duplicate position',
      (source: EngineInputOptions) => {
        source.teams[0].players[0].position = Position.MID;
      },
    ],
    [
      'duplicate champion',
      (source: EngineInputOptions) => {
        source.picks[0].championId = source.picks[1].championId;
      },
    ],
    [
      'foreign pick',
      (source: EngineInputOptions) => {
        source.picks[0].teamId = 999;
      },
    ],
    [
      'missing pick',
      (source: EngineInputOptions) => {
        source.picks.pop();
      },
    ],
    [
      'unknown champion',
      (source: EngineInputOptions) => {
        source.picks[0].championId = 'FAKE';
      },
    ],
    [
      'foreign side',
      (source: EngineInputOptions) => {
        source.blueTeamId = 999;
      },
    ],
    [
      'negative seed',
      (source: EngineInputOptions) => {
        source.seed = -1;
      },
    ],
    [
      'fractional seed',
      (source: EngineInputOptions) => {
        source.seed = 0.5;
      },
    ],
  ])(
    'rejects %s instead of silently filling an effective stat',
    (_name, mutate) => {
      const source = options();
      mutate(source);
      expect(() => createEngineInput(source)).toThrow();
    },
  );
});
