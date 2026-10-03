import { performance } from 'node:perf_hooks';
import type { FirstSelection } from '../src/drafts/draft-state';
import { createBattleRuleset } from '../src/matches/simulation-v2/battle-rules';
import { CURRENT_MACRO_AI } from '../src/matches/simulation-v2/contracts';
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
import type { SimpleMatchTeamInput } from '../src/matches/simulation/simple-match.types';
import { parseTacticalSeriesOptions } from './run-tactical-series-lab';
import { verifyBattleState } from './run-battle-lab';
import {
  checkpoint,
  restoreCheckpoint,
  type SimulationCheckpoint,
} from '../src/matches/simulation-v2/world-state';

/** Read-only set diagnostic; earlier sets use actual battles and series receipts. */
const args = process.argv.slice(2);
const seriesArgs: string[] = [];
let requestedGame = 1;
let gameSpecified = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--game') {
    seriesArgs.push(args[index]);
    continue;
  }
  if (gameSpecified) throw new Error('Repeated argument --game');
  const raw = args[++index];
  if (!raw || !/^[1-5]$/.test(raw))
    throw new Error('Expected --game 1..best-of');
  requestedGame = Number(raw);
  gameSpecified = true;
}
const options = parseTacticalSeriesOptions(seriesArgs);
if (requestedGame > options.bestOf)
  throw new Error('--game must not exceed --best-of');
const template = createLabInput(options.seed);
template.rules = createBattleRuleset();
if (options.coordinated) template.rules.macroAi = CURRENT_MACRO_AI;
const teams = template.teams.map((team) =>
  structuredClone(team.sourceTeam!),
) as [SimpleMatchTeamInput, SimpleMatchTeamInput];
const chooser =
  parseInt(
    canonicalHash({ seed: options.seed, phase: 'FIRST_SELECTION' }).slice(0, 8),
    16,
  ) < 0x80000000
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
const started = performance.now();
let series = createSeriesLab({
  seed: options.seed,
  bestOf: options.bestOf,
  template,
  firstSelection,
});
for (let gameNumber = 1; gameNumber < requestedGame; gameNumber++) {
  if (series.winnerTeamId !== null)
    throw new Error(
      `Series already finished before requested set ${requestedGame}`,
    );
  series = prepareSeriesGame(autoDraftSeries(beginSeriesDraft(series, teams)));
  const previous = startSimulation(series.active!.input!);
  for (
    let at = 300_000;
    at <= options.minutes * 60_000 && previous.status === 'RUNNING';
    at += 300_000
  ) {
    runUntil(previous, at);
    process.stderr.write(
      `Prior set ${gameNumber}: ${previous.simTimeMs / 60_000} minutes, ${previous.status}\n`,
    );
  }
  if (previous.status === 'RUNNING')
    runUntil(previous, options.minutes * 60_000);
  verifyBattleState(previous);
  console.log(
    JSON.stringify({
      previousGame: gameNumber,
      status: previous.status,
      minutes: previous.simTimeMs / 60_000,
      winner: previous.winnerTeamId,
      inputHash: previous.inputHash,
      eventsHash: canonicalHash(previous.events),
    }),
  );
  if (previous.status !== 'FINISHED')
    throw new Error(
      `Cannot inspect set ${requestedGame}: prior set ${gameNumber} did not finish (${previous.status})`,
    );
  series = completeSeriesGame(series, previous);
}
if (series.winnerTeamId !== null)
  throw new Error(
    `Series already finished before requested set ${requestedGame}`,
  );
