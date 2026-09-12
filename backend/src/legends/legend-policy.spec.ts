import { LEGEND_EVENT_CONFIG, planLegendSeason } from './legend-policy';

describe('planLegendSeason', () => {
  const candidates = [
    { themeId: 1, playerCardIds: [11, 12] },
    { themeId: 2, playerCardIds: [21, 22] },
    { themeId: 3, playerCardIds: [31, 32] },
  ];

  it('replays the same hidden seed, independently of catalog ordering, without mutating inputs', () => {
    const original = structuredClone(candidates);
    const plan = planLegendSeason('private-seed', 2026, 2, candidates);
    expect(
      planLegendSeason('private-seed', 2026, 2, [...candidates].reverse()),
    ).toEqual(plan);
    expect(candidates).toEqual(original);
    expect(plan.events.length).toBeGreaterThanOrEqual(1);
    expect(plan.zeroEventStreak).toBe(0);
  });

  it('caps counts by distinct eligible themes and never emits empty or duplicate events', () => {
    const catalog = [
      { themeId: 1, playerCardIds: [11, 11] },
      { themeId: 1, playerCardIds: [12] },
      { themeId: 2, playerCardIds: [] },
    ];
    const plan = planLegendSeason('capacity', 2026, 2, catalog);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].themeId).toBe(1);
    expect(plan.events[0].playerCardIds).toEqual([11, 12]);
    expect(plan.events[0].revealDate).toMatch(/^2026-\d{2}-\d{2}$/);
    expect(planLegendSeason('empty', 2026, 2, []).events).toEqual([]);
    expect(planLegendSeason('empty', 2026, 2, []).zeroEventStreak).toBe(3);
  });

  it('applies pity and keeps unique reveal dates inside the configured offseason interval', () => {
    for (let index = 0; index < 200; index += 1) {
      const plan = planLegendSeason(`window:${index}`, 2028, 2, candidates);
      expect(plan.events.length).toBeGreaterThanOrEqual(1);
      expect(plan.events.length).toBeLessThanOrEqual(
        LEGEND_EVENT_CONFIG.maxEvents,
      );
      expect(new Set(plan.events.map((event) => event.themeId)).size).toBe(
        plan.events.length,
      );
      expect(new Set(plan.events.map((event) => event.revealDate)).size).toBe(
        plan.events.length,
      );
      for (const event of plan.events) {
        expect(
          event.revealDate >= '2028-11-20' && event.revealDate <= '2028-12-20',
        ).toBe(true);
      }
      expect(plan.events.map((event) => event.revealDate)).toEqual(
        plan.events.map((event) => event.revealDate).sort(),
      );
    }
  });

  it('produces the configured 0/1/2 distribution and reduces zero-event seasons after a miss', () => {
    const normal = [0, 0, 0];
    const boosted = [0, 0, 0];
    const samples = 6000;
    for (let index = 0; index < samples; index += 1) {
      normal[
        planLegendSeason(
          `distribution:${index}`,
          2026,
          0,
          candidates,
        ).events.length
      ] += 1;
      boosted[
        planLegendSeason(
          `distribution:${index}`,
          2026,
          1,
          candidates,
        ).events.length
      ] += 1;
    }
    for (let count = 0; count <= 2; count += 1) {
      expect(
        Math.abs(
          normal[count] / samples -
            LEGEND_EVENT_CONFIG.probabilities.normal[count],
        ),
      ).toBeLessThan(0.025);
      expect(
        Math.abs(
          boosted[count] / samples -
            LEGEND_EVENT_CONFIG.probabilities.afterZeroSeason[count],
        ),
      ).toBeLessThan(0.025);
    }
    expect(boosted[0]).toBeLessThan(normal[0]);
  });

  it('rejects invalid years, streaks and candidate identifiers', () => {
    expect(() => planLegendSeason('bad', 0, 0, candidates)).toThrow();
    expect(() => planLegendSeason('bad', 2026, -1, candidates)).toThrow();
    expect(() =>
      planLegendSeason('bad', 2026, 0, [{ themeId: 1, playerCardIds: [0] }]),
    ).toThrow();
  });
});
