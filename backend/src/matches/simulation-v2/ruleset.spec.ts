import { CLASSIC_SR_26_1_APPROX_V1, createRuleset } from './ruleset';

describe('26.1 tactical laboratory ruleset', () => {
  it('pins verified Classic timing without importing Swiftplay timings', () => {
    const rules = createRuleset();
    expect(rules.version).toBe('CLASSIC_SR_26_1_APPROX_V1');
    expect(rules.sourcePatch).toBe('26.1');
    expect(rules.waveStartMs).toBe(30_000);
    expect(rules.campSpawnTimesMs).toEqual({
      standard: 55_000,
      delayed: 67_000,
    });
    expect(rules.passiveGoldStartMs).toBe(65_000);
    expect(rules.recallMs).toBe(8000);
    expect(
      rules.objectives.map(({ id, spawnAtMs }) => [id, spawnAtMs]),
    ).toEqual([
      ['VOID_GRUBS', 480_000],
      ['RIFT_HERALD', 900_000],
      ['BARON', 1_200_000],
    ]);
    expect(
      rules.objectives.every(
        (objective) => objective.capability === 'UNSUPPORTED',
      ),
    ).toBe(true);
    expect(rules.provenance.timings).toContain('patch-26-1-notes');
    expect(rules.provenance.objectiveTimes).toContain('patch-25-09-notes');
  });

  it('explicitly bounds the early development horizon without claiming victory or full abilities', () => {
    const rules = createRuleset();
    expect(rules.stepMs).toBe(100);
    expect(rules.maxHorizonMs).toBe(600_000);
    expect(rules.maxHorizonMs % rules.stepMs).toBe(0);
    expect(rules.capabilities.nexusVictory).toBe('UNSUPPORTED');
    expect(rules.capabilities.championAbilities).toBe('UNSUPPORTED');
    expect(rules.capabilities.roleQuests).toBe('UNSUPPORTED');
    expect(rules.capabilities.championMastery).toBe('UNSUPPORTED');
    expect(rules.provenance.unresolvedObjectives).toContain('conflict');
    expect(rules.provenance.economy).toContain('MODEL');
    expect(rules.provenance.camps).toContain('MODEL');
    expect(rules.provenance.items).toContain('MODEL');
  });

  it('has a finite increasing XP progression and explicitly priced approximate items', () => {
    const rules = createRuleset();
    expect(rules.levelXp).toHaveLength(rules.maxLevel);
    expect(rules.levelXp[0]).toBe(0);
    expect(rules.levelXp.slice(1).every((xp, i) => xp > rules.levelXp[i])).toBe(
      true,
    );
    expect(
      rules.items.every((item) => Number.isFinite(item.cost) && item.cost > 0),
    ).toBe(true);
    expect(new Set(rules.items.map((item) => item.id)).size).toBe(
      rules.items.length,
    );
  });

  it('cannot mutate the shared template through a returned ruleset', () => {
    const first = createRuleset();
    first.objectives[0].spawnAtMs = 1;
    first.capabilities.nexusVictory = 'SUPPORTED';
    first.levelXp[1] = 1;
    expect(createRuleset()).toEqual(CLASSIC_SR_26_1_APPROX_V1);
    expect(Object.isFrozen(CLASSIC_SR_26_1_APPROX_V1)).toBe(true);
    expect(Object.isFrozen(CLASSIC_SR_26_1_APPROX_V1.objectives[0])).toBe(true);
  });
});
