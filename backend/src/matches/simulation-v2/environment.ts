import {
  emit,
  hasCurrentDeathEvent,
  opposite,
  type ActorState,
  type EngineState,
  type Lane,
  type Point,
  type Side,
  type UnitState,
} from './contracts';
import type {
  EnvironmentState,
  ObjectiveDefinition,
  StructureType,
  TeamEnvironmentState,
} from './environment-types';
import { grantReward } from './economy-ledger';
import { distance, hasLineOfSight, isWalkable } from './map-paths';

const sides: Side[] = ['BLUE', 'RED'];
const lanes: Lane[] = ['TOP', 'MID', 'BOT'];
const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const turret = (unit: UnitState) => unit.kind === 'TURRET';
const laneTurret = (unit: UnitState) =>
  turret(unit) && unit.structure?.type !== 'NEXUS_TURRET';
const actor = (unit: UnitState): unit is ActorState => unit.kind === 'CHAMPION';
const alive = (unit: UnitState) => unit.active && unit.hp > 0;
const rulesOf = (state: EngineState) => state.input.rules.environment;
export const structureId = (side: Side, lane: Lane, type: StructureType) =>
  `structure:${side}:${lane}:${type}`;
export const nexusId = (side: Side) => `structure:${side}:NEXUS`;

export function createEnvironmentState(): EnvironmentState {
  const team = (): TeamEnvironmentState => ({
    dragons: 0,
    grubs: 0,
    heraldCharges: 0,
    baronUntilMs: 0,
    elderUntilMs: 0,
    baronRecipients: [],
    elderRecipients: [],
  });
  return {
    teams: { BLUE: team(), RED: team() },
    firstTurretClaimed: false,
    soulSide: null,
    elderAvailableAtMs: null,
  };
}

function lanePoint(points: Point[], fraction: number): Point {
  let remaining =
    points
      .slice(1)
      .reduce((sum, point, i) => sum + distance(points[i], point), 0) *
    fraction;
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (remaining <= length)
      return {
        x:
          points[i - 1].x +
          ((points[i].x - points[i - 1].x) * remaining) / length,
        y:
          points[i - 1].y +
          ((points[i].y - points[i - 1].y) * remaining) / length,
      };
    remaining -= length;
  }
  return { ...points[points.length - 1] };
}

