import { createBattleRuleset } from './battle-rules';
import { battlePublicInformation, planBattleActors } from './battle-planner';
import type { UnitState } from './contracts';
import { startSimulation, queueCommand, runUntil } from './engine';
import { observe } from './observation';
import { projectMatch } from './projection';
import { createDuelInput, createLabInput } from './test-fixtures';
import type { VisionRules } from './vision';
import type { AbilityRules } from './effects';

function battle() {
  const input = createDuelInput();
  input.rules = createBattleRuleset();
  const state = startSimulation(input);
  state.actors[0].position = { x: 4900, y: 5100 };
  state.actors[1].position = { x: 5000, y: 5000 };
  return state;
}

describe('independent stage 3-5 integration boundaries', () => {
  it('cannot overlap a ward placement with an ability wind-up on one actor', () => {
    const state = battle(),
      [actor, enemy] = state.actors;
    const mana = actor.mana;
    queueCommand(state, {
      id: 'a-ward',
      atMs: 0,
      intent: {
        kind: 'WARD',
        actorId: actor.id,
        point: { ...actor.position },
        reason: 'test',
      },
    });
    queueCommand(state, {
      id: 'b-cast',
      atMs: 0,
      intent: {
        kind: 'CAST',
        actorId: actor.id,
        slotId: 'MODEL_STRIKE',
        targetId: enemy.id,
        reason: 'test',
      },
    });
    runUntil(state, 0);
    expect(
      state.events.filter((event) => event.kind === 'WARD_START'),
    ).toHaveLength(1);
    expect(
      state.events.filter((event) => event.kind === 'CAST_START'),
    ).toHaveLength(0);
    expect(actor.mana).toBe(mana);
  });

  it('absorbed damage receives no phantom HP damage credit, but still provokes the protecting turret', () => {
    const state = battle(),
      [attacker, defender] = state.actors;
    const tower = state.units.find(
      (unit) => unit.side === 'RED' && unit.structure?.type === 'OUTER',
    )!;
    tower.position = { x: 5000, y: 5100 };
    tower.origin = { ...tower.position };
    tower.nextAttackAtMs = 100;
    const minion: UnitState = {
      ...structuredClone(attacker),
      id: 'blue-test-minion',
      kind: 'MINION',
      position: { x: 5100, y: 5200 },
      origin: { x: 5100, y: 5200 },
      hp: 1000,
      maxHp: 1000,
      attackDamage: 0,
      moveSpeed: 0,
    };
    state.units = [tower, minion];
    state.combat!.effects.push({
      id: 'shield',
      sourceId: defender.id,
      targetId: defender.id,
      kind: 'SHIELD',
      amount: 10_000,
      startsAtMs: 0,
      expiresAtMs: 10_000,
    });
    queueCommand(state, {
      id: 'attack',
      atMs: 0,
      intent: {
        kind: 'ATTACK',
        actorId: attacker.id,
        targetId: defender.id,
        reason: 'test shield aggression',
      },
    });
    runUntil(state, 100);
    expect(attacker.stats.damageToChampions).toBe(0);
    expect(defender.stats.damageTaken).toBe(0);
    expect(
      state.events.find(
        (event) => event.kind === 'ATTACK' && event.actorId === tower.id,
      )?.targetId,
    ).toBe(attacker.id);
    expect(
      projectMatch(state).players.find(
        (player) => player.actorId === attacker.id,
      )?.damageToChampions,
    ).toBe(0);
  });

  it('first decisions cannot read hidden enemy HP, wallet, camp HP, plans or cooldowns', () => {
    const state = battle();
    state.actors[1].position = { x: 9000, y: 1000 };
    const twin = structuredClone(state);
    twin.actors[1].hp = 1;
    twin.actors[1].gold = 99_999;
    twin.combat!.cooldowns[twin.actors[1].id].MODEL_STRIKE = 999_999;
    const hiddenCamp = twin.units.find(
      (unit) => unit.kind === 'CAMP' && unit.position.x > 8000,
    );
    if (hiddenCamp) hiddenCamp.hp = 1;
    const first = observe(state, 'BLUE'),
      second = observe(twin, 'BLUE');
    expect(first).toEqual(second);
    const info = battlePublicInformation(state, 'BLUE'),
      otherInfo = battlePublicInformation(twin, 'BLUE');
    expect(info).toEqual(otherInfo);
    expect(
      planBattleActors(first, state.input, structuredClone(state.rng), info),
    ).toEqual(
      planBattleActors(
        second,
        twin.input,
        structuredClone(twin.rng),
        otherInfo,
      ),
    );
  });

  it('keeps turret aggression after the protected champion was killed', () => {
    const state = battle(),
      [attacker, defender] = state.actors;
    const tower = state.units.find(
      (unit) => unit.side === 'RED' && unit.structure?.type === 'OUTER',
    )!;
    tower.position = { x: 5000, y: 5100 };
    tower.origin = { ...tower.position };
    tower.nextAttackAtMs = 100;
    const minion: UnitState = {
      ...structuredClone(attacker),
      id: 'blue-test-minion',
      kind: 'MINION',
      position: { x: 5100, y: 5200 },
      origin: { x: 5100, y: 5200 },
      hp: 1000,
      maxHp: 1000,
      attackDamage: 0,
      moveSpeed: 0,
    };
    state.units = [tower, minion];
    defender.hp = 1;
    queueCommand(state, {
      id: 'kill',
      atMs: 0,
      intent: {
        kind: 'ATTACK',
        actorId: attacker.id,
        targetId: defender.id,
        reason: 'test lethal aggression',
      },
    });
    runUntil(state, 100);
    expect(defender.active).toBe(false);
    expect(
      state.events.find(
        (event) => event.kind === 'ATTACK' && event.actorId === tower.id,
      )?.targetId,
    ).toBe(attacker.id);
  });

  it('rejects missing required extension numbers before permissive range comparisons or NaN regeneration', () => {
    const missingRange = createDuelInput();
    missingRange.rules = createBattleRuleset();
    delete (missingRange.rules.vision as Partial<VisionRules>).placementRange;
    expect(() => startSimulation(missingRange)).toThrow(
      /vision|placementRange/,
    );
    const missingRegen = createDuelInput();
    missingRegen.rules = createBattleRuleset();
    delete (missingRegen.rules.abilities as Partial<AbilityRules>)
      .manaRegenPerSecond;
    expect(() => startSimulation(missingRegen)).toThrow(/abilit|manaRegen/);
  });

  it.each(['Infinity', '1200', undefined, null, Infinity, NaN, 0, 1.5])(
    'rejects a malformed quest target %s before creating an unwinnable quest',
    (target) => {
      const input = createDuelInput();
      input.rules = createBattleRuleset();
      input.rules.roleQuests!.targets.TOP = target as number;
      // Non-JSON values fail the canonical-input guard even before module validation.
      expect(() => startSimulation(input)).toThrow(
        /roleQuests|role quest|Canonical state/,
      );
    },
  );

  it.each([1, 17, 2026])(
    'smite is exactly 600 despite armor, dragon stacks, Elder and random seed %i',
    (seed) => {
      const input = createDuelInput(seed);
      input.rules = createBattleRuleset();
      input.actors[0].position = 'JUNGLE';
      const state = startSimulation(input),
        actor = state.actors[0];
      actor.position = { x: 4900, y: 5100 };
      state.environment!.teams.BLUE.dragons = 4;
      state.environment!.teams.BLUE.elderUntilMs = 60_000;
      state.environment!.teams.BLUE.elderRecipients = [actor.id];
      const monster: UnitState = {
        ...structuredClone(actor),
        id: 'smite-monster',
        kind: 'CAMP',
        side: null,
        position: { x: 5000, y: 5000 },
        origin: { x: 5000, y: 5000 },
        hp: 1000,
        maxHp: 1000,
        armor: 100_000,
        attackDamage: 0,
        generation: 1,
        reward: { gold: 0, xp: 0, cs: 0 },
      };
      state.units.push(monster);
      const rng = state.rng.combat;
      queueCommand(state, {
        id: 'smite',
        atMs: 0,
        intent: {
          kind: 'CAST',
          actorId: actor.id,
          slotId: 'MODEL_SMITE',
          targetId: monster.id,
          reason: 'test fixed smite',
        },
      });
      runUntil(state, 0);
      expect(monster.hp).toBe(400);
      expect(state.rng.combat).toBe(rng);
      expect(
        state.events.find(
          (event) => event.kind === 'DAMAGE' && event.targetId === monster.id,
        )?.amount,
      ).toBe(600);
    },
  );

  it('resolves two distant fights in the same timestamp rather than freezing another lane', () => {
    const input = createLabInput();
    input.controlMode = 'SCRIPTED';
    input.rules = createBattleRuleset();
    input.actors = input.actors.filter((actor) =>
      ['TOP', 'MID'].includes(actor.position),
    );
    const state = startSimulation(input);
    state.units = [];
    const blue = state.actors.filter((actor) => actor.side === 'BLUE');
    const red = state.actors.filter((actor) => actor.side === 'RED');
    blue[0].position = { x: 700, y: 4000 };
    red[0].position = { x: 800, y: 3900 };
    blue[1].position = { x: 9200, y: 6000 };
    red[1].position = { x: 9300, y: 5900 };
    state.actors.forEach((actor) => {
      actor.hp = 1;
    });
    for (let index = 0; index < 2; index++) {
      for (const [actor, target] of [
        [blue[index], red[index]],
        [red[index], blue[index]],
      ]) {
        queueCommand(state, {
          id: `attack:${actor.id}`,
          atMs: 0,
          intent: {
            kind: 'ATTACK',
            actorId: actor.id,
            targetId: target.id,
            reason: 'parallel fights',
          },
        });
      }
    }
    runUntil(state, 0);
    const deaths = state.events.filter((event) => event.kind === 'DEATH');
    expect(deaths).toHaveLength(4);
    expect(deaths.every((event) => event.atMs === 0)).toBe(true);
    expect(
      projectMatch(state).players.reduce((sum, actor) => sum + actor.kills, 0),
    ).toBe(4);
    expect(state.winnerTeamId).toBeNull();
  });

  it('reaching a time horizon never awards a winner without physical nexus destruction', () => {
    const input = createDuelInput();
    input.rules = createBattleRuleset();
    input.rules.maxHorizonMs = 1000;
    const state = startSimulation(input);
    runUntil(state, 1000);
    expect(state.status).toBe('HORIZON_REACHED');
    expect(state.winnerTeamId).toBeNull();
    expect(
      state.units
        .filter((unit) => unit.kind === 'NEXUS')
        .every((unit) => unit.active && unit.hp > 0),
    ).toBe(true);
    expect(projectMatch(state).winnerTeamId).toBeNull();
  });
});
