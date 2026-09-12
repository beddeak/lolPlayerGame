import { createHash } from 'node:crypto';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { POSITION_PROFICIENCY_CONFIG } from '../careers/config/position-proficiency.config';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { POSITION_PROFICIENCY_MATCH_CONFIG } from '../matches/config/position-proficiency.config';
import { Position } from '../players/enums/position.enum';
import { AI_CLUB_CONFIG } from './config/ai-club.config';

export interface AiPlayerSnapshot {
  id: number;
  currentPosition: Position;
  currentMechanics: number;
  currentGameSense: number;
  currentLaning: number;
  currentTeamFight: number;
  currentMacro: number;
  currentTeamPlay: number;
  currentMental: number;
  currentChampionPool: number;
  positionProficiencies?: readonly {
    position: Position;
    proficiency: number;
  }[];
}

export interface AiRosterSlot {
  role: RosterRole;
  starterPosition: Position | null;
  careerPlayer: AiPlayerSnapshot;
}

export interface AiPositionAssessment {
  position: Position;
  starterId: number | null;
  ability: number;
  missing: boolean;
}

export interface AiRosterAssessment {
  positions: AiPositionAssessment[];
  weakestPosition: Position;
  teamStrength: number;
}

export interface AiBenchPromotion {
  position: Position;
  incomingPlayerId: number;
  outgoingPlayerId: number | null;
  upgrade: number;
}

export interface AiTransferCandidate {
  careerPlayerId: number;
  position: Position;
  upgrade: number;
  score: number;
}

/** Public current ability only; no potential, reputation, meta or difficulty bonus. */
export function getAiPlayerAbility(player: AiPlayerSnapshot): number {
  const stats = [
    player.currentMechanics,
    player.currentGameSense,
    player.currentLaning,
    player.currentTeamFight,
    player.currentMacro,
    player.currentTeamPlay,
    player.currentMental,
    player.currentChampionPool,
  ];
  if (stats.some((stat) => !Number.isFinite(stat) || stat < 0)) {
    throw new Error(
      'AI roster assessment requires finite, nonnegative current stats',
    );
  }
  return stats.reduce((total, stat) => total + stat, 0) / stats.length;
}

function positionAbility(player: AiPlayerSnapshot, position: Position): number {
  const proficiency =
    player.positionProficiencies?.find((entry) => entry.position === position)
      ?.proficiency ??
    (player.currentPosition === position
      ? POSITION_PROFICIENCY_CONFIG.initialPrimary
      : POSITION_PROFICIENCY_CONFIG.initialSecondary);
  if (!Number.isFinite(proficiency))
    throw new Error('AI position proficiency must be finite');
  const config = POSITION_PROFICIENCY_MATCH_CONFIG;
  const normalized = Math.min(config.max, Math.max(config.min, proficiency));
  const penalty =
    normalized >= config.neutral
      ? 0
      : ((config.neutral - normalized) / (config.neutral - config.min)) *
        config.maxPenalty;
  return Math.max(0, getAiPlayerAbility(player) + penalty);
}

function findStarter(
  rosters: readonly AiRosterSlot[],
  position: Position,
): AiPlayerSnapshot | undefined {
  return rosters.find(
    (slot) =>
      slot.role === RosterRole.STARTER && slot.starterPosition === position,
  )?.careerPlayer;
}

export function assessAiRoster(
  rosters: readonly AiRosterSlot[],
): AiRosterAssessment {
  const positions = STARTER_POSITIONS.map((position): AiPositionAssessment => {
    const player = findStarter(rosters, position);
    return {
      position,
      starterId: player?.id ?? null,
      ability: player ? positionAbility(player, position) : 0,
      missing: !player,
    };
  });
  const weakest = [...positions].sort(
    (left, right) =>
      Number(right.missing) - Number(left.missing) ||
      left.ability - right.ability ||
      STARTER_POSITIONS.indexOf(left.position) -
        STARTER_POSITIONS.indexOf(right.position),
  )[0];
  return {
    positions,
    weakestPosition: weakest.position,
    teamStrength:
      positions.reduce((total, slot) => total + slot.ability, 0) /
      positions.length,
  };
}