/** Definitions use public map geometry, never hidden enemy combat state. */
export function initializeEnvironment(state: EngineState): void {
  const rules = rulesOf(state);
  if (!rules) return;
  state.environment ??= createEnvironmentState();
  const addStructure = (
    id: string,
    side: Side,
    lane: Lane | null,
    type: StructureType,
    point: Point,
    prerequisiteIds: string[],
  ) => {
    if (state.units.some((unit) => unit.id === id)) return;
    if (!isWalkable(state.input.map, point))
      throw new Error(`Blocked structure site: ${id}`);
    const definition = rules.structures[type];
    state.units.push({
      id,
      kind:
        type === 'INHIBITOR'
          ? 'INHIBITOR'
          : type === 'NEXUS'
            ? 'NEXUS'
            : 'TURRET',
      side,
      lane,
      position: { ...point },
      origin: { ...point },
      hp: definition.hp,
      maxHp: definition.hp,
      armor: definition.armor,
      attackDamage: definition.attackDamage,
      attackRange: definition.attackRange,
      attackIntervalMs: definition.attackIntervalMs,
      moveSpeed: 0,
      nextAttackAtMs: 0,
      path: [],
      active: true,
      spawnAtMs: 0,
      respawnAtMs: null,
      generation: 1,
      reward: { gold: 0, xp: 0, cs: 0 },
      structure: {
        type,
        prerequisiteIds,
        platesClaimed: 0,
        overgrowthStartedAtMs: null,
        overgrowthActive: false,
      },
    });
  };
  for (const side of sides) {
    for (const lane of lanes) {
      const stages: Array<[StructureType, number]> = [
        ['OUTER', 0.4],
        ['INNER', 0.23],
        ['BASE', 0.115],
        ['INHIBITOR', 0.075],
      ];
      stages.forEach(([type, progress], index) => {
        const id = structureId(side, lane, type);
        addStructure(
          id,
          side,
          lane,
          type,
          lanePoint(
            state.input.map.lanes[lane],
            side === 'BLUE' ? progress : 1 - progress,
          ),
          index === 0 ? [] : [structureId(side, lane, stages[index - 1][0])],
        );
      });
    }
    const nexusPoint = lanePoint(
      state.input.map.lanes.MID,
      side === 'BLUE' ? 0.012 : 0.988,
    );
    const towerPoint = lanePoint(
      state.input.map.lanes.MID,
      side === 'BLUE' ? 0.04 : 0.96,
    );
    for (let i = 0; i < 2; i++) {
      const offset = i === 0 ? -120 : 120;
      addStructure(
        `structure:${side}:NEXUS_TURRET:${i}`,
        side,
        null,
        'NEXUS_TURRET',
        { x: towerPoint.x + offset, y: towerPoint.y + offset },
        [],
      );
    }
    addStructure(
      nexusId(side),
      side,
      null,
      'NEXUS',
      nexusPoint,
      [0, 1].map((i) => `structure:${side}:NEXUS_TURRET:${i}`),
    );
  }
  rules.objectives.forEach((definition, definitionIndex) => {
    for (let index = 0; index < definition.count; index++) {
      const id = `objective:${definition.type}${definition.count > 1 ? `:${index}` : ''}`;
      if (state.units.some((unit) => unit.id === id)) continue;
      const point = {
        x:
          definition.position.x + (definition.count > 1 ? (index - 1) * 90 : 0),
        y: definition.position.y,
      };
      if (!isWalkable(state.input.map, point))
        throw new Error(`Blocked objective site: ${id}`);
      const template = definition.template;
      state.units.push({
        id,
        kind: 'OBJECTIVE',
        side: null,
        lane: null,
        position: { ...point },
        origin: { ...point },
        hp: 0,
        maxHp: template.hp,
        armor: template.armor,
        attackDamage: template.attackDamage,
        attackRange: template.attackRange,
        attackIntervalMs: template.attackIntervalMs,
        moveSpeed: template.moveSpeed,
        nextAttackAtMs: definition.spawnAtMs,
        path: [],
        active: false,
        spawnAtMs: definition.spawnAtMs,
        respawnAtMs: null,
        generation: 0,
        reward: { gold: template.gold, xp: template.xp, cs: 0 },
        objective: {
          type: definition.type,
          pit: definition.pit,
          definitionIndex,
          despawnAtMs: definition.despawnAtMs,
          respawnDelayMs: definition.respawnDelayMs,
        },
      });
    }
  });
}

/** Every attack source, including minions and spells, must check this before applying damage. */
export function environmentTargetable(
  state: EngineState,
  target: UnitState,
): boolean {
  if (!alive(target)) return false;
  if (!target.structure) return true;
  const structure = target.structure;
  if (
    structure.prerequisiteIds.some((id) =>
      state.units.some((unit) => unit.id === id && alive(unit)),
    )
  )
    return false;
  if (structure.type === 'NEXUS' || structure.type === 'NEXUS_TURRET') {
    return state.units.some(
      (unit) =>
        unit.side === target.side &&
        unit.kind === 'INHIBITOR' &&
        !unit.active &&
        unit.hp === 0,
    );
  }
  return true;
}

export function hasSiegeWave(state: EngineState, target: UnitState): boolean {
  const rules = rulesOf(state);
  if (!rules || !target.side) return false;
  return state.units.some(
    (unit) =>
      unit.kind === 'MINION' &&
      unit.side === opposite(target.side!) &&
      alive(unit) &&
      distance(unit.position, target.position) <= rules.backdoorRadius &&
      hasLineOfSight(state.input.map, unit.position, target.position),
  );
}

function activate(state: EngineState, unit: UnitState, hpFraction = 1): void {
  unit.active = true;
  unit.hp = unit.maxHp * hpFraction;
  unit.position = { ...unit.origin };
  unit.path = [];
  unit.spawnAtMs = state.simTimeMs;
  unit.nextAttackAtMs = state.simTimeMs;
  unit.respawnAtMs = null;
  unit.generation++;
  delete state.damageContributors[unit.id];
  emit(state, {
    kind: 'SPAWN',
    targetId: unit.id,
    position: { ...unit.position },
    sourceId: `${unit.id}@${unit.generation}`,
  });
  if (unit.objective)
    emit(state, {
      kind: 'OBJECTIVE_AVAILABLE',
      targetId: unit.id,
      position: { ...unit.position },
      reason: unit.objective.type,
    });
}

