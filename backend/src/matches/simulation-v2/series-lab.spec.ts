import type { FirstSelection } from '../../drafts/draft-state';
import { availableVariants, currentTurn } from '../../drafts/draft-state';
import { Position } from '../../players/enums/position.enum';
import type { SimpleMatchTeamInput } from '../simulation/simple-match.types';
import { emit, type EngineState, type UnitState } from './contracts';
import { startSimulation } from './engine';
import {
  assignForSeries,
  autoDraftSeries,
  beginSeriesDraft,
  completeSeriesGame,
  createSeriesLab,
  draftForSeries,
  prepareSeriesGame,
  selectForSeries,
  type SeriesLabState,
} from './series-lab';
import { createLabInput } from './test-fixtures';
import { canonicalHash } from './seeded-rng';
import { createBattleRuleset } from './battle-rules';

const selection = (): FirstSelection => ({
  policy: 'RANDOM',
  firstSelectionTeamId: 1,
  choices: [],
  blueTeamId: null,
  redTeamId: null,
  firstPickTeamId: null,
  secondPickTeamId: null,
});
const teams = (): [SimpleMatchTeamInput, SimpleMatchTeamInput] => {
  const template = createLabInput();
  return [
    structuredClone(template.teams[0].sourceTeam!),
    structuredClone(template.teams[1].sourceTeam!),
  ];
};
const series = (bestOf: 1 | 3 | 5 = 5) => {
  const template = createLabInput();
  template.rules = createBattleRuleset();
  return createSeriesLab({
    bestOf,
    seed: 935,
    template,
    firstSelection: selection(),
  });
};
const prepared = (state = series(), nextTeams = teams()) =>
  prepareSeriesGame(autoDraftSeries(beginSeriesDraft(state, nextTeams)));

/**
 * Protocol fixture only: this suite tests receipt validation and set boundaries,
 * not win balance. Resolver's physical Nexus destruction has separate tests.
 */
function terminalReceipt(
  state: SeriesLabState,
  winnerTeamId: number,
): EngineState {
  const game = startSimulation(state.active!.input!);
  game.simTimeMs = 1000;
  game.status = 'FINISHED';
  game.winnerTeamId = winnerTeamId;
  const winner = game.actors.find(
    (actor) => actor.input.teamId === winnerTeamId,
  )!;
  game.units = game.input.teams.map((team): UnitState => ({
    id: `structure:${team.side}:NEXUS`,
    kind: 'NEXUS',
    side: team.side,
    position: { ...game.input.map.bases[team.side] },
    origin: { ...game.input.map.bases[team.side] },
    lane: null,
    hp: team.teamId === winnerTeamId ? 1000 : 0,
    maxHp: 1000,
    armor: 0,
    attackDamage: 0,
    attackRange: 0,
    attackIntervalMs: 1000,
    moveSpeed: 0,
    nextAttackAtMs: 0,
    path: [],
    active: team.teamId === winnerTeamId,
    spawnAtMs: 0,
    respawnAtMs: null,
    generation: 0,
    reward: { gold: 0, xp: 0, cs: 0 },
  }));
  const nexus = game.units.find((unit) => !unit.active)!;
  emit(game, {
    kind: 'DAMAGE',
    actorId: winner.id,
    targetId: nexus.id,
    amount: 10,
  });
  emit(game, { kind: 'NEXUS_DESTROYED', targetId: nexus.id });
  return game;
}

