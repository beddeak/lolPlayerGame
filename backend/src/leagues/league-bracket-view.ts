import type { LeagueStageResponseDto } from './dto/league-split-response.dto';
import { regionalBracket } from './regional-brackets';
import { resolveSlot } from '../internationals/tournament-engine';
import type { Slot } from '../internationals/tournament.types';
import { LeagueStageFormat } from './enums/league-stage-format.enum';
import { LeagueStageStatus } from './enums/league-stage-status.enum';

export interface BracketSlotView {
  teamId: number | null;
  source?: { key: string; result: 'WINNER' | 'LOSER' };
}
export interface BracketNodeView {
  key: string;
  round: number;
  lane: 'UPPER' | 'LOWER' | 'FINAL' | 'QUALIFIER';
  label: string;
  bestOf: number;
  fixtureId: number | null;
  a: BracketSlotView;
  b: BracketSlotView;
}
export interface BracketView {
  nodes: BracketNodeView[];
  dynamic: boolean;
}
export function isKnockoutStage(format: string) {
  return [
    'PLAY_IN',
    'SINGLE_ELIMINATION',
    'DOUBLE_ELIMINATION',
    'GAUNTLET',
  ].includes(format);
}
/** Read-only projection. Never invents future pairings for the engine's re-seeded brackets. */
export function buildBracketView(
  stage: LeagueStageResponseDto,
  mixedUpper = false,
): BracketView | null {
  if (!isKnockoutStage(stage.format)) return null;
  const participants = [...stage.participants].sort(
    (a, b) => a.initialSeed - b.initialSeed,
  );
  const fixtures = [...stage.fixtures].sort(
    (a, b) =>
      a.roundNumber - b.roundNumber ||
      a.stageFixtureNumber - b.stageFixtureNumber,
  );
  const template = stage.settings.bracket;
  if (
    template &&
    participants.length >=
      (['DOUBLE_SIX', 'HYBRID_SIX'].includes(template) ? 6 : 4)
  ) {
    const graph = regionalBracket(
      template,
      participants.map((p) => p.teamId),
      fixtures.map((f) => ({
        stageFixtureNumber: f.stageFixtureNumber,
        winnerTeamId: f.winnerTeamId,
      })),
      mixedUpper,
    );
    const lower =
      template === 'DOUBLE_SIX'
        ? [5, 6, 8, 9]
        : template === 'HYBRID_SIX'
          ? [6, 7]
          : [4, 5];
    const slot = (s: Slot): BracketSlotView =>
      'teamId' in s
        ? { teamId: s.teamId }
        : {
            teamId: resolveSlot(graph, s),
            source: { key: s.match, result: s.result },
          };
    return {
      dynamic: false,
      nodes: graph.games.map((g, i) => {
        const f = fixtures.find((f) => String(f.stageFixtureNumber) === g.key);
        const lane: BracketNodeView['lane'] =
          template === 'CBLOL_PLAY_IN'
            ? 'QUALIFIER'
            : i === graph.games.length - 1
              ? 'FINAL'
              : lower.includes(Number(g.key))
                ? 'LOWER'
                : 'UPPER';
        return {
          key: g.key,
          round: g.round,
          lane,
          label:
            lane === 'FINAL'
              ? '결승'
              : `${lane === 'LOWER' ? '패자조' : lane === 'QUALIFIER' ? '진출 결정전' : '승자조'} · ${g.key}경기`,
          bestOf: f?.bestOf ?? g.bestOf,
          fixtureId: f?.id ?? null,
          a: slot(g.a),
          b: slot(g.b),
        };
      }),
    };
  }
  if (stage.format === LeagueStageFormat.GAUNTLET && participants.length >= 2) {
    const nodes: BracketNodeView[] = [];
    for (let round = 1; round < participants.length; round++) {
      const f = fixtures.find((f) => f.roundNumber === round);
      const prior = fixtures.find((f) => f.roundNumber === round - 1);
      nodes.push({
        key: String(round),
        round,
        lane: round === participants.length - 1 ? 'FINAL' : 'UPPER',
        label: round === participants.length - 1 ? '결승' : `${round}라운드`,
        bestOf: f?.bestOf ?? stage.bestOf,
        fixtureId: f?.id ?? null,
        a: { teamId: participants[participants.length - round - 1].teamId },
        b:
          round === 1
            ? { teamId: participants.at(-1)!.teamId }
            : {
                teamId: prior?.winnerTeamId ?? null,
                source: { key: String(round - 1), result: 'WINNER' },
              },
      });
    }
    return { dynamic: false, nodes };
  }
  const nodes = fixtures.map((f): BracketNodeView => {
    const prior = fixtures.filter((p) => p.roundNumber < f.roundNumber);
    const slot = (teamId: number): BracketSlotView => {
      const p = prior
        .filter(
          (p) =>
            p.winnerTeamId !== null &&
            [p.teamA.id, p.teamB.id].includes(teamId),
        )
        .at(-1);
      return {
        teamId,
        ...(p
          ? {
              source: {
                key: String(p.stageFixtureNumber),
                result:
                  p.winnerTeamId === teamId
                    ? ('WINNER' as const)
                    : ('LOSER' as const),
              },
            }
          : {}),
      };
    };
    const losses = (id: number) =>
      prior.filter(
        (p) =>
          p.winnerTeamId !== null &&
          p.winnerTeamId !== id &&
          [p.teamA.id, p.teamB.id].includes(id),
      ).length;
    const double = stage.format === LeagueStageFormat.DOUBLE_ELIMINATION;
    const alive = participants.filter(
      (p) => losses(p.teamId) < (double ? 2 : 1),
    );
    const lane: BracketNodeView['lane'] =
      stage.format === LeagueStageFormat.PLAY_IN
        ? 'QUALIFIER'
        : alive.length === 2
          ? 'FINAL'
          : double && (losses(f.teamA.id) > 0 || losses(f.teamB.id) > 0)
            ? 'LOWER'
            : 'UPPER';
    return {
      key: String(f.stageFixtureNumber),
      round: f.roundNumber,
      lane,
      label:
        lane === 'FINAL'
          ? '결승'
          : `${lane === 'LOWER' ? '패자조' : lane === 'QUALIFIER' ? '진출 결정전' : double ? '승자조' : '토너먼트'} · ${f.stageFixtureNumber}경기`,
      bestOf: f.bestOf,
      fixtureId: f.id,
      a: slot(f.teamA.id),
      b: slot(f.teamB.id),
    };
  });
  return {
    nodes,
    dynamic:
      stage.status !== LeagueStageStatus.COMPLETED &&
      stage.format !== LeagueStageFormat.PLAY_IN,
  };
}
