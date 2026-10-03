import { CHAMPIONS_BY_ID } from '../../drafts/champion-catalog';
import type {
  ActorState,
  EngineInput,
  Observation,
  Point,
  UnitView,
} from './contracts';
import type { BattlePublicInformation } from './battle-planner';
import { distance, findPath } from './map-paths';
import { tacticalPolicy } from './tactics';

const health = (unit: UnitView | ActorState) =>
  unit.hp / Math.max(1, unit.maxHp);
const alive = (unit: UnitView | ActorState) => unit.active && unit.hp > 0;

export interface TeamMacroDecision {
  objectiveId: string | null;
  objectiveMembers: ReadonlySet<string>;
  /** A visible contest to concede, not permission to start that objective. */
  tradeObjectiveId: string | null;
  splitActorId: string | null;
  focusTargetId: string | null;
}

/** The selector and each member's local planner must agree on who can arrive. */
export function coordinatedArrivalLimit(
  input: EngineInput,
  actor: ActorState,
): number {
  return Math.min(
    22,
    15 + tacticalPolicy(input, actor.input, input.meta).coordination * 8,
  );
}

/** One observation, one team order. Only friendly state, current vision and
 * public objective/structure lifecycle are allowed here; no EngineState or RNG.
 * These are preferences, never damage, movement, rewards or a winner override. */
