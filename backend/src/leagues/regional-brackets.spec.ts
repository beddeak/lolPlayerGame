import {
  bracketRanking,
  nextBracketSlots,
  regionalBracket,
} from './regional-brackets';
import { lcpSwissRound } from './lcp-swiss';

describe('six-region fixed brackets', () => {
  it.each([
    'DOUBLE_SIX',
    'HYBRID_SIX',
    'DOUBLE_FOUR',
    'CBLOL_PLAY_IN',
  ] as const)(
    '%s completes across all result patterns without self-pairings',
    (template) => {
      const ids = Array.from(
        { length: template.includes('SIX') ? 6 : 4 },
        (_, index) => index + 1,
      );
      const count = regionalBracket(template, ids, []).games.length;
      for (let mask = 0; mask < 2 ** count; mask++) {
        const results: Array<{
          stageFixtureNumber: number;
          winnerTeamId: number;
        }> = [];
        let slots = nextBracketSlots(regionalBracket(template, ids, results));
        while (slots.length) {
          for (const slot of slots) {
            expect(slot.teamAId).not.toBe(slot.teamBId);
            expect(ids).toEqual(
              expect.arrayContaining([slot.teamAId, slot.teamBId]),
            );
            results.push({
              stageFixtureNumber: slot.stageFixtureNumber!,
              winnerTeamId:
                mask & (1 << (slot.stageFixtureNumber! - 1))
                  ? slot.teamAId
                  : slot.teamBId,
            });
          }
          expect(results.length).toBeLessThanOrEqual(count);
          slots = nextBracketSlots(regionalBracket(template, ids, results));
        }
        expect(results).toHaveLength(count);
        const ranked = bracketRanking(
          regionalBracket(template, ids, results),
          ids,
        );
        expect(new Set(ranked).size).toBe(ids.length);
        if (template !== 'CBLOL_PLAY_IN')
          expect(ranked[0]).toBe(results.at(-1)!.winnerTeamId);
      }
    },
  );

  it('LCP Swiss reaches four qualifiers, with separate final seeding matches, across 500 patterns', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let seed = 1; seed <= 500; seed++) {
      let random = seed;
      const records = new Map(ids.map((id) => [id, { wins: 0, losses: 0 }]));
      const results: Array<{
        roundNumber: number;
        teamAId: number;
        teamBId: number;
        winnerTeamId: number;
      }> = [];
      let slots = lcpSwissRound(ids, results);
      while (slots.length) {
        expect(slots[0].roundNumber).toBeLessThanOrEqual(6);
        for (const slot of slots) {
          const a = records.get(slot.teamAId)!,
            b = records.get(slot.teamBId)!;
          if (slot.roundNumber <= 5) {
            expect(Math.max(a.wins, a.losses, b.wins, b.losses)).toBeLessThan(
              3,
            );
            expect(slot.bestOf).toBe(
              [a, b].some((row) => row.wins === 2 || row.losses === 2) ? 5 : 3,
            );
          }
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          const winner = random & 0x80000000 ? slot.teamAId : slot.teamBId;
          if (slot.roundNumber <= 5) {
            records.get(winner)!.wins++;
            records.get(winner === slot.teamAId ? slot.teamBId : slot.teamAId)!
              .losses++;
          }
          results.push({ ...slot, winnerTeamId: winner });
        }
        slots = lcpSwissRound(ids, results);
      }
      expect(
        [...records.values()].filter((row) => row.wins === 3),
      ).toHaveLength(4);
      expect(
        [...records.values()].filter((row) => row.losses === 3),
      ).toHaveLength(4);
      expect(results.some((row) => row.roundNumber === 6)).toBe(true);
    }
  });
});
