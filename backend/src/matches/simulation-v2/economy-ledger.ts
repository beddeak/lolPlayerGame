import {
  emit,
  hasCurrentDeathEvent,
  type ActorState,
  type EngineState,
  type LedgerEntry,
  type UnitState,
} from './contracts';
import { distance } from './map-paths';

type Reward = Omit<LedgerEntry, 'seq' | 'atMs'>;

function nonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new RangeError(`${name} must be finite and nonnegative`);
}

function applyLevelUps(state: EngineState, actor: ActorState): void {
  const { maxLevel, levelXp } = state.input.rules;
  while (actor.level < maxLevel && actor.xp >= levelXp[actor.level]) {
    actor.level++;
    actor.maxHp += actor.input.profile.hpPerLevel;
    actor.attackDamage += actor.input.profile.attackPerLevel;
    // More maximum health is not a free heal. Fountain recovery is a separate action.
    emit(state, { kind: 'LEVEL_UP', actorId: actor.id, amount: actor.level });
  }
}

/** Internal resolver boundary; rewards never derive from UI/frame calls. */
export function grantReward(state: EngineState, reward: Reward): boolean {
  const actor = state.actors.find(
    (candidate) => candidate.id === reward.actorId,
  );
  if (!actor) throw new RangeError(`Unknown reward actor: ${reward.actorId}`);
  if (!reward.key || !reward.sourceId || reward.kind === 'PURCHASE')
    throw new RangeError('Rewards require a source and a non-purchase kind');
  nonnegative(reward.gold, 'Reward gold');
  nonnegative(reward.xp, 'Reward XP');
  nonnegative(reward.cs, 'Reward CS');
  if (!Number.isSafeInteger(reward.cs))
    throw new RangeError('CS must be an integer');
  if (Object.hasOwn(state.rewardKeys, reward.key)) return false;
  if (reward.kind === 'STARTING') {
    if (
      reward.xp !== 0 ||
      reward.cs !== 0 ||
      reward.gold !== state.input.rules.startingGold
    )
      throw new RangeError('Starting assets must match the pinned ruleset');
    if (
      state.ledger.some(
        (entry) => entry.actorId === actor.id && entry.kind === 'STARTING',
      )
    )
      return false;
  }
  for (const [name, value] of Object.entries({
    gold: actor.gold + reward.gold,
    xp: actor.xp + reward.xp,
    cs: actor.stats.cs + reward.cs,
    earnedGold:
      actor.stats.goldEarned + (reward.kind === 'STARTING' ? 0 : reward.gold),
    earnedXp: actor.stats.xpEarned + reward.xp,
  }))
    nonnegative(value, `Accumulated ${name}`);
  Object.defineProperty(state.rewardKeys, reward.key, {
    value: true,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const event = emit(state, {
    kind: 'REWARD',
    actorId: actor.id,
    sourceId: reward.sourceId,
    amount: reward.gold,
    reason: reward.kind,
  });
  state.ledger.push({ ...reward, seq: event.seq, atMs: state.simTimeMs });
  actor.gold += reward.gold;
  actor.xp += reward.xp;
  if (reward.kind !== 'STARTING') actor.stats.goldEarned += reward.gold;
  actor.stats.xpEarned += reward.xp;
  actor.stats.cs += reward.cs;
  applyLevelUps(state, actor);
  return true;
}

/** Called once the shared action resolver has emitted the real death transition. */
export function awardDeath(
  state: EngineState,
  victim: UnitState,
  killerId: string | null,
  assistIds: string[],
): void {
  if (victim.active || victim.hp !== 0 || victim.spawnAtMs > state.simTimeMs)
    throw new RangeError('A living or unspawned unit cannot award a death');
  const sourceId = `${victim.id}@${victim.generation}`;
  const deathKey = `death:${sourceId}`;
  if (Object.hasOwn(state.rewardKeys, deathKey)) return;
  if (!hasCurrentDeathEvent(state, victim.id))
    throw new RangeError('Death rewards require an authoritative death event');
  const killer = state.actors.find((actor) => actor.id === killerId);
  if (killer && victim.side === killer.side)
    throw new RangeError('A friendly unit cannot award a kill');
  state.rewardKeys[deathKey] = true;
  if (victim.kind === 'CAMP')
    victim.respawnAtMs = state.simTimeMs + state.input.rules.campRespawnMs;

  if (victim.kind === 'CHAMPION') {
    const defeated = state.actors.find((actor) => actor.id === victim.id);
    if (!defeated) throw new RangeError('Unknown defeated actor');
    defeated.stats.deaths++;
    if (!killer) return;
    killer.stats.kills++;
    grantReward(state, {
      key: `${deathKey}:kill`,
      actorId: killer.id,
      sourceId,
      gold: state.input.rules.killGold,
      xp: state.input.rules.killXp,
      cs: 0,
      kind: 'KILL',
    });
    const contributors = state.damageContributors[victim.id] ?? {};
    const assists = [...new Set(assistIds)]
      .map((id) => state.actors.find((actor) => actor.id === id))
      .filter(
        (actor): actor is ActorState =>
          !!actor &&
          actor.id !== killer.id &&
          actor.side === killer.side &&
          Object.hasOwn(contributors, actor.id) &&
          contributors[actor.id] <= state.simTimeMs &&
          contributors[actor.id] >=
            state.simTimeMs - state.input.rules.assistWindowMs,
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const [index, actor] of assists.entries()) {
      actor.stats.assists++;
      const pool = state.input.rules.assistGold;
      grantReward(state, {
        key: `${deathKey}:assist:${actor.id}`,
        actorId: actor.id,
        sourceId,
        gold:
          Math.floor(pool / assists.length) +
          (index < pool % assists.length ? 1 : 0),
        xp: 0,
        cs: 0,
        kind: 'ASSIST',
      });
    }
    return;
  }

  const eligible = state.actors.filter(
    (actor) =>
      actor.active &&
      actor.hp > 0 &&
      (victim.kind === 'MINION'
        ? actor.side !== victim.side
        : actor.side === killer?.side) &&
      distance(actor.position, victim.position) <= state.input.rules.xpRadius,
  );
  if (victim.kind !== 'MINION' && victim.kind !== 'CAMP') return;
  const kind = victim.kind;
  if (killer) {
    grantReward(state, {
      key: `${deathKey}:lastHit`,
      actorId: killer.id,
      sourceId,
      gold: victim.reward.gold,
      xp: 0,
      cs: victim.reward.cs,
      kind,
    });
  }
  for (const actor of eligible) {
    grantReward(state, {
      key: `${deathKey}:xp:${actor.id}`,
      actorId: actor.id,
      sourceId,
      gold: 0,
      xp: victim.reward.xp / eligible.length,
      cs: 0,
      kind,
    });
  }
}

/** Explicit approximate shop: unique permanent items, six slots, fountain only. */
export function purchaseItem(
  state: EngineState,
  actorId: string,
  itemId: string,
): boolean {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const item = state.input.rules.items.find(
    (candidate) => candidate.id === itemId,
  );
  if (!actor || !item) return false;
  if (
    !actor.active ||
    actor.hp <= 0 ||
    actor.action.kind === 'DEAD' ||
    actor.action.kind === 'RECALL' ||
    actor.items.length >= 6 ||
    actor.items.includes(itemId) ||
    distance(actor.position, state.input.map.bases[actor.side]) >
      state.input.rules.fountainRadius
  )
    return false;
  for (const [name, value] of Object.entries(item))
    if (typeof value === 'number') nonnegative(value, `Item ${name}`);
  if (actor.gold < item.cost) return false;
  const key = `purchase:${actor.id}:${item.id}`;
  if (Object.hasOwn(state.rewardKeys, key)) return false;
  const event = emit(state, {
    kind: 'PURCHASE',
    actorId: actor.id,
    sourceId: item.id,
    amount: item.cost,
  });
  state.rewardKeys[key] = true;
  state.ledger.push({
    key,
    seq: event.seq,
    atMs: state.simTimeMs,
    actorId: actor.id,
    sourceId: item.id,
    gold: -item.cost,
    xp: 0,
    cs: 0,
    kind: 'PURCHASE',
  });
  actor.gold -= item.cost;
  actor.stats.goldSpent += item.cost;
  actor.items.push(item.id);
  actor.attackDamage += item.attackDamage;
  actor.maxHp += item.maxHp;
  actor.armor += item.armor;
  return true;
}
