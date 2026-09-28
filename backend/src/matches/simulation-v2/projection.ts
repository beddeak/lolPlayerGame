import type { EngineState, ReplayFrame } from './contracts';
import { canonicalHash } from './seeded-rng';

export { canonicalHash as stableStateHash } from './seeded-rng';

/**
 * One snapshot per simulation timestamp; playback never calls this to advance time.
 * Remaining waypoints are preserved. Mid-interval commands still require events or
 * denser frames: these samples alone do not promise perfect wall-safe interpolation.
 */
export function projectFrame(state: EngineState): ReplayFrame {
  return {
    atMs: state.simTimeMs,
    actors: state.actors.map((actor) => ({
      id: actor.id,
      position: { ...actor.position },
      hp: actor.hp,
      maxHp: actor.maxHp,
      level: actor.level,
      gold: actor.gold,
      cs: actor.stats.cs,
      active: actor.active,
      action: actor.action.kind,
      path: actor.path.map((point) => ({ ...point })),
      moveSpeed: actor.moveSpeed,
    })),
    units: state.units
      .filter((unit) => unit.active)
      .map((unit) => ({
        id: unit.id,
        kind: unit.kind,
        side: unit.side,
        position: { ...unit.position },
        hp: unit.hp,
        maxHp: unit.maxHp,
        path: unit.path.map((point) => ({ ...point })),
        moveSpeed: unit.moveSpeed,
      })),
  };
}

export function captureFrame(state: EngineState): ReplayFrame {
  const previous = state.frames.at(-1);
  if (previous && previous.atMs > state.simTimeMs)
    throw new RangeError('Cannot capture a frame before an existing snapshot');
  const frame = projectFrame(state);
  if (previous?.atMs === state.simTimeMs)
    state.frames[state.frames.length - 1] = frame;
  else state.frames.push(frame);
  return frame;
}

const divide = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0;

/** Report only what the authoritative event/reward ledger actually contains. */
export function projectMatch(state: EngineState) {
  const actorById = new Map(state.actors.map((actor) => [actor.id, actor]));
  const totals = new Map(
    state.actors.map((actor) => [
      actor.id,
      {
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        goldEarned: 0,
        goldSpent: 0,
        xpEarned: 0,
        damageToChampions: 0,
        damageTaken: 0,
        startingGold: 0,
      },
    ]),
  );
  for (const event of state.events) {
    if (
      event.kind === 'DEATH' &&
      event.targetId &&
      actorById.has(event.targetId)
    ) {
      totals.get(event.targetId)!.deaths++;
      const killer = event.actorId ? actorById.get(event.actorId) : undefined;
      if (killer && killer.side !== actorById.get(event.targetId)!.side)
        totals.get(killer.id)!.kills++;
    }
    if (
      event.kind === 'DAMAGE' &&
      event.targetId &&
      actorById.has(event.targetId)
    ) {
      const amount = event.amount ?? 0;
      if (!Number.isFinite(amount) || amount < 0)
        throw new RangeError('Invalid damage event');
      totals.get(event.targetId)!.damageTaken += amount;
      const attacker = event.actorId ? actorById.get(event.actorId) : undefined;
      if (attacker && attacker.side !== actorById.get(event.targetId)!.side)
        totals.get(attacker.id)!.damageToChampions += amount;
    }
  }
  const processed = new Set<string>();
  for (const entry of state.ledger) {
    if (processed.has(entry.key))
      throw new RangeError(`Duplicate ledger key: ${entry.key}`);
    processed.add(entry.key);
    const total = totals.get(entry.actorId);
    if (!total) throw new RangeError(`Unknown ledger actor: ${entry.actorId}`);
    if (![entry.gold, entry.xp, entry.cs].every(Number.isFinite))
      throw new RangeError('Invalid ledger number');
    if (entry.kind === 'STARTING') total.startingGold += entry.gold;
    else if (entry.kind === 'PURCHASE') total.goldSpent -= entry.gold;
    else total.goldEarned += entry.gold;
    total.xpEarned += entry.xp;
    total.cs += entry.cs;
    if (entry.kind === 'ASSIST') total.assists++;
  }
  const teams = state.input.teams.map((team) => {
    const own = state.actors
      .filter((actor) => actor.side === team.side)
      .map((actor) => totals.get(actor.id)!);
    return {
      teamId: team.teamId,
      side: team.side,
      kills: own.reduce((sum, actor) => sum + actor.kills, 0),
      goldEarned: own.reduce((sum, actor) => sum + actor.goldEarned, 0),
      damageToChampions: own.reduce(
        (sum, actor) => sum + actor.damageToChampions,
        0,
      ),
    };
  });
  const players = state.actors.map((actor) => {
    const total = totals.get(actor.id)!;
    const team = teams.find((candidate) => candidate.side === actor.side)!;
    const enemy = state.actors.find(
      (candidate) =>
        candidate.side !== actor.side &&
        candidate.input.position === actor.input.position,
    );
    const snapshot =
      state.simTimeMs >= 900_000 ? state.at15?.[actor.id] : undefined;
    const opponentSnapshot =
      enemy && state.simTimeMs >= 900_000 ? state.at15?.[enemy.id] : undefined;
    return {
      actorId: actor.id,
      careerPlayerId: actor.input.careerPlayerId,
      teamId: actor.input.teamId,
      side: actor.side,
      position: actor.input.position,
      championId: actor.input.championId,
      ...total,
      walletGold: total.startingGold + total.goldEarned - total.goldSpent,
      dpm: divide(total.damageToChampions, state.simTimeMs / 60_000),
      kda: (total.kills + total.assists) / Math.max(1, total.deaths),
      kp: divide(total.kills + total.assists, team.kills) * 100,
      damageShare:
        divide(total.damageToChampions, team.damageToChampions) * 100,
      goldShare: divide(total.goldEarned, team.goldEarned) * 100,
      gdAt15:
        snapshot && opponentSnapshot
          ? snapshot.goldEarned - opponentSnapshot.goldEarned
          : null,
      csdAt15:
        snapshot && opponentSnapshot ? snapshot.cs - opponentSnapshot.cs : null,
    };
  });
  return {
    schemaVersion: 1 as const,
    engineVersion: state.input.engineVersion,
    rulesetVersion: state.input.rules.version,
    simTimeMs: state.simTimeMs,
    status: state.status,
    winnerTeamId: state.winnerTeamId,
    stateHash: canonicalHash({ ...state, frames: [] }),
    ledgerHash: canonicalHash(state.ledger),
    players,
    teams,
  };
}