export function advanceEnvironment(state: EngineState): void {
  const rules = rulesOf(state);
  const env = state.environment;
  if (!rules || !env || state.status !== 'RUNNING') return;
  for (const side of sides) {
    const team = env.teams[side];
    team.baronRecipients = team.baronRecipients.filter(
      (id) =>
        team.baronUntilMs > state.simTimeMs &&
        state.actors.some((unit) => unit.id === id && alive(unit)),
    );
    team.elderRecipients = team.elderRecipients.filter(
      (id) =>
        team.elderUntilMs > state.simTimeMs &&
        state.actors.some((unit) => unit.id === id && alive(unit)),
    );
  }
  for (const unit of state.units) {
    if (unit.objective) {
      const objective = unit.objective;
      if (
        objective.despawnAtMs !== null &&
        state.simTimeMs >= objective.despawnAtMs
      ) {
        if (unit.active)
          emit(state, {
            kind: 'OBJECTIVE_DESPAWN',
            targetId: unit.id,
            reason: 'Pit lifecycle ended; no reward',
          });
        unit.active = false;
        unit.hp = 0;
        unit.path = [];
        unit.respawnAtMs = null;
        continue;
      }
      if (objective.type === 'DRAGON' && env.soulSide !== null) continue;
      const initialAt =
        objective.type === 'ELDER' ? env.elderAvailableAtMs : unit.spawnAtMs;
      if (
        !unit.active &&
        ((unit.generation === 0 &&
          initialAt !== null &&
          state.simTimeMs >= initialAt) ||
          (unit.respawnAtMs !== null && state.simTimeMs >= unit.respawnAtMs))
      ) {
        const conflict = state.units.some(
          (other) =>
            other.id !== unit.id &&
            other.active &&
            other.objective?.pit === objective.pit &&
            other.objective.type !== objective.type,
        );
        if (!conflict) activate(state, unit);
      }
    }
    if (!unit.structure) continue;
    if (
      !unit.active &&
      unit.respawnAtMs !== null &&
      state.simTimeMs >= unit.respawnAtMs
    ) {
      activate(
        state,
        unit,
        unit.structure.type === 'NEXUS_TURRET'
          ? rules.nexusTurretRespawnHpFraction
          : 1,
      );
    }
    if (!unit.active) continue;
    if (unit.structure.type === 'OUTER') {
      const steps =
        state.simTimeMs < rules.outerDecayStartMs
          ? 0
          : Math.floor(
              (state.simTimeMs - rules.outerDecayStartMs) /
                rules.outerDecayStepMs,
            ) + 1;
      unit.armor = Math.max(
        0,
        rules.structures.OUTER.armor -
          Math.min(rules.outerMaxArmorDecay, steps * rules.outerArmorDecay),
      );
    }
    if (laneTurret(unit) && environmentTargetable(state, unit)) {
      unit.structure.overgrowthStartedAtMs ??= state.simTimeMs;
      const age = state.simTimeMs - unit.structure.overgrowthStartedAtMs;
      if (
        age >= rules.overgrowthCooldownMs &&
        !unit.structure.overgrowthActive
      ) {
        const enemyNearby =
          state.actors.some(
            (enemy) =>
              enemy.side !== unit.side &&
              alive(enemy) &&
              distance(enemy.position, unit.position) <= rules.backdoorRadius,
          ) ||
          state.units.some(
            (enemy) =>
              enemy.side !== null &&
              enemy.side !== unit.side &&
              alive(enemy) &&
              distance(enemy.position, unit.position) <= rules.backdoorRadius,
          );
        if (!enemyNearby) unit.structure.overgrowthActive = true;
      }
    }
  }
}

