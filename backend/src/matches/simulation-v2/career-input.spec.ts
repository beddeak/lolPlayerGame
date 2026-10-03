import { buildCareerEngineInput, careerMacroAi } from './career-input';
import { createLabInput } from './test-fixtures';
import { canonicalHash } from './seeded-rng';
import type { SimpleMatchTeamInput } from '../simulation/simple-match.types';

const options = (seed = 123) => ({
  teams: createLabInput(seed).teams.map((team) => team.sourceTeam!) as [
    SimpleMatchTeamInput,
    SimpleMatchTeamInput,
  ],
  seed,
  careerId: 7,
  gameId: 8,
});

describe('career input and legal automatic drafting', () => {
  it('pins coordinated AI for new matches but can build an old series without changing its input format', () => {
    const modern = buildCareerEngineInput(options());
    expect(modern.input.rules.macroAi).toBe('COORDINATED_V2');
    const legacy = buildCareerEngineInput({
      ...options(),
      macroAi: 'LEGACY',
      draft: modern.draft,
    });
    expect(legacy.input.rules).not.toHaveProperty('macroAi');
    const normalized = structuredClone(modern.input);
    delete normalized.rules.macroAi;
    expect(canonicalHash(normalized)).toBe(canonicalHash(legacy.input));
    expect(Object.isFrozen(modern.input.rules)).toBe(true);
    const previous = buildCareerEngineInput({
      ...options(),
      macroAi: 'COORDINATED_V1',
      draft: modern.draft,
    });
    const normalizedV1 = structuredClone(modern.input);
    normalizedV1.rules.macroAi = 'COORDINATED_V1';
    expect(canonicalHash(normalizedV1)).toBe(canonicalHash(previous.input));
    expect(careerMacroAi([previous.input])).toBe('COORDINATED_V1');
    expect(careerMacroAi([modern.input])).toBe('COORDINATED_V2');
    expect(() => careerMacroAi([previous.input, modern.input])).toThrow(
      'incompatible',
    );
  });
  it('pins a deterministic full battle input from the actual ten starters', () => {
    const first = buildCareerEngineInput(options());
    const second = buildCareerEngineInput(options());
    expect(canonicalHash(first)).toBe(canonicalHash(second));
    expect(first.input.rules.capabilities.nexusVictory).toBe('SUPPORTED');
    expect(first.input.context).toEqual({
      careerId: 7,
      seriesId: 0,
      gameId: 8,
    });
    expect(first.input.actors).toHaveLength(10);
    expect(
      new Set(first.input.actors.map((actor) => actor.championId)).size,
    ).toBe(10);
    expect(first.draft.actions).toHaveLength(20);
    expect(first.draft.assignmentsConfirmed).toBe(true);
    expect(
      first.input.actors.every((actor) => actor.roleProficiency === null),
    ).toBe(true);
  });

  it('uses the persisted same decision sequence in direct and automatic modes', () => {
    const automatic = buildCareerEngineInput(options(124));
    const direct = buildCareerEngineInput({
      ...options(124),
      draft: automatic.draft,
    });
    expect(canonicalHash(direct.input)).toBe(canonicalHash(automatic.input));
    expect(() => buildCareerEngineInput({ ...options(), seriesId: 3 })).toThrow(
      'persisted draft',
    );
  });

  it('rejects stale rosters, foreign teams, invalid assignments, and old drafts', () => {
    const original = buildCareerEngineInput(options()).draft;
    const changed = structuredClone(original);
    changed.blue.players[0].id = 99999;
    expect(() =>
      buildCareerEngineInput({ ...options(), draft: changed }),
    ).toThrow('starter');
    const foreign = structuredClone(original);
    foreign.red.id = 88;
    expect(() =>
      buildCareerEngineInput({ ...options(), draft: foreign }),
    ).toThrow('participants');
    const assignment = structuredClone(original);
    assignment.assignments!.BLUE.TOP = assignment.assignments!.RED.TOP;
    expect(() =>
      buildCareerEngineInput({ ...options(), draft: assignment }),
    ).toThrow('legally picked');
    expect(() =>
      buildCareerEngineInput({
        ...options(),
        draft: { ...original, version: 2 },
      }),
    ).toThrow('legacy');
  });

  it('rechecks ban/pick history and fearless restrictions before accepting a snapshot', () => {
    const original = buildCareerEngineInput(options()).draft;
    const changed = structuredClone(original);
    changed.actions[1].variantId = changed.actions[0].variantId;
    expect(() =>
      buildCareerEngineInput({ ...options(), draft: changed }),
    ).toThrow();
    const blocked = structuredClone(original);
    blocked.unavailable = [
      blocked.actions.find((action) => action.kind === 'PICK')!.variantId,
    ];
    blocked.fearless = true;
    expect(() =>
      buildCareerEngineInput({ ...options(), draft: blocked }),
    ).toThrow();
  });
});
