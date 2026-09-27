import { performance } from 'node:perf_hooks';
import type { FirstSelection } from '../src/drafts/draft-state';
import type { SimpleMatchTeamInput } from '../src/matches/simulation/simple-match.types';
import { createBattleRuleset } from '../src/matches/simulation-v2/battle-rules';
import { runUntil, startSimulation } from '../src/matches/simulation-v2/engine';
import { canonicalHash } from '../src/matches/simulation-v2/seeded-rng';
import {
  autoDraftSeries,
  beginSeriesDraft,
  completeSeriesGame,
  createSeriesLab,
  prepareSeriesGame,
} from '../src/matches/simulation-v2/series-lab';
import { createLabInput } from '../src/matches/simulation-v2/test-fixtures';
import {
  checkpoint,
  restoreCheckpoint,
  type SimulationCheckpoint,
} from '../src/matches/simulation-v2/world-state';

export interface TacticalSeriesOptions {
  seed: number;
  minutes: number;
  bestOf: 1 | 3 | 5;
  verifyResume: boolean;
}
const USAGE =
  'Usage: npm run sim:series -- [--seed 0..4294967295] [--minutes 1..60] [--best-of 1|3|5] [--verify-resume]';

export function parseTacticalSeriesOptions(
  args: string[],
): TacticalSeriesOptions {
  const result: TacticalSeriesOptions = {
    seed: 123,
    minutes: 40,
    bestOf: 5,
    verifyResume: false,
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--seed', '--minutes', '--best-of', '--verify-resume'].includes(flag))
      throw new Error(`Unknown argument ${flag}. ${USAGE}`);
    if (seen.has(flag)) throw new Error(`Repeated argument ${flag}. ${USAGE}`);
    seen.add(flag);
    if (flag === '--verify-resume') {
      result.verifyResume = true;
      continue;
    }
    const raw = args[++i];
    if (!raw || !/^(0|[1-9]\d*)$/.test(raw))
      throw new Error(`Expected integer for ${flag}. ${USAGE}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(USAGE);
    if (flag === '--seed' && value <= 0xffff_ffff) result.seed = value;
    else if (flag === '--minutes' && value >= 1 && value <= 60)
      result.minutes = value;
    else if (flag === '--best-of' && [1, 3, 5].includes(value))
      result.bestOf = value as TacticalSeriesOptions['bestOf'];
    else throw new Error(`Out-of-range ${flag}. ${USAGE}`);
  }
  return result;
}

/** Pure-fixture full series. No DB, filesystem/network write, or legacy match reroll. */
export function runTacticalSeriesLab(
  options: TacticalSeriesOptions,
  progress?: (message: string) => void,
) {
  // Validate direct function calls too, before any simulation CPU is spent.
  const verified = parseTacticalSeriesOptions([
    '--seed',
    String(options.seed),
    '--minutes',
    String(options.minutes),
    '--best-of',
    String(options.bestOf),
    ...(options.verifyResume ? ['--verify-resume'] : []),
  ]);
  const template = createLabInput(verified.seed);
  template.rules = createBattleRuleset();
  const teams = template.teams.map((team) =>
    structuredClone(team.sourceTeam!),
  ) as [SimpleMatchTeamInput, SimpleMatchTeamInput];
  // Fixture policy only: production supplies its already-resolved competition
  // policy. This deterministic laboratory coin is not a playoff seed lookup.
  const chooser =
    Number.parseInt(
      canonicalHash({ seed: options.seed, phase: 'FIRST_SELECTION' }).slice(
        0,
        8,
      ),
      16,
    ) < 0x8000_0000
      ? 1
      : 2;
  const firstSelection: FirstSelection = {
    firstSelectionTeamId: chooser,
    policy: 'RANDOM',
    choices: [],
    blueTeamId: null,
    redTeamId: null,
    firstPickTeamId: null,
    secondPickTeamId: null,
  };
  let series = createSeriesLab({
    seed: verified.seed,
    bestOf: verified.bestOf,
    template,
    firstSelection,
  });
  const start = performance.now();
  const games: Array<{
    gameNumber: number;
    status: string;
    winnerTeamId: number | null;
    durationMs: number;
    simulationWallMs: number;
    eventCount: number;
    kills: Record<string, number>;
    inputHash: string;
    eventsHash: string;
    picks: string[];
    bans: string[];
    resumeVerified: boolean;
  }> = [];
  let stopped: {
    gameNumber: number;
    reason: string;
    engineStatus: string;
  } | null = null;
  const target = verified.minutes * 60_000;
  while (
    series.winnerTeamId === null &&
    series.games.length < verified.bestOf
  ) {
    series = prepareSeriesGame(
      autoDraftSeries(beginSeriesDraft(series, teams)),
    );
    const draft = series.active!.draft;
    const game = startSimulation(series.active!.input!);
    progress?.(
      `Set ${draft.gameNumber}: draft complete, engine seed ${game.input.seed}`,
    );
    const runStart = performance.now();
    let saved: SimulationCheckpoint | null = null;
    for (
      let at = 30_000;
      at <= target && game.status === 'RUNNING';
      at += 30_000
    ) {
      runUntil(game, at);
      if (verified.verifyResume && saved === null && game.status === 'RUNNING')
        saved = JSON.parse(
          JSON.stringify(checkpoint(game)),
        ) as SimulationCheckpoint;
      if (at % 300_000 === 0)
        progress?.(
          `Set ${draft.gameNumber}: ${Math.floor(game.simTimeMs / 60_000)} minutes, ${game.status}`,
        );
    }
    const simulationWallMs =
      Math.round((performance.now() - runStart) * 100) / 100;
    let resumeVerified = false;
    if (saved && game.status !== 'ERROR') {
      const resumed = restoreCheckpoint(saved);
      runUntil(resumed, target);
      if (canonicalHash(resumed) !== canonicalHash(game))
        throw new Error(`Set ${draft.gameNumber}: checkpoint replay mismatch`);
      resumeVerified = true;
    }
    games.push({
      gameNumber: draft.gameNumber,
      status: game.status,
      winnerTeamId: game.winnerTeamId,
      durationMs: game.simTimeMs,
      simulationWallMs,
      eventCount: game.events.length,
      kills: Object.fromEntries(
        series.teamIds.map((id) => [
          String(id),
          game.actors
            .filter((actor) => actor.input.teamId === id)
            .reduce((sum, actor) => sum + actor.stats.kills, 0),
        ]),
      ),
      inputHash: game.inputHash,
      eventsHash: canonicalHash(game.events),
      picks: draft.actions
        .filter((action) => action.kind === 'PICK')
        .map((action) => action.variantId),
      bans: draft.actions
        .filter((action) => action.kind === 'BAN')
        .map((action) => action.variantId),
      resumeVerified,
    });
    if (game.status !== 'FINISHED') {
      stopped = {
        gameNumber: draft.gameNumber,
        reason:
          game.error ??
          'Requested simulation horizon reached without a destroyed nexus',
        engineStatus: game.status,
      };
      // Do not consume picks, award a score or start the next set on a timeout.
      break;
    }
    series = completeSeriesGame(series, game);
    progress?.(
      `Set ${draft.gameNumber}: team ${game.winnerTeamId} won by nexus destruction`,
    );
  }
  return {
    mode: 'NON_COMMITTING_TACTICAL_SERIES_LAB',
    status: series.winnerTeamId === null ? 'INCOMPLETE' : 'FINISHED',
    options: verified,
    winnerTeamId: series.winnerTeamId,
    completedSets: series.games.length,
    score: Object.fromEntries(
      series.teamIds.map((id) => [
        String(id),
        series.games.filter((game) => game.winnerTeamId === id).length,
      ]),
    ),
    elapsedWallMs: Math.round((performance.now() - start) * 100) / 100,
    environmentHash: series.environmentHash,
    fearlessUsedPickCount: series.games.reduce(
      (count, game) => count + game.picks.length,
      0,
    ),
    databaseWrites: 0,
    stopped,
    scope:
      'Synthetic teams and deterministic fixture coin; actual real-champion drafts and physical engine results. BO5 stops at three wins; never forces five sets or a timeout winner. No career form/condition mutation or database access.',
    games,
  };
}

if (require.main === module) {
  try {
    const result = runTacticalSeriesLab(
      parseTacticalSeriesOptions(process.argv.slice(2)),
      (message) => process.stderr.write(`${message}\n`),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'FINISHED') process.exitCode = 2;
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
