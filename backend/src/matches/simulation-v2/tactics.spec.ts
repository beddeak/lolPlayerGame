import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { createLabInput } from './test-fixtures';
import { createNeutralMeta, tacticalPolicy, validateMeta } from './tactics';
import { canonicalHash } from './seeded-rng';

describe('neutral tactical environment and one-time proficiency consumers', () => {
  it('keeps supported meta neutral and detached, rejecting unimplemented buffs', () => {
    const meta = createNeutralMeta();
    expect(() => validateMeta(meta)).not.toThrow();
    expect(meta).toEqual(createNeutralMeta());
    meta.objectivePriority = 1.1;
    expect(() => validateMeta(meta)).toThrow('Unsupported tactical meta');
    expect(createNeutralMeta().objectivePriority).toBe(1);
    expect(() =>
      validateMeta({ ...createNeutralMeta(), visionPriority: NaN }),
    ).toThrow();
  });

  it('makes strategy change decision preferences without rewriting combat input', () => {
    const input = createLabInput();
    const actor = input.actors[1];
    input.teams[0].strategy = 'TOP_CARRY';
    const initialStats = canonicalHash(input.actors);
    const top = tacticalPolicy(input, actor);
    input.teams[0].strategy = 'BOT_CARRY';
    const bot = tacticalPolicy(input, actor);
    expect(top.lanePriority.TOP).toBeGreaterThan(top.lanePriority.BOT);
    expect(bot.lanePriority.BOT).toBeGreaterThan(bot.lanePriority.TOP);
    expect(canonicalHash(input.actors)).toBe(initialStats);
    expect(top.coordination).toBe(bot.coordination);
  });

  it.each([
    ['BALANCED', 'MID'],
    ['TOP_CARRY', 'TOP'],
    ['TOP_JUNGLE', 'TOP'],
    ['MID_CARRY', 'MID'],
    ['MID_JUNGLE', 'MID'],
    ['UPPER_SIDE', 'TOP'],
    ['BOT_CARRY', 'BOT'],
    ['BOT_PRESSURE', 'BOT'],
  ] as const)('maps %s into bounded preferences', (strategy, preferred) => {
    const input = createLabInput();
    input.teams[0].strategy = strategy;
    const policy = tacticalPolicy(input, input.actors[0]);
    expect(policy.lanePriority[preferred]).toBeGreaterThanOrEqual(1);
    for (const weight of Object.values(policy.lanePriority)) {
      expect(weight).toBeGreaterThanOrEqual(0.85);
      expect(weight).toBeLessThanOrEqual(1.4);
    }
  });

  it('uses team proficiency for coordination, not role/position/execution again', () => {
    const input = createLabInput();
    const actor = input.actors[0];
    input.teams[0].strategyProficiency = 0;
    const low = tacticalPolicy(input, actor);
    input.teams[0].strategyProficiency = 100;
    const high = tacticalPolicy(input, actor);
    expect(high.coordination).toBeGreaterThan(low.coordination);
    actor.roleProficiency = 0;
    actor.positionProficiency = 0;
    actor.execution = 0;
    expect(tacticalPolicy(input, actor)).toEqual(high);
    expect(high.coordination).toBeLessThanOrEqual(1);
    expect(low.coordination).toBeGreaterThanOrEqual(0.35);
  });

  it('treats role instructions as preferences, never as free resource income', () => {
    const input = createLabInput();
    const actor = input.actors[1];
    actor.sourcePlayer!.playerInstruction = PlayerInstruction.PLAY_FOR_BOT;
    expect(tacticalPolicy(input, actor).lanePriority.BOT).toBe(1.1);
    actor.sourcePlayer!.playerInstruction = PlayerInstruction.OBJECTIVE;
    expect(tacticalPolicy(input, actor).objectivePriority).toBe(1.15);
    actor.sourcePlayer!.playerInstruction = PlayerInstruction.WEAK_SIDE;
    expect(tacticalPolicy(input, actor).resourcePriority).toBe(0.85);
    actor.sourcePlayer!.playerInstruction = PlayerInstruction.HYPER_CARRY;
    expect(tacticalPolicy(input, actor).resourcePriority).toBe(1.15);
    expect(actor.playerStats.mechanics).toBe(85);
  });

  it('rejects foreign teams, unknown strategies and invalid proficiency', () => {
    const input = createLabInput();
    const actor = input.actors[0];
    expect(() => tacticalPolicy(input, { ...actor, teamId: 999 })).toThrow(
      'does not belong',
    );
    input.teams[0].strategy = 'FREE_WIN';
    expect(() => tacticalPolicy(input, actor)).toThrow('Unsupported tactical');
    input.teams[0].strategy = 'BALANCED';
    input.teams[0].strategyProficiency = 101;
    expect(() => tacticalPolicy(input, actor)).toThrow('Invalid tactical');
  });
});
