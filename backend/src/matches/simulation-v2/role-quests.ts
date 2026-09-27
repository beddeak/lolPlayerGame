import {
  actorLane,
  emit,
  type EngineState,
  type SimPosition,
} from './contracts';
import { grantReward } from './economy-ledger';

/** Operational approximation, not the complete live role-quest scoring table. */
export interface RoleQuestRules {
  version: string;
  targets: Record<SimPosition, number>;
  completionGold: Record<SimPosition, number>;
  completionXp: Record<SimPosition, number>;
  midRecallMs: number;
}
export interface RoleQuestState {
  cursor: number;
  actors: Record<string, { points: number; completedAtMs: number | null }>;
}
export function createRoleQuestRules(): RoleQuestRules {
  return {
    version: 'OPERATIONAL_ROLE_QUEST_MODEL_1',
    targets: { TOP: 1200, MID: 1350, ADC: 1350, JUNGLE: 600, SUPPORT: 500 },
    completionGold: { TOP: 0, MID: 0, ADC: 300, JUNGLE: 0, SUPPORT: 200 },
    completionXp: { TOP: 600, MID: 0, ADC: 0, JUNGLE: 300, SUPPORT: 0 },
    midRecallMs: 5500,
  };
}
export function initializeRoleQuests(state: EngineState): void {
  if (!state.input.rules.roleQuests) return;
  state.roleQuests = {
    cursor: 0,
    actors: Object.fromEntries(
      state.actors.map((actor) => [
        actor.id,
        { points: 0, completedAtMs: null },
      ]),
    ),
  };
}

/** Consume authoritative ledger/events once, never periodic free progress or UI actions. */
export function advanceRoleQuests(state: EngineState): void {
  const rules = state.input.rules.roleQuests;
  const quests = state.roleQuests;
  if (!rules || !quests) return;
  const end = state.events.length;
  const rewardAt = (seq: number) => {
    let low = 0,
      high = state.ledger.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2),
        entry = state.ledger[mid];
      if (entry.seq === seq) return entry;
      if (entry.seq < seq) low = mid + 1;
      else high = mid - 1;
    }
    return undefined;
  };
  for (let index = quests.cursor; index < end; index++) {
    const event = state.events[index];
    const actor = state.actors.find(
      (candidate) => candidate.id === event.actorId,
    );
    if (!actor) continue;
    const quest = quests.actors[actor.id];
    if (quest.completedAtMs !== null) continue;
    const role = actor.input.position;
    const reward = event.kind === 'REWARD' ? rewardAt(event.seq) : undefined;
    let points = 0;
    if (reward?.kind === 'MINION' && reward.cs > 0 && role !== 'JUNGLE') {
      // source ID includes the actual lane, not the player's chosen champion class.
      points = reward.sourceId.includes(`:${actorLane(role)}:`)
        ? reward.cs * 10
        : reward.cs * 3;
    } else if (reward?.kind === 'CAMP' && role === 'JUNGLE')
      points = reward.cs * 10;
    else if (reward?.kind === 'KILL' || reward?.kind === 'ASSIST') points = 50;
    else if (reward?.kind === 'PLATE' || reward?.kind === 'STRUCTURE')
      points = 40;
    else if (event.kind === 'WARD_PLACED' && role === 'SUPPORT') points = 50;
    if (!points) continue;
    quest.points = Math.min(rules.targets[role], quest.points + points);
    if (quest.points < rules.targets[role]) continue;
    quest.completedAtMs = state.simTimeMs;
    emit(state, {
      kind: 'QUEST_COMPLETE',
      actorId: actor.id,
      amount: quest.points,
      reason: role,
    });
    grantReward(state, {
      key: `quest:${actor.id}`,
      sourceId: rules.version,
      actorId: actor.id,
      gold: rules.completionGold[role],
      xp: rules.completionXp[role],
      cs: 0,
      kind: 'QUEST',
    });
  }
  quests.cursor = end;
}
export function recallDuration(state: EngineState, actorId: string): number {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  return actor?.input.position === 'MID' &&
    state.roleQuests?.actors[actorId]?.completedAtMs != null
    ? state.input.rules.roleQuests!.midRecallMs
    : state.input.rules.recallMs;
}
