import {
  createCrossGroupSchedule,
  createDoubleRoundRobinSchedule,
  createRoundRobinSchedule,
  createSwissRoundSchedule,
  deriveLeagueFixtureSeed,
} from './league-schedule';

describe('league schedule', () => {
  it('creates a home-and-away schedule for two teams', () => {
    expect(createDoubleRoundRobinSchedule([1, 2])).toEqual([
      { roundNumber: 1, teamAId: 1, teamBId: 2 },
      { roundNumber: 2, teamAId: 2, teamBId: 1 },
    ]);
  });

  it('schedules every four-team pairing twice without round conflicts', () => {
    const schedule = createDoubleRoundRobinSchedule([1, 2, 3, 4]);

    expect(schedule).toHaveLength(12);
    expect(new Set(schedule.map((slot) => slot.roundNumber)).size).toBe(6);

    for (let roundNumber = 1; roundNumber <= 6; roundNumber += 1) {
      const teamIds = schedule
        .filter((slot) => slot.roundNumber === roundNumber)
        .flatMap((slot) => [slot.teamAId, slot.teamBId]);

      expect(teamIds.sort()).toEqual([1, 2, 3, 4]);
    }

    const pairingCounts = new Map<string, number>();

    for (const slot of schedule) {
      const key = [slot.teamAId, slot.teamBId].sort().join(':');
      pairingCounts.set(key, (pairingCounts.get(key) ?? 0) + 1);
    }

    expect([...pairingCounts.values()]).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('derives a stable unsigned fixture seed', () => {
    const seed = deriveLeagueFixtureSeed(1, 2026, 1, 1);

    expect(seed).toBe(deriveLeagueFixtureSeed(1, 2026, 1, 1));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffff_ffff);
    expect(seed).not.toBe(deriveLeagueFixtureSeed(1, 2026, 1, 2));
  });

  it('creates a triple round robin for five teams', () => {
    const schedule = createRoundRobinSchedule([1, 2, 3, 4, 5], 3);

    expect(schedule).toHaveLength(30);
    expect(Math.max(...schedule.map((slot) => slot.roundNumber))).toBe(15);
  });

  it('creates only cross-group matches for the LCK group battle', () => {
    const firstGroup = [1, 3, 5, 7, 9];
    const secondGroup = [2, 4, 6, 8, 10];
    const schedule = createCrossGroupSchedule(firstGroup, secondGroup);

    expect(schedule).toHaveLength(25);
    expect(
      schedule.every(
        (slot) =>
          firstGroup.includes(slot.teamAId) &&
          secondGroup.includes(slot.teamBId),
      ),
    ).toBe(true);
    expect(new Set(schedule.map((slot) => slot.roundNumber)).size).toBe(5);
  });

  it('pairs Swiss teams by record without repeating prior opponents', () => {
    const schedule = createSwissRoundSchedule(
      [
        { teamId: 1, wins: 1, seed: 1 },
        { teamId: 2, wins: 1, seed: 2 },
        { teamId: 3, wins: 0, seed: 3 },
        { teamId: 4, wins: 0, seed: 4 },
      ],
      new Set(['1:2', '3:4']),
      2,
    );

    expect(schedule).toHaveLength(2);
    expect(
      schedule.map((slot) => [slot.teamAId, slot.teamBId].sort().join(':')),
    ).not.toContain('1:2');
  });
});
