import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import type { ActorInput, EngineInput, Lane } from './contracts';

/** Environment efficiencies, not a strategy-match damage or win-rate bonus. */
export interface MetaEnvironment {
  version: 'NEUTRAL_TACTICAL_V1';
  mode: 'NEUTRAL';
  lanePriority: Record<Lane, number>;
  objectivePriority: number;
  visionPriority: number;
}

export function createNeutralMeta(): MetaEnvironment {
  return {
    version: 'NEUTRAL_TACTICAL_V1',
    mode: 'NEUTRAL',
    lanePriority: { TOP: 1, MID: 1, BOT: 1 },
    objectivePriority: 1,
    visionPriority: 1,
  };
}

/** Fail closed until an actual consumer and tests exist for a non-neutral meta. */
export function validateMeta(meta: MetaEnvironment): void {
  if (
    meta.version !== 'NEUTRAL_TACTICAL_V1' ||
    meta.mode !== 'NEUTRAL' ||
    !meta.lanePriority ||
    Object.keys(meta.lanePriority).length !== 3 ||
    (['TOP', 'MID', 'BOT'] as const).some(
      (lane) => meta.lanePriority[lane] !== 1,
    ) ||
    meta.objectivePriority !== 1 ||
    meta.visionPriority !== 1
  )
    throw new Error('Unsupported tactical meta environment');
}

export interface TacticalPolicy {
  lanePriority: Record<Lane, number>;
  objectivePriority: number;
  visionPriority: number;
  /** Decision/arrival tolerance only. Never multiply attack, rewards or winner. */
  coordination: number;
  retreatThreshold: number;
  resourcePriority: number;
}

const STRATEGIES: Record<TeamStrategy, Record<Lane, number>> = {
  BALANCED: { TOP: 1, MID: 1, BOT: 1 },
  TOP_CARRY: { TOP: 1.3, MID: 0.95, BOT: 0.9 },
  TOP_JUNGLE: { TOP: 1.25, MID: 1.05, BOT: 0.9 },
  MID_CARRY: { TOP: 0.95, MID: 1.3, BOT: 0.95 },
  MID_JUNGLE: { TOP: 1.05, MID: 1.25, BOT: 0.95 },
  UPPER_SIDE: { TOP: 1.2, MID: 1.2, BOT: 0.85 },
  BOT_CARRY: { TOP: 0.9, MID: 1, BOT: 1.3 },
  BOT_PRESSURE: { TOP: 0.9, MID: 1.05, BOT: 1.25 },
};
const bound = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Preference != success. The caller must still price visible danger, path travel,
 * wave opportunity cost and available living allies before committing a plan.
 * Position/role/form/condition already enter input.execution: never reapply here.
 * Unknown champion-specific mastery stays unknown; no ChampionPool substitute.
 */
export function tacticalPolicy(
  input: EngineInput,
  actor: ActorInput,
  meta: MetaEnvironment = input.meta ?? createNeutralMeta(),
): TacticalPolicy {
  validateMeta(meta);
  const team = input.teams.find((value) => value.teamId === actor.teamId);
  if (!team || team.side !== actor.side)
    throw new Error('Actor does not belong to a tactical team');
  if (
    !Number.isFinite(team.strategyProficiency) ||
    team.strategyProficiency < 0 ||
    team.strategyProficiency > 100 ||
    !Number.isFinite(actor.teamwork) ||
    actor.teamwork < 0 ||
    actor.teamwork > 1 ||
    !Number.isFinite(actor.risk) ||
    actor.risk < 0 ||
    actor.risk > 1
  )
    throw new Error('Invalid tactical proficiency or behavior');
  const preference = STRATEGIES[team.strategy as TeamStrategy];
  if (!preference) throw new Error('Unsupported tactical team strategy');
  const lanePriority = { ...preference };
  const instruction = actor.sourcePlayer?.playerInstruction;
  const focus: Lane | undefined =
    instruction === PlayerInstruction.PLAY_FOR_TOP ||
    instruction === PlayerInstruction.ROAM_TOP ||
    instruction === PlayerInstruction.ROAM_UPPER
      ? 'TOP'
      : instruction === PlayerInstruction.PLAY_FOR_MID ||
          instruction === PlayerInstruction.ROAM_MID
        ? 'MID'
        : instruction === PlayerInstruction.PLAY_FOR_BOT ||
            instruction === PlayerInstruction.ROAM_BOT ||
            instruction === PlayerInstruction.PROTECT_ADC
          ? 'BOT'
          : undefined;
  if (focus) lanePriority[focus] = bound(lanePriority[focus] + 0.1, 0.85, 1.4);
  for (const lane of ['TOP', 'MID', 'BOT'] as const)
    lanePriority[lane] *= meta.lanePriority[lane];
  const resourcePriority =
    instruction === PlayerInstruction.WEAK_SIDE ||
    instruction === PlayerInstruction.UTILITY
      ? 0.85
      : instruction === PlayerInstruction.CARRY ||
          instruction === PlayerInstruction.FARM_CARRY ||
          instruction === PlayerInstruction.HYPER_CARRY ||
          instruction === PlayerInstruction.SCALING
        ? 1.15
        : 1;
  return {
    lanePriority,
    objectivePriority:
      (instruction === PlayerInstruction.OBJECTIVE ? 1.15 : 1) *
      meta.objectivePriority,
    visionPriority: meta.visionPriority,
    coordination:
      0.35 +
      0.65 * (actor.teamwork * 0.6 + (team.strategyProficiency / 100) * 0.4),
    retreatThreshold: 0.25 + (1 - actor.risk) * 0.1,
    resourcePriority,
  };
}
