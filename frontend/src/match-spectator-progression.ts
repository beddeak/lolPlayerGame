import type { ReplayPlayer, SpectatorReplay } from "./match-spectator";

// Spectator rules, deliberately not a claim to reproduce a particular Riot patch.
const XP_THRESHOLDS = Array.from({ length: 18 }, (_, i) => 280 * i + 50 * i * (i - 1));
const FARM = { TOP: 7, JUNGLE: 5.7, MID: 7.5, ADC: 8, SUPPORT: 1.1 };
const XP_PER_SECOND = { TOP: 9.2, JUNGLE: 8.7, MID: 9.2, ADC: 8, SUPPORT: 8 };
export function deathSeconds(level: number, time: number) {
  return Math.round(Math.min(78, (6 + Math.max(1, Math.min(18, level)) * 2.2) * (1 + Math.max(0, time - 900) / 3600)));
}
export interface ProgressFrame {
  health: number; cs: number; xp: number; level: number; respawnRemaining: number;
  recovery: "NONE" | "RECALL" | "FOUNTAIN" | "RETURN";
  recallProgress: number; returnProgress: number;
}
type Actor = ProgressFrame & { farm: number; deadUntil: number; lastDamage: number; recallAt: number; leaveAt: number };
const cache = new WeakMap<SpectatorReplay, Map<number, ProgressFrame[]>>();
const levelFor = (xp: number) => Math.max(1, XP_THRESHOLDS.findLastIndex(value => value <= xp) + 1);