describe('tactical series lab / real champion Fearless boundaries', () => {
  it('reproduces identical draft and input after JSON reload without rerolling', () => {
    const current = beginSeriesDraft(series(), teams());
    const first = preparedFromActive(current);
    const restored = JSON.parse(JSON.stringify(current)) as SeriesLabState;
    const second = preparedFromActive(restored);
    expect(canonicalHash(first)).toBe(canonicalHash(second));
    expect(first.active!.input!.meta).toEqual(first.environment.meta);
    expect(first.active!.inputHash).toBe(second.active!.inputHash);
  });

  it('preserves a frozen transcript through serialized set completion and next-set reload', () => {
    const ready = prepared();
    const restored = JSON.parse(JSON.stringify(ready)) as SeriesLabState;
    expect(restored.active!.draftHash).toBe(
      canonicalHash(restored.active!.draft),
    );
    const game = terminalReceipt(restored, 1);
    const completed = completeSeriesGame(restored, game);
    expect(completed.games[0].picks).toEqual(
      restored.active!.input!.actors.map((actor) => actor.championId),
    );
    const reloaded = JSON.parse(JSON.stringify(completed)) as SeriesLabState;
    expect(canonicalHash(beginSeriesDraft(reloaded, teams()))).toBe(
      canonicalHash(beginSeriesDraft(completed, teams())),
    );
  });

  it.each(['pick', 'ban', 'selection', 'assignment', 'missing-hash'] as const)(
    'rejects %s transcript changes made after preparing the engine input',
    (part) => {
      const ready = prepared();
      const game = terminalReceipt(ready, 1);
      const initialInputHash = ready.active!.inputHash;
      const changed = structuredClone(ready);
      const draft = changed.active!.draft;
      if (part === 'pick')
        draft.actions.find((action) => action.kind === 'PICK')!.variantId =
          'INVALID_CHAMPION_ID';
      else if (part === 'ban')
        draft.actions.find((action) => action.kind === 'BAN')!.variantId =
          'INVALID_CHAMPION_ID';
      else if (part === 'selection')
        draft.selection!.firstPickTeamId = draft.selection!.secondPickTeamId;
      else if (part === 'assignment') {
        const lineup = draft.assignments!.BLUE;
        [lineup.TOP, lineup.MID] = [lineup.MID, lineup.TOP];
      } else changed.active!.draftHash = null;
      expect(changed.active!.inputHash).toBe(initialInputHash);
      expect(() => completeSeriesGame(changed, game)).toThrow(
        'draft transcript',
      );
      expect(changed.games).toHaveLength(0);
      expect(changed.winnerTeamId).toBeNull();
      expect(completeSeriesGame(ready, game).games).toHaveLength(1);
    },
  );

  it('finishes BO1 without carrying a nonexistent second-set Fearless pool', () => {
    const ready = prepared(series(1));
    expect(ready.fearless).toBe(false);
    const completed = completeSeriesGame(ready, terminalReceipt(ready, 1));
    expect(completed.winnerTeamId).toBe(1);
    expect(completed.games).toHaveLength(1);
    expect(() => beginSeriesDraft(completed, teams())).toThrow();
  });

  it('keeps first pick independent of physical BLUE/RED selection', () => {
    let value = beginSeriesDraft(series(), teams());
    value = selectForSeries(value, 'FIRST_PICK');
    value = selectForSeries(value, 'BLUE');
    expect(value.active!.draft.blue.id).toBe(2);
    expect(value.active!.draft.red.id).toBe(1);
    expect(currentTurn(value.active!.draft)).toEqual({
      side: 'RED',
      kind: 'BAN',
    });
    value = prepareSeriesGame(autoDraftSeries(value));
    expect(value.active!.input!.teams[0].teamId).toBe(2);
    expect(value.active!.input!.teams[0].side).toBe('BLUE');
  });

  it('completes five legal sets, using 50 unique picks and resetting ordinary bans', () => {
    let value = series();
    const outcomes = [1, 2, 1, 2, 1];
    const allPicks = new Set<string>();
    for (let set = 0; set < 5; set++) {
      value = beginSeriesDraft(value, teams());
      const draft = value.active!.draft;
      expect(draft.actions).toEqual([]);
      expect(draft.unavailable).toHaveLength(set * 10);
      if (set > 0) {
        expect(draft.selection!.policy).toBe('PREVIOUS_LOSER');
        expect(draft.selection!.firstSelectionTeamId).toBe(
          outcomes[set - 1] === 1 ? 2 : 1,
        );
        const previousBans = value.games.at(-1)!.bans;
        expect(
          previousBans.every((id) => !draft.unavailable.includes(id)),
        ).toBe(true);
      }
      value = preparedFromActive(value);
      expect(
        value.active!.draft.actions.filter((a) => a.kind === 'PICK'),
      ).toHaveLength(10);
      expect(
        value.active!.draft.actions.filter((a) => a.kind === 'BAN'),
      ).toHaveLength(10);
      const game = terminalReceipt(value, outcomes[set]);
      const original = canonicalHash(value);
      const next = completeSeriesGame(value, game);
      expect(canonicalHash(value)).toBe(original);
      for (const id of next.games.at(-1)!.picks) {
        expect(allPicks.has(id)).toBe(false);
        allPicks.add(id);
      }
      expect(() => completeSeriesGame(next, game)).toThrow('No active');
      value = next;
    }
    expect(allPicks.size).toBe(50);
    expect(value.games).toHaveLength(5);
    expect(value.winnerTeamId).toBe(1);
    expect(() => beginSeriesDraft(value, teams())).toThrow('winner');
  }, 30_000);

  it('stops BO3 on two wins and never permits a fourth set', () => {
    let value = series(3);
    for (let set = 0; set < 2; set++) {
      value = prepared(value);
      value = completeSeriesGame(value, terminalReceipt(value, 2));
    }
    expect(value.winnerTeamId).toBe(2);
    expect(value.games).toHaveLength(2);
    expect(() => beginSeriesDraft(value, teams())).toThrow();
  }, 20_000);

  it('requires an actual finished nexus receipt, not timeout or a winner flag alone', () => {
    const value = prepared();
    const game = terminalReceipt(value, 1);
    game.status = 'HORIZON_REACHED';
    expect(() => completeSeriesGame(value, game)).toThrow('Only a finished');
    game.status = 'FINISHED';
    game.units.find((unit) => !unit.active)!.hp = 10;
    expect(() => completeSeriesGame(value, game)).toThrow('physical nexus');
    game.units.find((unit) => !unit.active)!.hp = 0;
    game.events = game.events.filter((event) => event.kind !== 'DAMAGE');
    expect(() => completeSeriesGame(value, game)).toThrow('physical nexus');
  });

  it('rejects ambiguous double-nexus and foreign damage evidence', () => {
    const value = prepared();
    const game = terminalReceipt(value, 1);
    const own = game.units.find((unit) => unit.active)!;
    own.active = false;
    own.hp = 0;
    expect(() => completeSeriesGame(value, game)).toThrow('physical nexus');
    own.active = true;
    own.hp = 1000;
    game.events.find((event) => event.kind === 'DAMAGE')!.actorId =
      game.actors.find((actor) => actor.input.teamId === 2)!.id;
    expect(() => completeSeriesGame(value, game)).toThrow('physical nexus');
  });

  it('rejects mismatched seeds, changed pinned rules and stale completed-set responses', () => {
    const value = prepared();
    const wrong = terminalReceipt(value, 1);
    wrong.input = structuredClone(wrong.input);
    wrong.input.seed++;
    expect(() => completeSeriesGame(value, wrong)).toThrow('pinned input');
    const changed = structuredClone(value);
    changed.environment.rules.killGold++;
    expect(() =>
      completeSeriesGame(changed, terminalReceipt(value, 1)),
    ).toThrow('environment');
    const old = terminalReceipt(value, 1);
    const next = prepared(completeSeriesGame(value, old));
    expect(() => completeSeriesGame(next, old)).toThrow('pinned input');
  }, 20_000);

  it('restarts HP/XP/gold and snapshots only explicit between-set career/feedback inputs', () => {
    const first = prepared();
    const firstInputHash = first.active!.inputHash;
    const receipt = terminalReceipt(first, 1);
    receipt.actors[0].hp = 1;
    receipt.actors[0].gold = 9999;
    receipt.actors[0].level = 18;
    receipt.actors[0].xp = 9999;
    const newTeams = teams();
    newTeams[0].players[0].condition = 64;
    newTeams[0].players[0].form = 72;
    newTeams[0].players[0].mechanics = 119;
    let second = completeSeriesGame(first, receipt);
    second = prepared(second, newTeams);
    const started = startSimulation(second.active!.input!);
    const actor = started.actors.find((p) => p.input.careerPlayerId === 100)!;
    expect(actor.hp).toBe(actor.maxHp);
    expect(actor.gold).toBe(started.input.rules.startingGold);
    expect(actor.level).toBe(1);
    expect(actor.xp).toBe(0);
    expect(actor.input.condition).toBe(64);
    expect(actor.input.form).toBe(72);
    expect(actor.input.playerStats.mechanics).toBe(119);
    expect(first.active!.inputHash).toBe(firstInputHash);
    expect(
      first.active!.input!.actors.find((p) => p.careerPlayerId === 100)!
        .condition,
    ).toBe(100);
  }, 20_000);

  it('allows all picked champions in all positions and rejects unpicked substitutions', () => {
    let value = autoDraftSeries(beginSeriesDraft(series(), teams()));
    const picked = value.active!.draft.actions.filter(
      (a) => a.kind === 'PICK' && a.side === 'BLUE',
    );
    value = assignForSeries(
      value,
      'BLUE',
      Object.values(Position).map((position, i) => ({
        position,
        championId: picked[4 - i].variantId,
      })),
    );
    const ready = prepareSeriesGame(value);
    expect(
      ready.active!.input!.actors.find(
        (p) => p.side === 'BLUE' && p.position === 'TOP',
      )!.championId,
    ).toBe(picked[4].variantId);
    expect(() =>
      assignForSeries(
        value,
        'BLUE',
        Object.values(Position).map((position) => ({
          position,
          championId: 'Garen',
        })),
      ),
    ).toThrow();
    const corrupted = structuredClone(value);
    corrupted.active!.draft.actions[0].variantId = picked[0].variantId;
    expect(() => prepareSeriesGame(corrupted)).toThrow();
  });

  it('does not silently reuse a banned or previously picked champion', () => {
    let value = beginSeriesDraft(series(), teams());
    value = selectForSeries(selectForSeries(value, 'BLUE'), 'FIRST_PICK');
    value = draftForSeries(value, 'Garen');
    expect(() => draftForSeries(value, 'Garen')).toThrow('not available');
    value = prepareSeriesGame(autoDraftSeries(value));
    const next = beginSeriesDraft(
      completeSeriesGame(value, terminalReceipt(value, 1)),
      teams(),
    );
    const selected = value.active!.draft.actions.find(
      (action) => action.kind === 'PICK',
    )!.variantId;
    const ready = selectForSeries(selectForSeries(next, 'BLUE'), 'FIRST_PICK');
    expect(
      availableVariants(ready.active!.draft).some((c) => c.id === selected),
    ).toBe(false);
    expect(
      availableVariants(ready.active!.draft).some((c) => c.id === 'Garen'),
    ).toBe(true);
  }, 20_000);

  it.each(['RANDOM', 'HIGHER_SEED', 'UPPER_BRACKET'] as const)(
    'preserves externally resolved %s policy',
    (policy) => {
      const value = createSeriesLab({
        seed: 1,
        bestOf: 3,
        template: createLabInput(),
        firstSelection: { ...selection(), policy, firstSelectionTeamId: 2 },
      });
      expect(
        beginSeriesDraft(value, teams()).active!.draft.selection!
          .firstSelectionTeamId,
      ).toBe(2);
    },
  );

  it('requires coherent resolved LCP 2v2 results, not silently falling back to coin toss', () => {
    const first: FirstSelection = {
      ...selection(),
      policy: 'LCP_2V2',
      firstSelectionTeamId: 2,
      showdown: {
        teamAId: 1,
        teamBId: 2,
        teamAPlayerIds: [100, 101],
        teamBPlayerIds: [200, 201],
        teamAScore: 80,
        teamBScore: 90,
      },
    };
    expect(
      createSeriesLab({
        seed: 1,
        bestOf: 3,
        template: createLabInput(),
        firstSelection: first,
      }).firstSelection,
    ).toEqual(first);
    first.firstSelectionTeamId = 1;
    expect(() =>
      createSeriesLab({
        seed: 1,
        bestOf: 3,
        template: createLabInput(),
        firstSelection: first,
      }),
    ).toThrow('LCP showdown');
  });
});

function preparedFromActive(value: SeriesLabState): SeriesLabState {
  return prepareSeriesGame(autoDraftSeries(value));
}
