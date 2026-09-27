import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { TeamStrategy } from '../src/careers/enums/team-strategy.enum';
import { compositionValue } from '../src/drafts/champion-balance';
import {
  CHAMPIONS,
  CHAMPIONS_BY_ID,
  type Champion,
} from '../src/drafts/champion-catalog';
import {
  getDraftPlan,
  rankChampionChoices,
} from '../src/drafts/champion-draft-ai';
import {
  applyDraftAction,
  autoCompleteDraft,
  automaticVariant,
  availableVariants,
  currentTurn,
  type DraftState,
  type DraftTeam,
} from '../src/drafts/draft-state';
import { Position } from '../src/players/enums/position.enum';

const SIDES = ['BLUE', 'RED'] as const;
const PROFILE_KEYS = [
  'early',
  'late',
  'range',
  'frontline',
  'engage',
  'protection',
  'damage',
  'waveClear',
  'objectiveDamage',
] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];

interface DraftAiCheckOptions {
  seeds: number;
  startSeed: number;
}

function parseOptions(args: string[]): DraftAiCheckOptions {
  const options = { seeds: 24, startSeed: 1 };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    assert.ok(
      ['--seeds', '--start-seed'].includes(flag) && !seen.has(flag),
      'Usage: npx ts-node scripts/check-draft-ai.ts [--seeds 1..256] [--start-seed 0..4294967295]',
    );
    seen.add(flag);
    const raw = args[++i];
    assert.ok(raw !== undefined && /^(0|[1-9]\d*)$/.test(raw));
    const value = Number(raw);
    assert.ok(Number.isSafeInteger(value));
    if (flag === '--seeds') {
      assert.ok(value >= 1 && value <= 256);
      options.seeds = value;
    } else {
      assert.ok(value <= 0xffff_ffff);
      options.startSeed = value;
    }
  }
  assert.ok(options.startSeed + options.seeds - 1 <= 0xffff_ffff);
  return options;
}

const team = (id: number): DraftTeam => ({
  id,
  code: `T${id}`,
  strategy: TeamStrategy.BALANCED,
  players: Object.values(Position).map((position, index) => ({
    id: id * 10 + index,
    nickname: `P${index}`,
    position,
    instruction: null,
    roleProficiency: null,
    typeProficiencies: {},
    abilities: { mechanics: 85, laning: 85, teamFight: 85 },
  })),
});

const fixture = (
  seed: number,
  gameNumber = 1,
  unavailable: string[] = [],
): DraftState => ({
  version: 3,
  aiSeed: seed,
  blue: team(1),
  red: team(2),
  managedTeamId: 1,
  gameNumber,
  fearless: true,
  unavailable,
  actions: [],
  deadline: null,
  completed: false,
});

function verifyCompleted(state: DraftState) {
  assert.equal(state.completed, true);
  assert.equal(state.assignmentsConfirmed, true);
  assert.equal(state.actions.length, 20);
  assert.equal(
    new Set(state.actions.map((action) => action.variantId)).size,
    20,
  );
  assert.ok(
    state.actions.every(
      (action) =>
        CHAMPIONS_BY_ID.has(action.variantId) &&
        !state.unavailable.includes(action.variantId),
    ),
  );
  assert.ok(state.assignments);
  for (const side of SIDES) {
    const lineup: Record<Position, string> = state.assignments[side];
    assert.deepEqual(
      Object.keys(lineup).sort(),
      Object.values(Position).sort(),
    );
    assert.equal(new Set(Object.values(lineup)).size, 5);
    assert.deepEqual(
      Object.values(lineup).sort(),
      state.actions
        .filter((action) => action.kind === 'PICK' && action.side === side)
        .map((action) => action.variantId)
        .sort(),
    );
  }
}