/** Compile once, chronologically. Rendering/seeking never heals or awards CS/XP a second time. */
export function initializeProgression(replay: SpectatorReplay) {
  if (cache.has(replay)) return;
  const tracks = new Map<number, ProgressFrame[]>();
  const actors = new Map<number, Actor>();
  const relevant = new Map(replay.players.map(p => [p.id, replay.events.filter(e => e.participants.includes(p.id))]));
  for (const p of replay.players) {
    actors.set(p.id, { health: 1, cs: 0, xp: 0, level: 1, respawnRemaining: 0, recovery: "NONE", recallProgress: 0,
      returnProgress: 1, farm: 0, deadUntil: 0, lastDamage: -100, recallAt: -1, leaveAt: -1 });
    tracks.set(p.id, []);
  }
  for (let time = 0; time <= Math.ceil(replay.duration) + 1; time++) {
    for (const p of replay.players) {
      const actor = actors.get(p.id)!;
      const events = relevant.get(p.id)!;
      const committed = events.some(e => e.kind !== "TRADE" && time >= e.startsAt - 45 && time <= e.at + 15);
      const death = replay.events.find(e => e.kind === "KILL" && e.victim === p.id && e.at === time);
      if (death) {
        death.deathLevel ??= actor.level;
        death.respawnAt ??= time + deathSeconds(death.deathLevel, time);
        actor.deadUntil = death.respawnAt;
        actor.health = 0; actor.recallAt = -1; actor.leaveAt = -1;
      }
      actor.respawnRemaining = Math.max(0, actor.deadUntil - time);
      actor.recovery = "NONE"; actor.recallProgress = 0; actor.returnProgress = 1;
      if (time < actor.deadUntil) {
        actor.health = 0;
      } else {
        if (actor.deadUntil > 0 && time === actor.deadUntil) actor.health = 1;
        const active = events.filter(e => (e.kind === "KILL" || e.kind === "TRADE") && time > e.startsAt && time <= e.at);
        if (actor.recallAt >= 0) {
          const baseAt = actor.recallAt + 8;
          if (time < baseAt) {
            if (active.some(e => e.kind === "KILL")) actor.recallAt = -1;
            else { actor.recovery = "RECALL"; actor.recallProgress = (time - actor.recallAt) / 8; }
          } else if (time <= actor.leaveAt) {
            actor.recovery = "FOUNTAIN"; actor.health = Math.min(1, actor.health + .07);
          } else if (time < actor.leaveAt + 40) {
            actor.recovery = "RETURN"; actor.returnProgress = (time - actor.leaveAt) / 40;
          } else actor.recallAt = -1;
        }
        if (actor.recovery === "NONE" && time > 0) {
          for (const e of active) {
            const enemyId = e.side === p.side ? e.victim : e.actor;
            const enemyLevel = actors.get(enemyId ?? -1)?.level ?? actor.level;
            const pressure = Math.max(.7, Math.min(1.3, 1 + (enemyLevel - actor.level) * .035));
            if (e.kind === "KILL" && e.victim === p.id) {
              actor.health = Math.max(0, actor.health - actor.health / Math.max(1, e.at - time + 1));
            } else {
              const damage = e.kind === "TRADE" ? (e.damage ?? .12) : e.actor === p.id ? .18 : .08;
              actor.health = Math.max(Math.min(.04, actor.health), actor.health - damage * pressure / Math.max(1, e.at - e.startsAt));
            }
            actor.lastDamage = time;
          }
          // Slow regeneration only after leaving combat. A kill/level-up never grants health.
          if (!active.length && time - actor.lastDamage > 12) actor.health = Math.min(1, actor.health + .00065);
          const nextCommitment = events.filter(e => e.kind !== "TRADE" && e.startsAt - 45 > time).reduce((next, e) => Math.min(next, e.startsAt - 45), Infinity);
          if (actor.health < .42 && !committed && time - actor.lastDamage > 12 && nextCommitment - time > 100) {
            actor.recallAt = time; actor.leaveAt = time + 8 + Math.ceil((1 - actor.health) / .07);
            actor.recovery = "RECALL";
          }
        }
        const walkingFromDeath = actor.deadUntil > 0 && time < actor.deadUntil + 35;
        // Last hits and shared lane XP stop while dead, recalling, rotating or fighting.
        if (time >= 110 && !walkingFromDeath && actor.recovery === "NONE" && !committed && !active.length) {
          actor.farm += (FARM[p.position] + (p.farmBonus ?? 0)) / 60;
          actor.cs = Math.floor(actor.farm);
          actor.xp += XP_PER_SECOND[p.position];
        }
        for (const e of events.filter(e => e.kind === "KILL" && e.at === time && e.victim !== p.id)) {
          if (e.actor === p.id) actor.xp += 180 + actor.level * 12;
          else if (e.assists.includes(p.id)) actor.xp += 95 + actor.level * 7;
        }
        const previousMaxHealth = 600 + 85 * (actor.level - 1);
        actor.level = levelFor(actor.xp);
        // Raising maximum HP is not a kill-triggered heal; preserve current absolute HP.
        actor.health *= previousMaxHealth / (600 + 85 * (actor.level - 1));
      }
      tracks.get(p.id)!.push({ health: actor.health, cs: actor.cs, xp: actor.xp, level: actor.level,
        respawnRemaining: actor.respawnRemaining, recovery: actor.recovery, recallProgress: actor.recallProgress, returnProgress: actor.returnProgress });
    }
  }
  cache.set(replay, tracks);
}

export function progressionFrame(replay: SpectatorReplay, player: ReplayPlayer, time: number): ProgressFrame {
  initializeProgression(replay);
  const track = cache.get(replay)!.get(player.id)!;
  const at = Math.max(0, Math.min(replay.duration, time)), index = Math.floor(at);
  const frame = track[index], next = track[index + 1] ?? frame;
  const maxHealth = 600 + 85 * (frame.level - 1), nextMax = 600 + 85 * (next.level - 1);
  const hp = frame.health * maxHealth, nextHp = next.health * nextMax;
  const health = frame.respawnRemaining > 0 ? 0 : Math.min(1, (hp + (nextHp - hp) * (at - index)) / maxHealth);
  return { ...frame, health, respawnRemaining: Math.max(0, frame.respawnRemaining - (at - index)) };
}
