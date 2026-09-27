import {
  DraftState,
  DraftTeam,
  SelectionChoice,
  applySelection,
  autoCompleteDraft,
  currentTurn,
  selectionTurn,
  availableVariants,
} from './draft-state';
import { Position } from '../players/enums/position.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import {
  coinToss,
  firstGameSelection,
  showdown,
} from './first-selection-policy';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { EntityManager } from 'typeorm';
import { MatchSeries } from '../match-series/entities/match-series.entity';
const team = (id: number): DraftTeam => ({
  id,
  code: `T${id}`,
  strategy: TeamStrategy.BALANCED,
  players: Object.values(Position).map((position, i) => ({
    id: id * 10 + i,
    nickname: 'P',
    position,
    instruction: null,
    roleProficiency: null,
    typeProficiencies: {},
  })),
});
const empty = (): DraftState => ({
  version: 2,
  blue: team(1),
  red: team(2),
  managedTeamId: 1,
  gameNumber: 1,
  fearless: true,
  unavailable: [],
  actions: [],
  deadline: null,
  completed: false,
  selection: {
    firstSelectionTeamId: 1,
    policy: 'RANDOM',
    choices: [],
    blueTeamId: null,
    redTeamId: null,
    firstPickTeamId: null,
    secondPickTeamId: null,
  },
});
describe('First Selection independent map side and draft order', () => {
  it.each(['BLUE', 'RED', 'FIRST_PICK', 'SECOND_PICK'] as SelectionChoice[])(
    'supports either dimension first: %s',
    (choice) => {
      let state = empty();
      expect(currentTurn(state)).toBeNull();
      expect(availableVariants(state)).toHaveLength(0);
      state = applySelection(state, choice, false, 0);
      expect(selectionTurn(state)?.teamId).toBe(2);
      expect(() => applySelection(state, choice, false, 0)).toThrow();
      for (const second of selectionTurn(state)!.options) {
        const final = applySelection(state, second, false, 0);
        expect(selectionTurn(final)).toBeNull();
        expect(final.blue.id).toBe(final.selection!.blueTeamId);
        expect(final.red.id).toBe(final.selection!.redTeamId);
        expect(currentTurn(final)?.side).toBe(
          final.selection!.firstPickTeamId === final.blue.id ? 'BLUE' : 'RED',
        );
        expect(autoCompleteDraft(final, 0).actions).toHaveLength(20);
      }
    },
  );
  it('red can first-pick; five fearless games use 50 distinct picks, not previous standard bans', () => {
    const used: string[] = [];
    for (let n = 1; n <= 5; n++) {
      let state = { ...empty(), gameNumber: n, unavailable: [...used] };
      state = applySelection(
        applySelection(state, 'FIRST_PICK', false, 0),
        'BLUE',
        false,
        0,
      );
      expect(currentTurn(state)?.side).toBe('RED');
      const result = autoCompleteDraft(state, 0);
      expect(result.actions.every((a) => !used.includes(a.variantId))).toBe(
        true,
      );
      const picks = result.actions
        .filter((a) => a.kind === 'PICK')
        .map((a) => a.variantId);
      expect(picks).toHaveLength(10);
      used.push(...picks);
    }
    expect(new Set(used).size).toBe(50);
  });
  it('legacy drafts retain blue-first behavior', () => {
    const state = {
      ...empty(),
      version: 1 as const,
      selection: undefined,
      fearless: false,
    };
    expect(currentTurn(state)?.side).toBe('BLUE');
    expect(autoCompleteDraft(state, 0).completed).toBe(true);
  });
  it('coin toss is stable, with both outcomes across seeds', () => {
    expect(coinToss(55, 1, 2)).toBe(coinToss(55, 1, 2));
    expect(
      new Set(Array.from({ length: 100 }, (_, i) => coinToss(i, 1, 2))).size,
    ).toBe(2);
  });
  const series = { id: 5, seed: 21, teamAId: 1, teamBId: 2 } as MatchSeries;
  const manager = (fixture: unknown, matches: unknown[] = []) =>
    ({
      findOne: jest.fn().mockResolvedValue(fixture),
      find: jest.fn().mockResolvedValue(matches),
    }) as unknown as EntityManager;
  const fixture = (format: string) => ({
    leagueStageId: 3,
    leagueSplit: { region: 'LCK' },
    leagueStage: {
      format,
      settings: {},
      participants: [
        { careerTeamId: 1, initialSeed: 2 },
        { careerTeamId: 2, initialSeed: 1 },
      ],
    },
  });
  it('regular/play-in use coin toss, only playoffs use higher seed', async () => {
    for (const format of ['ROUND_ROBIN', 'GROUP', 'SWISS', 'PLAY_IN'])
      expect(
        (await firstGameSelection(manager(fixture(format)), series, [])).policy,
      ).toBe('RANDOM');
    expect(
      await firstGameSelection(
        manager(fixture('DOUBLE_ELIMINATION')),
        series,
        [],
      ),
    ).toMatchObject({ policy: 'HIGHER_SEED', firstSelectionTeamId: 2 });
  });
  it('upper bracket overrides higher seed in the final', async () => {
    const lost = {
      teamAId: 1,
      teamBId: 2,
      bestOf: 3,
      series: { id: 4, games: [{ winnerTeamId: 1 }, { winnerTeamId: 1 }] },
    };
    expect(
      await firstGameSelection(
        manager(fixture('DOUBLE_ELIMINATION'), [lost]),
        series,
        [],
      ),
    ).toMatchObject({ policy: 'UPPER_BRACKET', firstSelectionTeamId: 1 });
  });
  it('LCP uses a reproducible two-starter showdown, never bench; playoffs still use seed', async () => {
    const teams = [1, 2].map((id) => ({
      id,
      chemistry: 70,
      rosters: [1, 2, 3].map((n) => ({
        role: n === 3 ? RosterRole.BENCH : RosterRole.STARTER,
        careerPlayer: {
          id: id * 10 + n,
          currentMechanics: n === 3 ? 119 : 80,
          currentGameSense: 75,
        },
      })),
    })) as CareerTeam[];
    expect(showdown(teams[0], 21)).toEqual(showdown(teams[0], 21));
    expect(showdown(teams[0], 21).playerIds).toEqual([11, 12]);
    const f = { ...fixture('ROUND_ROBIN'), leagueSplit: { region: 'LCP' } };
    expect((await firstGameSelection(manager(f), series, teams)).policy).toBe(
      'LCP_2V2',
    );
    f.leagueStage.format = 'DOUBLE_ELIMINATION';
    expect((await firstGameSelection(manager(f), series, teams)).policy).toBe(
      'HIGHER_SEED',
    );
  });
});
