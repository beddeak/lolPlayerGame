import { Position } from '../players/enums/position.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { CHAMPIONS, CHAMPIONS_BY_ID, type Champion } from './champion-catalog';
import {
  chooseChampion,
  chooseChampionAssignment,
  chooseChampionSelection,
  rankChampionChoices,
} from './champion-draft-ai';
import { getDraftPlan, type DraftPlanId } from './draft-ai-strategy';
import {
  autoCompleteDraft,
  type DraftAction,
  type DraftState,
  type DraftTeam,
} from './draft-state';

const team = (id: number): DraftTeam => ({
  id,
  code: `T${id}`,
  strategy: TeamStrategy.BALANCED,
  players: Object.values(Position).map((position, index) => ({
    id: id * 10 + index,
    nickname: 'Player',
    position,
    instruction: null,
    roleProficiency: null,
    typeProficiencies: {},
    abilities: { mechanics: 85, laning: 85, teamFight: 85 },
  })),
});
const state = (seed = 123): DraftState => ({
  version: 3,
  aiSeed: seed,
  blue: team(1),
  red: team(2),
  managedTeamId: 1,
  gameNumber: 1,
  fearless: true,
  unavailable: [],
  actions: [],
  completed: false,
  deadline: null,
});
const champions = (...ids: string[]) =>
  ids.map((id) => CHAMPIONS_BY_ID.get(id)!);
// Public partial drafts for scoring tests; sequencing/validation is covered by
// champion-draft.spec.ts. No private opponent plan is injected here.
function withPicks(
  input: DraftState,
  blue: string[],
  red: string[] = [],
): DraftState {
  return {
    ...input,
    actions: [
      ...blue.map((variantId): DraftAction => ({
        side: 'BLUE',
        kind: 'PICK',
        variantId,
        automatic: false,
      })),
      ...red.map((variantId): DraftAction => ({
        side: 'RED',
        kind: 'PICK',
        variantId,
        automatic: false,
      })),
    ],
  };
}
function planned(id: DraftPlanId): DraftState {
  for (let seed = 1; seed <= 300; seed++) {
    const candidate = state(seed);
    if (getDraftPlan(candidate, candidate.blue.id).id === id) return candidate;
  }
  throw new Error(`No deterministic fixture for ${id}`);
}
function scores(input: DraftState, candidates: Champion[]) {
  return new Map(
    rankChampionChoices(input, 'BLUE', 'PICK', candidates).map((row) => [
      row.champion.id,
      row.score,
    ]),
  );
}