export function coordinateMacro(
  observation: Observation,
  input: EngineInput,
  info: BattlePublicInformation,
  macro: boolean,
): TeamMacroDecision {
  const revised = input.rules.macroAi === 'COORDINATED_V2';
  const now = observation.atMs;
  const allies = observation.allies.filter(alive);
  const enemies = observation.visible.filter(
    (unit) =>
      alive(unit) && unit.kind === 'CHAMPION' && unit.side !== observation.side,
  );
  const ready = allies.filter(
    (actor) =>
      health(actor) > 0.55 &&
      actor.action.kind !== 'RECALL' &&
      // The local planner deliberately holds these actors for real fountain
      // recovery. Counting them would make arrived teammates wait for nobody.
      (!revised ||
        !(
          distance(actor.position, input.map.bases[actor.side]) <=
            input.rules.fountainRadius &&
          (health(actor) < 0.98 ||
            (actor.maxMana > 0 && actor.mana / actor.maxMana < 0.95))
        )),
  );
  const baseThreat = info.structures.some(
    (structure) =>
      structure.side === observation.side &&
      structure.active &&
      ['NEXUS', 'NEXUS_TURRET', 'INHIBITOR'].includes(structure.type) &&
      observation.visible.some(
        (enemy) =>
          alive(enemy) &&
          enemy.side !== null &&
          enemy.side !== observation.side &&
          distance(enemy.position, structure.position) < 1200,
      ),
  );
  const travel = (actor: ActorState, point: Point) => {
    const path = findPath(input.map, actor.position, point);
    return path
      ? path.reduce(
          (sum, node, i) =>
            sum + distance(i ? path[i - 1] : actor.position, node),
          0,
        ) / actor.moveSpeed
      : Infinity;
  };

  const candidates =
    baseThreat || (info.siegeBuffUntilMs ?? 0) > now
      ? []
      : info.objectives
          .filter(
            (objective) =>
              objective.nextAtMs !== null && objective.nextAtMs <= now + 20_000,
          )
          .map((objective) => {
            const needed =
              objective.type === 'BARON' || objective.type === 'ELDER'
                ? 4
                : objective.type === 'HERALD'
                  ? 3
                  : 2;
            const members = ready
              .filter(
                (actor) =>
                  (!info.own[actor.id]?.busy ||
                    (actor.action.kind === 'ATTACK' &&
                      actor.action.targetId === objective.id)) &&
                  !(
                    actor.plan?.objectiveBackoff?.id === objective.id &&
                    actor.plan.objectiveBackoff.untilMs > now
                  ) &&
                  (macro ||
                    ['JUNGLE', 'SUPPORT'].includes(actor.input.position) ||
                    distance(actor.position, objective.position) < 2500),
              )
              .map((actor) => ({
                actor,
                seconds: travel(actor, objective.position),
              }))
              .filter(({ actor, seconds }) =>
                revised
                  ? seconds < coordinatedArrivalLimit(input, actor)
                  : seconds <= 22,
              )
              .sort(
                (a, b) =>
                  a.seconds - b.seconds || a.actor.id.localeCompare(b.actor.id),
              );
            const foes = enemies.filter(
              (enemy) => distance(enemy.position, objective.position) < 2400,
            );
            const selected = members.slice(
              0,
              Math.max(needed, foes.length + 1),
            );
            // Include Smite if its owner can arrive, without replacing an already
            // engaged finisher or pretending it deals damage before actual arrival.
            const jungler = members.find(
              ({ actor }) => actor.input.position === 'JUNGLE',
            );
            if (jungler && !selected.includes(jungler)) selected.push(jungler);
            const definition = input.rules.environment!.objectives.find(
              (entry) => entry.type === objective.type,
            )!;
            const seen = observation.visible.find(
              (unit) => unit.id === objective.id && alive(unit),
            );
            const finish = () => {
              const dps = selected.reduce(
                (sum, { actor }) =>
                  sum +
                  (((actor.attackDamage * 1000) / actor.attackIntervalMs) *
                    100) /
                    (100 + definition.template.armor),
                0,
              );
              const seconds =
                (seen?.hp ?? definition.template.hp) / Math.max(1, dps);
              const hitPoints = selected.reduce(
                (sum, { actor }) => sum + actor.hp,
                0,
              );
              return {
                seconds,
                survives:
                  hitPoints >
                  ((seconds * definition.template.attackDamage * 1000) /
                    definition.template.attackIntervalMs) *
                    1.3,
              };
            };
            for (const member of members) {
              if (finish().survives) break;
              if (!selected.includes(member)) selected.push(member);
            }
            const { seconds, survives } = finish();
            const feasible =
              selected.length >= needed &&
              selected.length > foes.length &&
              survives;
            const engaged = selected.some(
              ({ actor }) =>
                actor.action.kind === 'ATTACK' &&
                actor.action.targetId === objective.id,
            );
            const preparing = selected.some(
              ({ actor }) =>
                actor.plan?.kind === 'SETUP' &&
                actor.plan.targetId === objective.id &&
                actor.plan.expiresAtMs > now,
            );
            const priority =
              objective.type === 'ELDER'
                ? 8
                : objective.type === 'BARON'
                  ? 6
                  : objective.type === 'DRAGON'
                    ? 4
                    : 3;
            return {
              objective,
              selected,
              feasible,
              contested: foes.length >= needed,
              score:
                priority +
                (engaged ? 12 : preparing ? 2 : 0) -
                foes.length * 1.5 -
                Math.max(0, ...selected.map((member) => member.seconds)) * 0.2 -
                seconds * 0.025,
            };
          })
          .sort(
            (a, b) =>
              b.score - a.score || a.objective.id.localeCompare(b.objective.id),
          );
  const objective = candidates.find((candidate) => candidate.feasible);
  // A rejected contest must remain visible to the opposite-side trade branch.
  // It never grants members, monster damage, or an objective reward.
  const trade =
    revised && !objective && macro
      ? candidates.find((candidate) => candidate.contested)
      : undefined;

  // A tank/engage TOP belongs with the carries; split duty is a champion/team
  // decision, not the TOP label. No teleport exists: group for major contests.
  const split =
    macro &&
    !baseThreat &&
    !objective &&
    ready.length >= 4 &&
    (info.siegeBuffUntilMs ?? 0) <= now
      ? ready
          .filter((actor) => ['TOP', 'MID'].includes(actor.input.position))
          .map((actor) => ({
            actor,
            champion: CHAMPIONS_BY_ID.get(actor.input.championId)!,
          }))
          .filter(
            ({ actor, champion }) =>
              champion.tags.some((tag) =>
                ['Fighter', 'Assassin'].includes(tag),
              ) &&
              champion.teamFight < 82 &&
              champion.protection < 75 &&
              enemies.filter(
                (enemy) => distance(actor.position, enemy.position) < 1800,
              ).length <= 1,
          )
          .sort(
            (a, b) =>
              b.champion.objectiveDamage +
                b.champion.damage -
                b.champion.teamFight -
                (a.champion.objectiveDamage +
                  a.champion.damage -
                  a.champion.teamFight) || a.actor.id.localeCompare(b.actor.id),
          )[0]?.actor
      : undefined;

  const carry = allies
    .filter((actor) => ['ADC', 'MID'].includes(actor.input.position))
    .sort(
      (a, b) => b.attackDamage - a.attackDamage || a.id.localeCompare(b.id),
    )[0];
  const focus = enemies
    .map((enemy) => {
      const reachableAllies = allies.filter(
        (actor) =>
          distance(actor.position, enemy.position) <
          Math.max(800, actor.attackRange + 200),
      );
      const divingCarry =
        carry &&
        distance(carry.position, enemy.position) <= enemy.attackRange + 200;
      return {
        enemy,
        count: reachableAllies.length,
        score:
          reachableAllies.length * 2 +
          (divingCarry ? 3 : 0) +
          (1 - health(enemy)) * 2,
      };
    })
    .filter(({ count }) => count > 0)
    .sort(
      (a, b) => b.score - a.score || a.enemy.id.localeCompare(b.enemy.id),
    )[0];
  return {
    objectiveId: objective?.objective.id ?? null,
    objectiveMembers: new Set(
      objective?.selected.map(({ actor }) => actor.id) ?? [],
    ),
    tradeObjectiveId: trade?.objective.id ?? null,
    splitActorId: split?.id ?? null,
    focusTargetId: focus?.enemy.id ?? null,
  };
}