function add(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

const rounded = (n: number) => Math.round(n * 1000) / 1000;
function summarize(values: number[]) {
  assert.ok(values.length && values.every(Number.isFinite));
  const ordered = [...values].sort((a, b) => a - b);
  return {
    min: rounded(ordered[0]),
    mean: rounded(values.reduce((total, n) => total + n, 0) / values.length),
    p95: rounded(ordered[Math.ceil(ordered.length * 0.95) - 1]),
    max: rounded(ordered[ordered.length - 1]),
  };
}

function frequencies(counts: Map<string, number>) {
  const entries = [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const observations = entries.reduce((total, [, count]) => total + count, 0);
  return {
    observations,
    distinct: entries.length,
    largestShare: rounded((entries[0]?.[1] ?? 0) / Math.max(1, observations)),
    top: Object.fromEntries(entries.slice(0, 12)),
  };
}

function profile(champions: Champion[]): Record<ProfileKey, number> {
  return Object.fromEntries(
    PROFILE_KEYS.map((key) => [
      key,
      champions.reduce((total, champion) => total + champion[key], 0) /
        champions.length,
    ]),
  ) as Record<ProfileKey, number>;
}

/** Pure in-memory fixtures only: no accounts, saves, matches, DB or network. */
export function checkDraftAi(options: DraftAiCheckOptions) {
  parseOptions([
    '--seeds',
    String(options.seeds),
    '--start-seed',
    String(options.startSeed),
  ]);
  const started = performance.now();
  const firstBans = new Map<string, number>();
  const firstPicks = new Map<string, number>();
  const pickedChampions = new Map<string, number>();
  const lineups = new Map<string, number>();
  const plans = new Map<string, number>();
  const fit: number[] = [];
  const compositions: number[] = [];
  const duration: number[] = [];
  const profiles: Array<Record<ProfileKey, number>> = [];
  const profilesByPlan = new Map<string, Array<Record<ProfileKey, number>>>();

  for (let offset = 0; offset < options.seeds; offset++) {
    const initial = fixture(options.startSeed + offset);
    const original = structuredClone(initial);
    const at = performance.now();
    const completed = autoCompleteDraft(initial, 0);
    duration.push(performance.now() - at);
    verifyCompleted(completed);
    assert.deepEqual(initial, original, 'Automatic draft mutated its input');

    // Replay the same saved state each turn. Retries must not reroll the pick.
    let replay = structuredClone(initial);
    while (!replay.completed) {
      const turn = currentTurn(replay);
      assert.ok(turn);
      const saved = structuredClone(replay);
      const chosen = automaticVariant(replay);
      assert.equal(chosen.id, automaticVariant(structuredClone(replay)).id);
      assert.ok(availableVariants(replay).some((c) => c.id === chosen.id));
      assert.deepEqual(replay, saved, 'Decision mutated a saved draft');
      replay = applyDraftAction(replay, chosen.id, true, 0);
    }
    assert.deepEqual(autoCompleteDraft(replay, 0), completed);

    const ranked = rankChampionChoices(initial, 'BLUE', 'BAN', [...CHAMPIONS]);
    assert.equal(ranked.length, CHAMPIONS.length);
    assert.equal(
      new Set(ranked.map((entry) => entry.champion.id)).size,
      ranked.length,
    );
    for (const [index, entry] of ranked.entries()) {
      assert.ok(Number.isFinite(entry.score));
      assert.ok(
        entry.reasons.length > 0 &&
          entry.reasons.every((reason) => reason.length > 0),
      );
      if (index > 0) assert.ok(ranked[index - 1].score >= entry.score);
    }

    add(firstBans, completed.actions.find((a) => a.kind === 'BAN')!.variantId);
    add(
      firstPicks,
      completed.actions.find((a) => a.kind === 'PICK')!.variantId,
    );
    for (const side of SIDES) {
      const own = side === 'BLUE' ? initial.blue : initial.red;
      const plan = getDraftPlan(initial, own.id);
      assert.deepEqual(plan, getDraftPlan(structuredClone(initial), own.id));
      add(plans, `${plan.id}: ${plan.label}`);
      const lineup = completed.assignments![side];
      add(lineups, Object.values(lineup).sort().join(','));
      const champions = Object.entries(lineup).map(([position, id]) => {
        const champion = CHAMPIONS_BY_ID.get(id)!;
        add(pickedChampions, id);
        fit.push(champion.roleRatings[position as Position]);
        return champion;
      });
      compositions.push(compositionValue(champions));
      const currentProfile = profile(champions);
      profiles.push(currentProfile);
      const planProfiles = profilesByPlan.get(plan.id) ?? [];
      planProfiles.push(currentProfile);
      profilesByPlan.set(plan.id, planProfiles);
    }
  }

  const used: string[] = [];
  const fearless: Array<{
    gameNumber: number;
    plans: string[];
    picks: string[];
  }> = [];
  for (let gameNumber = 1; gameNumber <= 5; gameNumber++) {
    const initial = fixture(options.startSeed, gameNumber, [...used]);
    const completed = autoCompleteDraft(initial, 0);
    verifyCompleted(completed);
    assert.deepEqual(completed, autoCompleteDraft(structuredClone(initial), 0));
    used.push(
      ...completed.actions
        .filter((a) => a.kind === 'PICK')
        .map((a) => a.variantId),
    );
    fearless.push({
      gameNumber,
      plans: SIDES.map(
        (side) =>
          getDraftPlan(
            initial,
            (side === 'BLUE' ? initial.blue : initial.red).id,
          ).id,
      ),
      picks: completed.actions
        .filter((a) => a.kind === 'PICK')
        .map((a) => a.variantId),
    });
  }
  assert.equal(used.length, 50);
  assert.equal(new Set(used).size, 50);

  return {
    passed: true,
    fixture: 'Equal BALANCED teams, abilities 85, no stored champion mastery',
    seeds: options.seeds,
    startSeed: options.startSeed,
    retryAndImmutabilityChecks:
      'passed for every action and every Fearless set',
    firstBans: frequencies(firstBans),
    firstPicks: frequencies(firstPicks),
    pickedChampions: frequencies(pickedChampions),
    lineups: frequencies(lineups),
    plans: frequencies(plans),
    positionFit: {
      ...summarize(fit),
      slotsBelow65: fit.filter((value) => value < 65).length,
    },
    composition: summarize(compositions),
    profile: Object.fromEntries(
      PROFILE_KEYS.map((key) => [
        key,
        summarize(profiles.map((entry) => entry[key])),
      ]),
    ),
    profilesByPlan: Object.fromEntries(
      [...profilesByPlan].sort().map(([id, entries]) => [
        id,
        {
          count: entries.length,
          means: Object.fromEntries(
            PROFILE_KEYS.map((key) => [
              key,
              summarize(entries.map((entry) => entry[key])).mean,
            ]),
          ),
        },
      ]),
    ),
    draftElapsedMs: summarize(duration),
    elapsedMsIncludingChecks: Math.round(performance.now() - started),
    fearless: { sets: 5, uniquePickedChampions: used.length, games: fearless },
  };
}

if (require.main === module) {
  try {
    process.stdout.write(
      `${JSON.stringify(checkDraftAi(parseOptions(process.argv.slice(2))), null, 2)}\n`,
    );
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({ passed: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  }
}
