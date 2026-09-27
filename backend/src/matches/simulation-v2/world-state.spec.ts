import type {
  CombatProfile,
  EngineInput,
  MapDefinition,
  UnitTemplate,
} from './contracts';
import { createDuelInput, createLabInput } from './test-fixtures';
import { canonicalHash } from './seeded-rng';
import {
  checkpoint,
  createWorldState,
  restoreCheckpoint,
  validateEngineInput,
} from './world-state';

describe('simulation-v2 input geometry and numeric contracts', () => {
  it('accepts unchanged 5v5 and duel fixtures without mutating the input', () => {
    for (const input of [createLabInput(), createDuelInput()]) {
      const before = canonicalHash(input);
      expect(() => validateEngineInput(input)).not.toThrow();
      const state = createWorldState(input);
      expect(canonicalHash(input)).toBe(before);
      expect(state.inputHash).toBe(before);
      expect(Object.isFrozen(state.input.actors[0].profile)).toBe(true);
      expect(Object.isFrozen(state.input.map.lanes.MID[0])).toBe(true);
      expect(Object.isFrozen(input)).toBe(false);
      input.actors[0].profile.maxHp = 1;
      expect(state.actors[0].maxHp).not.toBe(1);
      const restored = restoreCheckpoint(checkpoint(state));
      expect(Object.isFrozen(restored.input.map.lanes.MID[0])).toBe(true);
      expect(Object.isFrozen(restored.actors[0].input.profile)).toBe(true);
    }
  });

  it.each<keyof CombatProfile>([
    'maxHp',
    'maxMana',
    'attackDamage',
    'armor',
    'attackRange',
    'attackIntervalMs',
    'moveSpeed',
    'visionRange',
    'hpPerLevel',
    'attackPerLevel',
  ])('rejects a missing required combat profile field: %s', (key) => {
    const input = createDuelInput();
    delete (input.actors[0].profile as Partial<CombatProfile>)[key];
    expect(() => createWorldState(input)).toThrow(/combat profile/);
  });

  it.each<keyof UnitTemplate>([
    'hp',
    'attackDamage',
    'armor',
    'attackRange',
    'attackIntervalMs',
    'moveSpeed',
    'gold',
    'xp',
    'cs',
  ])('rejects missing minion or camp template field: %s', (key) => {
    for (const kind of ['minion', 'camp'] as const) {
      const input = createDuelInput();
      delete (input.rules[kind] as Partial<UnitTemplate>)[key];
      expect(() => createWorldState(input)).toThrow(/resource template/);
    }
  });

  it('allows valid zero mana, armor, growth and reward values', () => {
    const input = createDuelInput();
    Object.assign(input.actors[0].profile, {
      maxMana: 0,
      armor: 0,
      hpPerLevel: 0,
      attackPerLevel: 0,
    });
    Object.assign(input.rules.minion, { gold: 0, xp: 0, cs: 0, armor: 0 });
    expect(() => validateEngineInput(input)).not.toThrow();
  });

  it('rejects negative/non-finite values and non-positive movement/HP/range', () => {
    const invalidChanges: Array<(input: EngineInput) => void> = [
      (input) => {
        input.actors[0].profile.attackDamage = -1;
      },
      (input) => {
        input.actors[0].profile.maxMana = NaN;
      },
      (input) => {
        input.actors[0].profile.armor = Infinity;
      },
      (input) => {
        input.actors[0].profile.maxHp = 0;
      },
      (input) => {
        input.actors[0].profile.moveSpeed = 0;
      },
      (input) => {
        input.actors[0].profile.attackRange = 0;
      },
      (input) => {
        input.rules.minion.hp = 0;
      },
      (input) => {
        input.rules.minion.moveSpeed = 0;
      },
      (input) => {
        input.rules.camp.attackRange = 0;
      },
      (input) => {
        input.rules.camp.gold = -1;
      },
      (input) => {
        input.rules.camp.xp = Infinity;
      },
      (input) => {
        input.rules.minion.cs = 0.5;
      },
    ];
    for (const change of invalidChanges) {
      const input = createDuelInput();
      change(input);
      expect(() => validateEngineInput(input)).toThrow();
    }
  });

  it('rejects combat intervals not aligned to the simulation step', () => {
    for (const interval of [0, 99, 100.5, 1001]) {
      const input = createDuelInput();
      input.actors[0].profile.attackIntervalMs = interval;
      expect(() => validateEngineInput(input)).toThrow(/combat limits/);
      const templateInput = createDuelInput();
      templateInput.rules.camp.attackIntervalMs = interval;
      expect(() => validateEngineInput(templateInput)).toThrow(
        /resource template/,
      );
    }
  });

  it('rejects invalid map sizes and missing/reversed/out-of-map wall coordinates', () => {
    const invalidChanges: Array<(map: MapDefinition) => void> = [
      (map) => {
        map.width = 0;
      },
      (map) => {
        map.height = -1;
      },
      (map) => {
        map.width = Infinity;
      },
      (map) => {
        map.walls[0].x1 = map.walls[0].x2;
      },
      (map) => {
        map.walls[0].y1 = map.walls[0].y2 + 1;
      },
      (map) => {
        map.walls[0].x1 = -1;
      },
      (map) => {
        map.walls[0].y2 = map.height + 1;
      },
      (map) => {
        delete (map.walls[0] as Partial<MapDefinition['walls'][number]>).x1;
      },
    ];
    for (const change of invalidChanges) {
      const input = createDuelInput();
      change(input.map);
      expect(() => validateEngineInput(input)).toThrow();
    }
  });

  it('rejects non-walkable, missing or identical bases', () => {
    const invalidChanges: Array<(map: MapDefinition) => void> = [
      (map) => {
        map.bases.BLUE = { x: 2500, y: 5500 };
      },
      (map) => {
        map.bases.RED.x = map.width + 1;
      },
      (map) => {
        map.bases.RED = { ...map.bases.BLUE };
      },
      (map) => {
        delete (map.bases as Partial<MapDefinition['bases']>).BLUE;
      },
    ];
    for (const change of invalidChanges) {
      const input = createDuelInput();
      change(input.map);
      expect(() => validateEngineInput(input)).toThrow(/base/);
    }
  });

  it('rejects malformed lane geometry or lane direction', () => {
    const invalidChanges: Array<(map: MapDefinition) => void> = [
      (map) => {
        delete (map.lanes as Partial<MapDefinition['lanes']>).MID;
      },
      (map) => {
        map.lanes.MID = [];
      },
      (map) => {
        map.lanes.MID = [{ ...map.bases.BLUE }];
      },
      (map) => {
        map.lanes.MID.reverse();
      },
      (map) => {
        map.lanes.MID[0] = { x: 701, y: 9300 };
      },
      (map) => {
        map.lanes.MID.splice(1, 0, { x: -1, y: 100 });
      },
      (map) => {
        map.lanes.MID.splice(1, 0, { x: 2500, y: 5500 });
      },
      (map) => {
        map.lanes.MID.splice(1, 0, { ...map.bases.BLUE });
      },
    ];
    for (const change of invalidChanges) {
      const input = createDuelInput();
      change(input.map);
      expect(() => validateEngineInput(input)).toThrow(/lane/);
    }
  });

  it('rejects a new wall intersecting a lane before any minion can spawn into it', () => {
    const input = createDuelInput();
    input.map.walls.push({ x1: 4900, y1: 4900, x2: 5100, y2: 5100 });
    // All route points and both bases remain legal; the segment between them does not.
    expect(() => createWorldState(input)).toThrow(
      /MID lane segment crosses a wall/,
    );
  });
});