/** Physical buff application. Never modifies world HP by itself or declares a winner. */
export function modifyEnvironmentDamage(
  state: EngineState,
  attacker: UnitState,
  target: UnitState,
  damage: number,
  basicAttack = true,
): number {
  const rules = rulesOf(state);
  const env = state.environment;
  if (!rules || !env) return damage;
  if (!Number.isFinite(damage) || damage < 0)
    throw new RangeError('Invalid environment damage');
  if (!environmentTargetable(state, target)) return 0;
  let value = damage;
  if (attacker.side && actor(attacker)) {
    const team = env.teams[attacker.side];
    value *= 1 + team.dragons * rules.objectiveBuffDamagePerDragon;
    if (env.soulSide === attacker.side) value *= rules.soulDamageMultiplier;
    if (
      target.kind === 'CHAMPION' &&
      team.elderUntilMs > state.simTimeMs &&
      team.elderRecipients.includes(attacker.id)
    )
      value *= rules.elderDamageMultiplier;
  }
  if (attacker.kind === 'MINION' && attacker.side) {
    const buff = env.teams[attacker.side];
    if (
      buff.baronUntilMs > state.simTimeMs &&
      state.actors.some(
        (unit) =>
          alive(unit) &&
          buff.baronRecipients.includes(unit.id) &&
          distance(unit.position, attacker.position) <=
            rules.baronEmpowerRadius,
      )
    )
      value *= rules.baronMinionDamageMultiplier;
  }
  if (!target.structure) return round(value);
  const wave = hasSiegeWave(state, target);
  if (!wave) value *= rules.backdoorDamageMultiplier;
  if (turret(target)) {
    if (attacker.kind === 'MINION') value *= rules.turretMinionDamageMultiplier;
    if (actor(attacker) && attacker.attackRange < 350)
      value *= rules.meleeTurretDamageMultiplier;
  }
  if (actor(attacker) && attacker.side && basicAttack) {
    const team = env.teams[attacker.side];
    value *= 1 + team.grubs * rules.grubStructureDamagePerStack;
    if (wave && laneTurret(target) && target.structure.overgrowthActive) {
      const averageLevel = state.actors
        .filter((unit) => unit.side === attacker.side)
        .reduce((sum, unit, _, all) => sum + unit.level / all.length, 0);
      const levelFraction = Math.max(0, Math.min(1, (averageLevel - 1) / 17));
      const minimum = 0.02 + 0.068 * levelFraction;
      const maximum = 0.033 + 0.156 * levelFraction;
      const age =
        state.simTimeMs -
        (target.structure.overgrowthStartedAtMs ?? state.simTimeMs) -
        rules.overgrowthCooldownMs -
        rules.overgrowthRampDelayMs;
      const fraction = Math.max(0, Math.min(1, age / rules.overgrowthRampMs));
      const bonus = target.maxHp * (minimum + (maximum - minimum) * fraction);
      value += bonus;
      target.structure.overgrowthStartedAtMs = state.simTimeMs;
      target.structure.overgrowthActive = false;
      emit(state, {
        kind: 'OVERGROWTH',
        actorId: attacker.id,
        targetId: target.id,
        amount: round(bonus),
      });
    }
    if (
      wave &&
      turret(target) &&
      team.heraldCharges > 0 &&
      distance(attacker.position, target.position) <= rules.heraldChargeRange
    ) {
      team.heraldCharges--;
      value += rules.heraldChargeDamage;
      emit(state, {
        kind: 'HERALD_CHARGE',
        actorId: attacker.id,
        targetId: target.id,
        amount: rules.heraldChargeDamage,
        reason:
          'MODEL: carried Herald charge consumed on an in-range basic turret hit',
      });
    }
  }
  return round(value);
}