/** One legal promotion per call; the orchestrator can reassess after applying it. */
export function chooseAiBenchPromotion(
  rosters: readonly AiRosterSlot[],
): AiBenchPromotion | null {
  const assessment = assessAiRoster(rosters);
  const choices = assessment.positions.flatMap((slot) =>
    rosters
      .filter(
        (roster) =>
          roster.role === RosterRole.BENCH &&
          roster.careerPlayer.currentPosition === slot.position,
      )
      .flatMap((roster) => {
        const upgrade =
          positionAbility(roster.careerPlayer, slot.position) - slot.ability;
        if (!slot.missing && upgrade < AI_CLUB_CONFIG.benchUpgrade) return [];
        return [
          {
            position: slot.position,
            incomingPlayerId: roster.careerPlayer.id,
            outgoingPlayerId: slot.starterId,
            upgrade,
          },
        ];
      }),
  );
  choices.sort(
    (left, right) =>
      Number(right.outgoingPlayerId === null) -
        Number(left.outgoingPlayerId === null) ||
      right.upgrade - left.upgrade ||
      STARTER_POSITIONS.indexOf(left.position) -
        STARTER_POSITIONS.indexOf(right.position) ||
      left.incomingPlayerId - right.incomingPlayerId,
  );
  return choices[0] ?? null;
}

/** EASY concentrates on vacancies, or the single weakest occupied position. */
export function rankAiTransferCandidates(
  candidates: readonly AiPlayerSnapshot[],
  assessment: AiRosterAssessment,
): AiTransferCandidate[] {
  const vacancies = assessment.positions.filter((slot) => slot.missing);
  const targets =
    vacancies.length > 0
      ? vacancies
      : assessment.positions.filter(
          (slot) => slot.position === assessment.weakestPosition,
        );
  const currentStarters = new Set(
    assessment.positions.map((slot) => slot.starterId),
  );
  const seen = new Set<number>();
  return candidates
    .flatMap((candidate) => {
      if (seen.has(candidate.id) || currentStarters.has(candidate.id))
        return [];
      seen.add(candidate.id);
      const target = targets.find(
        (slot) => slot.position === candidate.currentPosition,
      );
      if (!target) return [];
      const upgrade =
        positionAbility(candidate, target.position) - target.ability;
      if (!target.missing && upgrade < AI_CLUB_CONFIG.minUpgrade) return [];
      return [
        {
          careerPlayerId: candidate.id,
          position: target.position,
          upgrade,
          score: upgrade,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        STARTER_POSITIONS.indexOf(left.position) -
          STARTER_POSITIONS.indexOf(right.position) ||
        left.careerPlayerId - right.careerPlayerId,
    );
}

/** Retains the club's current strategy most weeks; the remaining choice is simple. */
export function chooseAiTeamStrategy(
  current: TeamStrategy,
  rosters: readonly AiRosterSlot[],
  seed: string,
): TeamStrategy {
  const roll =
    createHash('sha256')
      .update(`ai-club-strategy:${seed}`)
      .digest()
      .readUInt32BE(0) / 0x1_0000_0000;
  if (roll < AI_CLUB_CONFIG.strategyRetention) return current;
  const adc = findStarter(rosters, Position.ADC);
  const support = findStarter(rosters, Position.SUPPORT);
  if (!adc || !support) return TeamStrategy.BALANCED;
  getAiPlayerAbility(adc);
  getAiPlayerAbility(support);
  // Existing enum names: lane-pressure and carry-oriented bot plans, not new meta modes.
  const early =
    (adc.currentMechanics +
      adc.currentLaning +
      support.currentMechanics +
      support.currentLaning) /
    4;
  const scaling =
    (adc.currentTeamFight +
      adc.currentMacro +
      adc.currentChampionPool +
      support.currentTeamFight +
      support.currentTeamPlay +
      support.currentChampionPool) /
    6;
  if (early - scaling >= AI_CLUB_CONFIG.strategySpecializationThreshold)
    return TeamStrategy.BOT_PRESSURE;
  if (scaling - early >= AI_CLUB_CONFIG.strategySpecializationThreshold)
    return TeamStrategy.BOT_CARRY;
  return TeamStrategy.BALANCED;
}
