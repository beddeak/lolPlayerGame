import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { createLabInput } from './test-fixtures';
import { createBattleRuleset } from './battle-rules';
import { battlePublicInformation, planBattleActors } from './battle-planner';
import { startSimulation } from './engine';
import { observe } from './observation';
import { canonicalHash, createRandomStreams } from './seeded-rng';

function planningFixture(strategy: TeamStrategy) {
  const input = createLabInput(17);
  input.rules = createBattleRuleset();
  input.teams[0].strategy = strategy;
  const state = startSimulation(input);
  // A legal scenario snapshot: developed actors, no contested objective or visible
  // champion fight. Strategy should influence a feasible rotation here.
  for (const actor of state.actors.filter((value) => value.side === 'BLUE')) {
    actor.level = 10;
    actor.position = { x: 5000, y: 5000 };
  }
  return state;
}

describe('tactics consumed by actual battle decisions', () => {
  it('changes a safe feasible rotation while leaving combat profiles and rewards untouched', () => {
    const top = planningFixture(TeamStrategy.TOP_CARRY);
    const bot = planningFixture(TeamStrategy.BOT_CARRY);
    const topBefore = canonicalHash({ actors: top.actors, ledger: top.ledger });
    const botBefore = canonicalHash({ actors: bot.actors, ledger: bot.ledger });
    const first = planBattleActors(
      observe(top, 'BLUE'),
      top.input,
      createRandomStreams(17),
      battlePublicInformation(top, 'BLUE'),
    );
    const second = planBattleActors(
      observe(bot, 'BLUE'),
      bot.input,
      createRandomStreams(17),
      battlePublicInformation(bot, 'BLUE'),
    );
    const carry = top.actors.find(
      (actor) => actor.side === 'BLUE' && actor.input.position === 'ADC',
    )!;
    expect(first.plans[carry.id].kind).toBe('SIEGE');
    expect(second.plans[carry.id].kind).toBe('SIEGE');
    expect(first.plans[carry.id].reason).toContain('TOP');
    expect(second.plans[carry.id].reason).toContain('BOT');
    expect(
      first.intents.find((intent) => intent.actorId === carry.id),
    ).not.toEqual(second.intents.find((intent) => intent.actorId === carry.id));
    expect(canonicalHash({ actors: top.actors, ledger: top.ledger })).toBe(
      topBefore,
    );
    expect(canonicalHash({ actors: bot.actors, ledger: bot.ledger })).toBe(
      botBefore,
    );
  });

  it('uses the same own observation despite hidden enemy current HP or positions changing', () => {
    const state = planningFixture(TeamStrategy.BOT_CARRY);
    const observation = observe(state, 'BLUE');
    const before = planBattleActors(
      observation,
      state.input,
      createRandomStreams(17),
      battlePublicInformation(state, 'BLUE'),
    );
    for (const actor of state.actors.filter((value) => value.side === 'RED')) {
      actor.position = { x: 9100, y: 700 };
      actor.hp = 1;
      actor.mana = 0;
    }
    const after = planBattleActors(
      observation,
      state.input,
      createRandomStreams(17),
      battlePublicInformation(state, 'BLUE'),
    );
    expect(after).toEqual(before);
  });
});