describe('strategic champion draft AI', () => {
  it('keeps a team/set plan through picks, bans, reloads and a side swap', () => {
    const initial = state();
    const plan = getDraftPlan(initial, initial.blue.id);
    const progressed = withPicks(initial, ['Jinx'], ['Orianna']);
    progressed.actions.push({
      side: 'BLUE',
      kind: 'BAN',
      variantId: 'Zed',
      automatic: true,
    });
    expect(getDraftPlan(progressed, initial.blue.id)).toEqual(plan);
    expect(
      getDraftPlan(JSON.parse(JSON.stringify(progressed)) as DraftState, 1),
    ).toEqual(plan);
    expect(
      getDraftPlan({ ...initial, blue: initial.red, red: initial.blue }, 1),
    ).toEqual(plan);
  });

  it('supports old snapshots without an AI seed, independent of side order', () => {
    const legacy = state();
    delete legacy.aiSeed;
    expect(
      getDraftPlan({ ...legacy, blue: legacy.red, red: legacy.blue }, 1),
    ).toEqual(getDraftPlan(legacy, 1));
    expect(chooseChampion(legacy, 'BLUE', 'BAN', CHAMPIONS).id).toBe(
      chooseChampion(legacy, 'BLUE', 'BAN', CHAMPIONS).id,
    );
  });

  it('uses multiple coherent plans across sets and series, not a fixed style', () => {
    const plans = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (let gameNumber = 1; gameNumber <= 5; gameNumber++) {
        plans.add(getDraftPlan({ ...state(seed), gameNumber }, 1).id);
      }
    }
    expect(plans.size).toBe(6);
  });

  it('produces different actual tempo, scaling and poke profiles over complete drafts', () => {
    const profiles = new Map<
      DraftPlanId,
      Array<{ early: number; late: number; range: number }>
    >();
    for (let seed = 1; seed <= 24; seed++) {
      const input = state(seed);
      const complete = autoCompleteDraft(input, 0);
      for (const side of ['BLUE', 'RED'] as const) {
        const plan = getDraftPlan(
          input,
          input[side === 'BLUE' ? 'blue' : 'red'].id,
        );
        const picks = complete.actions
          .filter((action) => action.side === side && action.kind === 'PICK')
          .map((action) => CHAMPIONS_BY_ID.get(action.variantId)!);
        const average = (key: 'early' | 'late' | 'range') =>
          picks.reduce((sum, champion) => sum + champion[key], 0) /
          picks.length;
        const group = profiles.get(plan.id) ?? [];
        group.push({
          early: average('early'),
          late: average('late'),
          range: average('range'),
        });
        profiles.set(plan.id, group);
      }
    }
    expect(profiles.size).toBe(6);
    const mean = (plan: DraftPlanId, key: 'early' | 'late' | 'range') => {
      const rows = profiles.get(plan)!;
      expect(rows.length).toBeGreaterThan(1);
      return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    };
    expect(mean('TEMPO', 'early')).toBeGreaterThan(
      mean('SCALING', 'early') + 10,
    );
    expect(mean('SCALING', 'late')).toBeGreaterThan(mean('TEMPO', 'late') + 8);
    expect(mean('POKE', 'range')).toBeGreaterThan(
      mean('TEAMFIGHT', 'range') + 10,
    );
  });

  it('prefers Draven for tempo and Jinx for scaling with the same roster', () => {
    const candidates = champions('Jinx', 'Draven');
    const tempo = scores(planned('TEMPO'), candidates);
    const scaling = scores(planned('SCALING'), candidates);
    expect(tempo.get('Draven')!).toBeGreaterThan(tempo.get('Jinx')!);
    expect(scaling.get('Jinx')!).toBeGreaterThan(scaling.get('Draven')!);
  });

  it('increases the value of protection when the opponent reveals hard engage', () => {
    const base = withPicks(planned('TEAMFIGHT'), [
      'Gnar',
      'LeeSin',
      'Orianna',
      'Jinx',
    ]);
    const candidates = champions('Lulu', 'Pyke');
    const neutral = scores(base, candidates);
    const revealed = scores(
      withPicks(
        base,
        ['Gnar', 'LeeSin', 'Orianna', 'Jinx'],
        ['Rell', 'Malphite', 'JarvanIV'],
      ),
      candidates,
    );
    expect(revealed.get('Lulu')! - neutral.get('Lulu')!).toBeGreaterThan(
      revealed.get('Pyke')! - neutral.get('Pyke')!,
    );
  });

  it('increases damage/scaling priority against a revealed frontline', () => {
    const base = withPicks(planned('TEAMFIGHT'), [
      'Renekton',
      'LeeSin',
      'Orianna',
      'Lulu',
    ]);
    const candidates = champions('Vayne', 'Sona');
    const neutral = scores(base, candidates);
    const revealed = scores(
      withPicks(
        base,
        ['Renekton', 'LeeSin', 'Orianna', 'Lulu'],
        ['Ornn', 'Rammus', 'Malphite'],
      ),
      candidates,
    );
    expect(revealed.get('Vayne')! - neutral.get('Vayne')!).toBeGreaterThan(
      revealed.get('Sona')! - neutral.get('Sona')!,
    );
  });

  it('charges a ban opportunity cost for a valuable champion we can first-pick', () => {
    const first = planned('SCALING');
    const second: DraftState = {
      ...first,
      selection: {
        firstSelectionTeamId: 1,
        policy: 'RANDOM',
        choices: [
          { teamId: 1, choice: 'SECOND_PICK', automatic: false },
          { teamId: 2, choice: 'RED', automatic: false },
        ],
        blueTeamId: 1,
        redTeamId: 2,
        firstPickTeamId: 2,
        secondPickTeamId: 1,
      },
    };
    const candidates = champions('Jinx', 'Draven', 'Vayne');
    const firstRows = rankChampionChoices(first, 'BLUE', 'BAN', candidates);
    const secondRows = rankChampionChoices(second, 'BLUE', 'BAN', candidates);
    const jinx = firstRows.find((row) => row.champion.id === 'Jinx')!;
    expect(jinx.score).toBeLessThan(
      secondRows.find((row) => row.champion.id === 'Jinx')!.score,
    );
    expect(jinx.reasons).toContain('우리 선픽 후보를 밴하는 비용 반영');
  });

  it('values denying a strong slot more when available replacements are weak', () => {
    const input = state();
    // Controlled same-slot profiles isolate replacement scarcity from roster,
    // champion lane fit and own first-pick reservation.
    const original = CHAMPIONS_BY_ID.get('Jinx')!;
    const clone = (id: string, reduction: number): Champion => ({
      ...original,
      id,
      early: original.early - reduction,
      mid: original.mid - reduction,
      late: original.late - reduction,
      scaling: original.scaling - reduction,
    });
    const target = clone('target', 0);
    const close = [target, ...[1, 2, 3, 4].map((i) => clone(`close${i}`, 1))];
    const weak = [target, ...[1, 2, 3, 4].map((i) => clone(`weak${i}`, 25))];
    const closeScore = rankChampionChoices(input, 'BLUE', 'BAN', close).find(
      (row) => row.champion.id === target.id,
    )!.score;
    const weakChoice = rankChampionChoices(input, 'BLUE', 'BAN', weak).find(
      (row) => row.champion.id === target.id,
    )!;
    expect(weakChoice.score).toBeGreaterThan(closeScore);
    expect(weakChoice.reasons).toContain('대체재가 적은 상대 포지션 공략');
  });

  it('recognizes a slot with no substitute instead of treating it as abundant', () => {
    const input = state();
    const target = CHAMPIONS_BY_ID.get('Jinx')!;
    const abundant = [
      target,
      ...[1, 2, 3, 4].map((i) => ({ ...target, id: `substitute${i}` })),
    ];
    const denseScore = rankChampionChoices(input, 'BLUE', 'BAN', abundant).find(
      (row) => row.champion.id === target.id,
    )!.score;
    const scarce = rankChampionChoices(input, 'BLUE', 'BAN', [target])[0];
    expect(scarce.score).toBeGreaterThan(denseScore);
    expect(scarce.reasons).toContain('대체재가 적은 상대 포지션 공략');
  });

  it('finishes a weak four-support composition with output instead of a fifth enchanter', () => {
    const input = withPicks(planned('SCALING'), [
      'Lulu',
      'Braum',
      'Janna',
      'Soraka',
    ]);
    const candidates = champions('Jinx', 'Milio', 'Yuumi');
    expect(
      rankChampionChoices(input, 'BLUE', 'PICK', candidates)[0].champion.id,
    ).toBe('Jinx');
    expect(chooseChampion(input, 'BLUE', 'PICK', candidates).id).toBe('Jinx');
  });

  it('never escapes the supplied legal pool or mutates caller state/catalog', () => {
    const input = withPicks(state(), ['Ashe']);
    input.unavailable = ['Jinx'];
    input.actions.push({
      side: 'RED',
      kind: 'BAN',
      variantId: 'Draven',
      automatic: false,
    });
    const candidates = champions('Ashe', 'Jinx', 'Draven', 'Yuumi', 'Yuumi');
    const before = JSON.stringify({ input, candidates });
    expect(rankChampionChoices(input, 'BLUE', 'PICK', candidates)).toHaveLength(
      1,
    );
    expect(chooseChampion(input, 'BLUE', 'PICK', candidates).id).toBe('Yuumi');
    expect(() =>
      chooseChampion(input, 'BLUE', 'BAN', champions('Ashe', 'Jinx', 'Draven')),
    ).toThrow('No legal champion remains');
    expect(JSON.stringify({ input, candidates })).toBe(before);
  });

  it('maintains five unique assignments and explanation metadata in a complete draft', () => {
    const input = state(20);
    const ranked = rankChampionChoices(input, 'BLUE', 'PICK', CHAMPIONS);
    expect(ranked).toHaveLength(CHAMPIONS.length);
    for (const row of ranked) {
      expect(Number.isFinite(row.score)).toBe(true);
      expect(Object.values(Position)).toContain(row.position);
      expect(row.reasons.length).toBeGreaterThan(0);
    }
    const complete = autoCompleteDraft(input, 0);
    for (const side of ['BLUE', 'RED'] as const) {
      const assigned = chooseChampionAssignment(complete, side);
      const actual = complete.actions
        .filter((action) => action.side === side && action.kind === 'PICK')
        .map((action) => action.variantId);
      expect(Object.keys(assigned).sort()).toEqual(
        Object.values(Position).sort(),
      );
      expect(new Set(Object.values(assigned))).toEqual(new Set(actual));
      expect(chooseChampionAssignment(complete, side)).toEqual(assigned);
    }
  });

  it('returns only allowed first-selection dimensions and handles empty choices', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(['BLUE', 'RED']).toContain(
        chooseChampionSelection(state(seed), 1, ['BLUE', 'RED']),
      );
      expect(['FIRST_PICK', 'SECOND_PICK']).toContain(
        chooseChampionSelection(state(seed), 1, ['FIRST_PICK', 'SECOND_PICK']),
      );
    }
    expect(() => chooseChampionSelection(state(), 1, [])).toThrow(
      'No legal selection remains',
    );
  });
});