series = prepareSeriesGame(autoDraftSeries(beginSeriesDraft(series, teams)));
const state = startSimulation(series.active!.input!);
let cursor = 0;
const samples: Record<string, Record<string, number>> = {};
const changes: Record<string, number> = {};
const prior: Record<string, string> = {};
let saved: SimulationCheckpoint | null = null;
const checkpointAtMs = Math.min(1_500_000, options.minutes * 30_000);
console.log(
  JSON.stringify({
    game: requestedGame,
    inputHash: state.inputHash,
    seed: state.input.seed,
    picks: state.input.actors.map((a) => [a.side, a.position, a.championId]),
  }),
);
for (
  let at = 1000;
  at <= options.minutes * 60_000 && state.status === 'RUNNING';
  at += 1000
) {
  runUntil(state, at);
  if (
    options.verifyResume &&
    !saved &&
    state.status === 'RUNNING' &&
    state.simTimeMs >= checkpointAtMs
  )
    saved = JSON.parse(
      JSON.stringify(checkpoint(state)),
    ) as SimulationCheckpoint;
  if (at >= 1_200_000)
    for (const actor of state.actors) {
      const key = `${actor.side}:${actor.input.position}`;
      const reason = actor.active
        ? (actor.plan?.reason ?? actor.action.kind)
        : 'DEAD';
      const row = (samples[key] ??= {});
      row[reason] = (row[reason] ?? 0) + 1;
      const goal = `${actor.plan?.kind}:${actor.plan?.targetId}:${actor.plan?.point.x.toFixed(0)}:${actor.plan?.point.y.toFixed(0)}`;
      if (prior[key] && prior[key] !== goal)
        changes[key] = (changes[key] ?? 0) + 1;
      prior[key] = goal;
    }
  if (at % 300_000 === 0 || state.status !== 'RUNNING') {
    const events = state.events.slice(cursor);
    cursor = state.events.length;
    console.log(
      JSON.stringify({
        minute: state.simTimeMs / 60_000,
        status: state.status,
        structures: state.units
          .filter((u) => u.structure)
          .map((u) => [u.id, Math.round(u.hp), u.active]),
        actors: state.actors.map((a) => ({
          id: `${a.side}:${a.input.position}`,
          champ: a.input.championId,
          xy: [Math.round(a.position.x), Math.round(a.position.y)],
          hp: Math.round((a.hp / a.maxHp) * 100),
          currentHp: Math.round(a.hp),
          maxHp: a.maxHp,
          level: a.level,
          mana: Math.round((a.mana / a.maxMana) * 100),
          action: a.action,
          plan: a.plan?.reason,
          point: a.plan?.point,
          planKind: a.plan?.kind,
          planTargetId: a.plan?.targetId,
          siegeLane: a.plan?.siegeLane,
          objectiveBackoff: a.plan?.objectiveBackoff,
          items: a.items.length,
        })),
        rejected: events
          .filter((e) => e.kind === 'REJECTED')
          .reduce(
            (counts, e) => {
              const key = e.reason ?? '';
              counts[key] = (counts[key] ?? 0) + 1;
              return counts;
            },
            {} as Record<string, number>,
          ),
        objectives: events
          .filter((e) => e.kind === 'OBJECTIVE_CAPTURED')
          .map((e) => [e.atMs, e.reason]),
        championStructureAttacks: Object.fromEntries(
          state.actors.map((actor) => [
            `${actor.side}:${actor.input.position}`,
            events.filter(
              (event) =>
                event.kind === 'ATTACK' &&
                event.actorId === actor.id &&
                event.targetId?.startsWith('structure:'),
            ).length,
          ]),
        ),
      }),
    );
  }
}
verifyBattleState(state);
let resumeVerified = false;
if (saved) {
  const resumed = restoreCheckpoint(saved);
  runUntil(resumed, state.simTimeMs);
  verifyBattleState(resumed);
  if (canonicalHash(resumed) !== canonicalHash(state))
    throw new Error(
      'Late-game checkpoint continuation differs from uninterrupted battle',
    );
  resumeVerified = true;
}
console.log(
  JSON.stringify({
    game: requestedGame,
    status: state.status,
    winner: state.winnerTeamId,
    minutes: state.simTimeMs / 60_000,
    elapsedMs: Math.round(performance.now() - started),
    stateHash: canonicalHash(state),
    eventsHash: canonicalHash(state.events),
    resumeVerified,
    checkpointAtMs: saved ? checkpointAtMs : null,
    changes,
    samples: Object.fromEntries(
      Object.entries(samples).map(([key, counts]) => [
        key,
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      ]),
    ),
  }),
);
