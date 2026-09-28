import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { calculatePostMatchPlayerState } from '../simulation/player-match-state';
import { adaptTacticalResult } from './career-result';
import { createBattleRuleset } from './battle-rules';
import { grantReward } from './economy-ledger';
import { queueCommand, runUntil, startSimulation } from './engine';
import { projectMatch } from './projection';
import { canonicalHash } from './seeded-rng';
import { createLabInput } from './test-fixtures';

/** Arrange a reachable last-hit scenario; Resolver, not the test, selects winner. */
function finishedBattle() {
  const input = createLabInput(918);
  input.rules = createBattleRuleset();
  input.controlMode = 'SCRIPTED';
  const state = startSimulation(input);
  const killer = state.actors[0],
    victim = state.actors[5];
  killer.position = { x: 7500, y: 7500 };
  victim.position = { ...killer.position };
  victim.hp = 1;
  queueCommand(state, {
    id: 'last-champion-hit',
    atMs: 0,
    intent: {
      kind: 'ATTACK',
      actorId: killer.id,
      targetId: victim.id,
      reason: 'adapter test',
    },
  });
  runUntil(state, 1000);
  const nexus = state.units.find(
    (unit) => unit.kind === 'NEXUS' && unit.side === 'RED',
  )!;
  for (const unit of state.units.filter(
    (unit) => unit.structure && unit.side === 'RED' && unit.id !== nexus.id,
  )) {
    unit.hp = 0;
    unit.active = false;
  }
  nexus.hp = 1;
  killer.position = { ...nexus.position };
  grantReward(state, {
    key: 'fractional-audit',
    actorId: killer.id,
    sourceId: 'fractional-audit',
    kind: 'PASSIVE',
    gold: 0.125,
    xp: 0,
    cs: 0,
  });
  queueCommand(state, {
    id: 'last-nexus-hit',
    atMs: 1100,
    intent: {
      kind: 'ATTACK',
      actorId: killer.id,
      targetId: nexus.id,
      reason: 'adapter test',
    },
  });
  runUntil(state, 2000);
  expect(state.status).toBe('FINISHED');
  expect(state.events.some((event) => event.kind === 'NEXUS_DESTROYED')).toBe(
    true,
  );
  return state;
}

describe('actual tactical result → career persistence', () => {
  it('uses the physically destroyed nexus winner and exact ledger statistics without generating a second result', () => {
    const state = finishedBattle();
    const report = projectMatch(state);
    const before = canonicalHash({ input: state.input, report });
    const actual = adaptTacticalResult(
      state.input,
      report,
      TeamStrategy.BALANCED,
    );
    expect(actual.result.winnerTeamId).toBe(state.winnerTeamId);
    expect(actual.result.seed).toBe(918);
    expect(actual.statsResult.durationMinutes).toBe(state.simTimeMs / 60_000);
    expect(actual.statsResult.teams[0].teamKills).toBe(1);
    expect(actual.statsResult.teams[1].teamKills).toBe(0);
    for (const team of actual.statsResult.teams) {
      for (const player of team.playerStats) {
        const projected = report.players.find(
          (entry) => entry.careerPlayerId === player.careerPlayerId,
        )!;
        for (const key of [
          'kills',
          'deaths',
          'assists',
          'kda',
          'dpm',
          'damageShare',
          'goldShare',
          'kp',
          'gdAt15',
          'csdAt15',
        ] as const)
          expect(player[key]).toBe(projected[key]);
        expect(player.gold).toBe(projected.goldEarned);
        expect(player.gdAt15).toBeNull();
        expect(player.csdAt15).toBeNull();
      }
    }
    const first = actual.statsResult.teams[0].playerStats[0];
    expect(first.gold % 1).toBe(0.125);
    const source = state.input.actors[0].sourcePlayer!;
    const after = calculatePostMatchPlayerState(
      source,
      first.rating,
      actual.statsResult.durationMinutes,
      true,
    );
    expect([first.formAfter, first.conditionAfter, first.mentalAfter]).toEqual([
      after.form,
      after.condition,
      after.mental,
    ]);
    expect(first.conditionAfter).toBeLessThan(source.condition);
    expect(canonicalHash({ input: state.input, report })).toBe(before);
    expect(
      adaptTacticalResult(state.input, report, TeamStrategy.BALANCED),
    ).toEqual(actual);
  });

  it('refuses unfinished, foreign and non-finite reports before career mutations', () => {
    const state = finishedBattle();
    const report = projectMatch(state);
    expect(() =>
      adaptTacticalResult(
        state.input,
        { ...report, status: 'HORIZON_REACHED' },
        TeamStrategy.BALANCED,
      ),
    ).toThrow('finished');
    expect(() =>
      adaptTacticalResult(
        state.input,
        { ...report, winnerTeamId: 99 },
        TeamStrategy.BALANCED,
      ),
    ).toThrow('pinned');
    const foreign = structuredClone(report);
    foreign.players[0].careerPlayerId = 999;
    expect(() =>
      adaptTacticalResult(state.input, foreign, TeamStrategy.BALANCED),
    ).toThrow('pinned player');
    const broken = structuredClone(report);
    broken.players[0].dpm = Number.NaN;
    expect(() =>
      adaptTacticalResult(state.input, broken, TeamStrategy.BALANCED),
    ).toThrow('non-finite');
  });

  it('retains exact signed 15-minute snapshots when they actually exist', () => {
    const state = finishedBattle();
    state.simTimeMs = 900_000;
    state.at15 = Object.fromEntries(
      state.actors.map((actor) => [
        actor.id,
        {
          goldEarned: actor.side === 'BLUE' ? 5000.125 : 4500,
          cs: actor.side === 'BLUE' ? 120 : 100,
        },
      ]),
    );
    const actual = adaptTacticalResult(
      state.input,
      projectMatch(state),
      TeamStrategy.BALANCED,
    );
    expect(actual.statsResult.teams[0].playerStats[0]).toMatchObject({
      gdAt15: 500.125,
      csdAt15: 20,
    });
    expect(actual.statsResult.teams[1].playerStats[0]).toMatchObject({
      gdAt15: -500.125,
      csdAt15: -20,
    });
  });
});