function localActors(
  state: EngineState,
  target: UnitState,
  side: Side,
  radius: number,
): ActorState[] {
  return state.actors
    .filter(
      (unit) =>
        unit.side === side &&
        alive(unit) &&
        distance(unit.position, target.position) <= radius,
    )
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function localGold(
  state: EngineState,
  target: UnitState,
  side: Side,
  amount: number,
  key: string,
  kind: 'PLATE' | 'STRUCTURE',
): void {
  const eligible = localActors(
    state,
    target,
    side,
    rulesOf(state)!.plateShareRadius,
  );
  eligible.forEach((unit, index) =>
    grantReward(state, {
      key: `${key}:${unit.id}`,
      actorId: unit.id,
      sourceId: target.id,
      gold:
        Math.floor(amount / eligible.length) +
        (index < amount % eligible.length ? 1 : 0),
      xp: 0,
      cs: 0,
      kind,
    }),
  );
}

/** Threshold claims persist through later HP changes and never form banked gold. */
export function onEnvironmentDamage(
  state: EngineState,
  target: UnitState,
  beforeHp: number,
): void {
  const rules = rulesOf(state);
  if (!rules || !target.structure || !target.side || !laneTurret(target))
    return;
  if (target.hp >= beforeHp) return;
  const missing = 1 - target.hp / target.maxHp;
  while (
    target.structure.platesClaimed < rules.plateThresholds.length &&
    missing + 1e-9 >= rules.plateThresholds[target.structure.platesClaimed]
  ) {
    const plate = ++target.structure.platesClaimed;
    const key = `plate:${target.id}:${plate}`;
    if (state.rewardKeys[key]) continue;
    state.rewardKeys[key] = true;
    const steps =
      target.structure.type === 'OUTER' &&
      state.simTimeMs >= rules.outerDecayStartMs
        ? Math.floor(
            (state.simTimeMs - rules.outerDecayStartMs) /
              rules.outerDecayStepMs,
          ) + 1
        : 0;
    const value = Math.max(
      0,
      rules.plateGold -
        Math.min(rules.outerMaxGoldDecay, steps * rules.outerGoldDecay),
    );
    emit(state, {
      kind: 'PLATE',
      targetId: target.id,
      amount: value,
      sourceId: key,
    });
    localGold(state, target, opposite(target.side), value, key, 'PLATE');
  }
}

function awardObjective(
  state: EngineState,
  target: UnitState,
  killer: UnitState,
  definition: ObjectiveDefinition,
): void {
  if (!killer.side || !state.environment) return;
  const side = killer.side;
  const team = state.environment.teams[side];
  const rules = rulesOf(state)!;
  const sourceId = `${target.id}@${target.generation}`;
  if (actor(killer))
    grantReward(state, {
      key: `objective:${sourceId}:lastHit`,
      actorId: killer.id,
      sourceId,
      gold: definition.template.gold,
      xp: definition.template.xp,
      cs: 0,
      kind: 'OBJECTIVE',
    });
  if (definition.teamGold || definition.teamXp) {
    state.actors
      .filter((unit) => unit.side === side)
      .forEach((unit) =>
        grantReward(state, {
          key: `objective:${sourceId}:team:${unit.id}`,
          actorId: unit.id,
          sourceId,
          gold: definition.teamGold,
          xp: definition.teamXp,
          cs: 0,
          kind: 'OBJECTIVE',
        }),
      );
  }
  if (definition.type === 'DRAGON') {
    team.dragons++;
    if (
      team.dragons >= rules.dragonSoulStacks &&
      state.environment.soulSide === null
    ) {
      state.environment.soulSide = side;
      state.environment.elderAvailableAtMs =
        state.simTimeMs + rules.elderFirstDelayMs;
      target.respawnAtMs = null;
    }
  } else if (definition.type === 'GRUB') team.grubs++;
  else if (definition.type === 'HERALD') team.heraldCharges++;
  else if (definition.type === 'BARON') {
    team.baronUntilMs = state.simTimeMs + rules.baronBuffMs;
    team.baronRecipients = state.actors
      .filter((unit) => unit.side === side && alive(unit))
      .map((unit) => unit.id);
  } else {
    team.elderUntilMs = state.simTimeMs + rules.elderBuffMs;
    team.elderRecipients = state.actors
      .filter((unit) => unit.side === side && alive(unit))
      .map((unit) => unit.id);
  }
  emit(state, {
    kind: 'OBJECTIVE_CAPTURED',
    actorId: killer.id,
    targetId: target.id,
    sourceId,
    reason: `${side}:${definition.type}`,
  });
}

/** Returns true only for deaths owned by this module, preventing ordinary CS/death rewards. */
export function awardEnvironmentDeath(
  state: EngineState,
  target: UnitState,
  killer: UnitState | null,
): boolean {
  const rules = rulesOf(state);
  const env = state.environment;
  if (!rules || !env || (!target.objective && !target.structure)) return false;
  if (
    target.active ||
    target.hp !== 0 ||
    target.spawnAtMs > state.simTimeMs ||
    !hasCurrentDeathEvent(state, target.id)
  )
    throw new Error('Environment death requires a real death event');
  if (killer && target.side !== null && killer.side === target.side)
    throw new Error('Friendly environment kill');
  if (target.structure?.type === 'NEXUS') {
    const defenders = state.units.filter((unit) => unit.side === target.side);
    const legal =
      !defenders.some(
        (unit) => unit.structure?.type === 'NEXUS_TURRET' && alive(unit),
      ) &&
      defenders.some(
        (unit) => unit.kind === 'INHIBITOR' && !unit.active && unit.hp === 0,
      );
    if (!legal || !killer?.side || killer.side === target.side)
      throw new Error('Illegal nexus destruction');
  }
  const deathKey = `environmentDeath:${target.id}@${target.generation}`;
  if (state.rewardKeys[deathKey]) return true;
  state.rewardKeys[deathKey] = true;
  if (target.objective) {
    const definition = rules.objectives[target.objective.definitionIndex];
    target.respawnAtMs =
      target.objective.respawnDelayMs === null
        ? null
        : state.simTimeMs + target.objective.respawnDelayMs;
    if (killer) awardObjective(state, target, killer, definition);
    return true;
  }
  const structure = target.structure!;
  const side = target.side!;
  if (structure.type === 'INHIBITOR')
    target.respawnAtMs = state.simTimeMs + rules.inhibitorRespawnMs;
  if (structure.type === 'NEXUS_TURRET')
    target.respawnAtMs = state.simTimeMs + rules.nexusTurretRespawnMs;
  const firstLifeKey = `structureReward:${target.id}`;
  if (!state.rewardKeys[firstLifeKey]) {
    state.rewardKeys[firstLifeKey] = true;
    const winningSide = opposite(side);
    if (turret(target) && !env.firstTurretClaimed) {
      env.firstTurretClaimed = true;
      localGold(
        state,
        target,
        winningSide,
        rules.firstTurretGold,
        `${firstLifeKey}:first`,
        'STRUCTURE',
      );
    }
    const globalGold = rules.structures[structure.type].globalGold;
    if (globalGold)
      state.actors
        .filter((unit) => unit.side === winningSide)
        .forEach((unit) =>
          grantReward(state, {
            key: `${firstLifeKey}:global:${unit.id}`,
            actorId: unit.id,
            sourceId: target.id,
            gold: globalGold,
            xp: 0,
            cs: 0,
            kind: 'STRUCTURE',
          }),
        );
  }
  emit(state, {
    kind: 'STRUCTURE_DESTROYED',
    targetId: target.id,
    reason: structure.type,
    sourceId: deathKey,
  });
  if (structure.type === 'NEXUS') {
    if (state.status === 'RUNNING') {
      state.status = 'FINISHED';
      state.winnerTeamId = state.input.teams.find(
        (team) => team.side === killer!.side,
      )!.teamId;
      emit(state, {
        kind: 'NEXUS_DESTROYED',
        targetId: target.id,
        actorId: killer!.id,
        reason: killer!.side!,
      });
    }
  }
  return true;
}

/** Inhibitor pressure is attached when each real wave spawns, never retrospective gold. */
export function applySuperMinion(
  state: EngineState,
  minion: UnitState,
  index: number,
): void {
  if (
    !rulesOf(state) ||
    minion.kind !== 'MINION' ||
    !minion.side ||
    !minion.lane ||
    index !== 0
  )
    return;
  const inhibitor = state.units.find(
    (unit) =>
      unit.id ===
      structureId(opposite(minion.side!), minion.lane!, 'INHIBITOR'),
  );
  if (inhibitor?.active !== false || inhibitor.hp !== 0) return;
  // MODEL aggregate super unit. All scaling is realized in HP/AD, not another score bonus.
  minion.maxHp *= 3;
  minion.hp = minion.maxHp;
  minion.attackDamage *= 3;
}
