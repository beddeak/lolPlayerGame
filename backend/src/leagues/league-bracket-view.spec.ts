import { buildBracketView } from './league-bracket-view';
import { regionalBracket, nextBracketSlots } from './regional-brackets';
import { resolveSlot } from '../internationals/tournament-engine';
import {
  LeagueStageResponseDto,
  LeagueFixtureResponseDto,
} from './dto/league-split-response.dto';
import { LeagueStageFormat as F } from './enums/league-stage-format.enum';
import { LeagueStageStatus as S } from './enums/league-stage-status.enum';
import { LeagueFixtureStatus as FS } from './enums/league-fixture-status.enum';
import { LeagueStageSettings } from './league-format.types';
const stage = (n = 6): LeagueStageResponseDto => ({
  id: 1,
  sequence: 1,
  code: 'PO',
  name: 'Playoffs',
  format: F.DOUBLE_ELIMINATION,
  status: S.ACTIVE,
  bestOf: 5,
  currentRound: 1,
  settings: {},
  fixtures: [],
  standings: [],
  participants: Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    teamCode: `T${i + 1}`,
    teamName: `Team ${i + 1}`,
    initialSeed: i + 1,
    groupCode: null,
  })),
});
const fixture = (
  key: number,
  round: number,
  a: number,
  b: number,
  winner: number | null,
): LeagueFixtureResponseDto => ({
  id: 100 + key,
  leagueStageId: 1,
  fixtureNumber: key,
  stageFixtureNumber: key,
  roundNumber: round,
  scheduledDate: '2026-02-01',
  bestOf: 5,
  seed: 1,
  status: winner === null ? FS.SCHEDULED : FS.COMPLETED,
  seriesId: null,
  teamA: { id: a, code: `T${a}`, name: 'A' },
  teamB: { id: b, code: `T${b}`, name: 'B' },
  teamAWins: winner === a ? 3 : 0,
  teamBWins: winner === b ? 3 : 0,
  winnerTeamId: winner,
});
describe('read-only bracket view', () => {
  it.each([F.ROUND_ROBIN, F.GROUP, F.SWISS])(
    'keeps standings for %s',
    (format) => expect(buildBracketView({ ...stage(), format })).toBeNull(),
  );
  it.each([
    'DOUBLE_SIX',
    'HYBRID_SIX',
    'DOUBLE_FOUR',
    'CBLOL_PLAY_IN',
  ] as NonNullable<LeagueStageSettings['bracket']>[])(
    'uses the exact engine edges for %s over complete outcomes',
    (template) => {
      const n = ['DOUBLE_SIX', 'HYBRID_SIX'].includes(template) ? 6 : 4;
      const s = stage(n);
      s.settings.bracket = template;
      for (let run = 0; run < 12; run++) {
        s.fixtures = [];
        for (let round = 0; round < 12; round++) {
          const graph = regionalBracket(
            template,
            s.participants.map((p) => p.teamId),
            s.fixtures.map((f) => ({
              stageFixtureNumber: f.stageFixtureNumber,
              winnerTeamId: f.winnerTeamId,
            })),
          );
          const view = buildBracketView(s)!;
          expect(view.dynamic).toBe(false);
          expect(view.nodes).toHaveLength(graph.games.length);
          for (const game of graph.games) {
            const node = view.nodes.find((n) => n.key === game.key)!;
            expect(node.a.teamId).toBe(resolveSlot(graph, game.a));
            expect(node.b.teamId).toBe(resolveSlot(graph, game.b));
            for (const side of ['a', 'b'] as const)
              if ('match' in game[side])
                expect(node[side].source).toEqual({
                  key: game[side].match,
                  result: game[side].result,
                });
          }
          const ready = nextBracketSlots(graph);
          if (!ready.length) break;
          for (const slot of ready)
            s.fixtures.push(
              fixture(
                slot.stageFixtureNumber!,
                slot.roundNumber,
                slot.teamAId,
                slot.teamBId,
                (run + slot.stageFixtureNumber!) % 2 === 0
                  ? slot.teamAId
                  : slot.teamBId,
              ),
            );
        }
      }
    },
  );
  it('retains CBLOL mixed BO3 and BO5 rather than labeling every match BO5', () => {
    const s = stage();
    s.settings.bracket = 'DOUBLE_SIX';
    const nodes = buildBracketView(s, true)!.nodes;
    expect(nodes[0].bestOf).toBe(3);
    expect(nodes.at(-1)!.bestOf).toBe(5);
  });
  it('shows gauntlet byes and winner destinations before fixtures exist', () => {
    const s = { ...stage(4), format: F.GAUNTLET };
    s.fixtures = [fixture(1, 1, 3, 4, 4)];
    const nodes = buildBracketView(s)!.nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toMatchObject({
      a: { teamId: 2 },
      b: { teamId: 4, source: { key: '1', result: 'WINNER' } },
    });
    expect(nodes[2].a.teamId).toBe(1);
    expect(nodes[2].lane).toBe('FINAL');
  });
  it('connects only known re-seeded matches and separates loser path', () => {
    const s = stage(4);
    s.fixtures = [
      fixture(1, 1, 1, 4, 1),
      fixture(2, 1, 2, 3, 2),
      fixture(3, 2, 3, 4, null),
      fixture(4, 2, 1, 2, null),
    ];
    const before = JSON.stringify(s),
      view = buildBracketView(s)!;
    expect(view.dynamic).toBe(true);
    expect(view.nodes).toHaveLength(4);
    expect(view.nodes[2]).toMatchObject({
      lane: 'LOWER',
      a: { source: { key: '2', result: 'LOSER' } },
      b: { source: { key: '1', result: 'LOSER' } },
    });
    expect(view.nodes[3].lane).toBe('UPPER');
    expect(JSON.stringify(s)).toBe(before);
  });
  it('does not fabricate winner/loser branches for existing single-round play-ins', () => {
    const s = { ...stage(4), format: F.PLAY_IN };
    s.fixtures = [fixture(1, 1, 1, 4, null), fixture(2, 1, 2, 3, null)];
    const view = buildBracketView(s)!;
    expect(view.dynamic).toBe(false);
    expect(
      view.nodes.every(
        (n) => n.lane === 'QUALIFIER' && !n.a.source && !n.b.source,
      ),
    ).toBe(true);
  });
});
