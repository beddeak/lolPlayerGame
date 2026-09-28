import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PLAYER_CARD_BASE_STAT_FIELDS } from '../../players/constants/player-card.constants';
import { MATCH_STATS_CONFIG } from '../config/match-stats.config';
import type {
  MatchPlayerStatsResult,
  MatchStatsSimulationResult,
} from '../simulation/match-stats.types';
import {
  calculatePlayerMatchStateModifiers,
  calculatePostMatchPlayerState,
} from '../simulation/player-match-state';
import type {
  SimpleMatchSimulationResult,
  SimpleMatchTeamResult,
} from '../simulation/simple-match.types';
import type { EngineInput } from './contracts';
import type { projectMatch } from './projection';
import { canonicalHash } from './seeded-rng';

type MatchReport = ReturnType<typeof projectMatch>;

/** Presentation rating only; it never selects the winner or creates statistics. */
function actualRating(
  player: MatchReport['players'][number],
  won: boolean,
): number {
  const config = MATCH_STATS_CONFIG.rating;
  const rating =
    config.base +
    (player.kda - config.kdaBaseline) * config.kdaMultiplier +
    (player.dpm - config.dpmBaseline) / config.dpmDivisor +
    (player.gdAt15 === null ? 0 : player.gdAt15 / config.gdAt15Divisor) +
    (player.kp - config.kpBaseline) / config.kpDivisor +
    (won ? config.winnerBonus : 0);
  return Number(
    Math.min(config.max, Math.max(config.min, rating)).toFixed(
      MATCH_STATS_CONFIG.displayedDecimalPlaces,
    ),
  );
}

/**
 * Persist the physical engine's projected result in the existing career schema.
 * The caller supplies a server-built report from a validated terminal state.
 * No legacy winner/statistics simulator is called. Missing GD/CSD stay null.
 */
export function adaptTacticalResult(
  input: EngineInput,
  report: MatchReport,
  currentMeta: TeamStrategy,
): {
  result: SimpleMatchSimulationResult;
  statsResult: MatchStatsSimulationResult;
} {
  canonicalHash(report);
  if (report.status !== 'FINISHED' || report.winnerTeamId === null)
    throw new Error('Only a finished tactical match can update a career');
  if (
    report.engineVersion !== input.engineVersion ||
    report.rulesetVersion !== input.rules.version ||
    report.simTimeMs <= 0 ||
    report.simTimeMs > input.rules.maxHorizonMs ||
    !input.teams.some((team) => team.teamId === report.winnerTeamId) ||
    report.teams.length !== 2 ||
    report.players.length !== 10 ||
    input.actors.length !== 10 ||
    new Set(report.players.map((player) => player.actorId)).size !== 10 ||
    new Set(report.teams.map((team) => team.teamId)).size !== 2
  )
    throw new Error('Tactical report does not match the pinned match input');

  const durationMinutes = report.simTimeMs / 60_000;
  const statsTeams = input.teams.map((team) => {
    const own = report.teams.find(
      (entry) => entry.teamId === team.teamId && entry.side === team.side,
    );
    const actors = input.actors.filter((actor) => actor.teamId === team.teamId);
    if (!own || actors.length !== 5 || !team.sourceTeam)
      throw new Error('Tactical report is missing a pinned team');
    const won = team.teamId === report.winnerTeamId;
    const playerStats = actors.map((actor): MatchPlayerStatsResult => {
      const player = report.players.find(
        (entry) => entry.actorId === actor.actorId,
      );
      const source = actor.sourcePlayer;
      if (
        !player ||
        !source ||
        player.teamId !== team.teamId ||
        player.careerPlayerId !== actor.careerPlayerId ||
        player.side !== actor.side ||
        player.position !== actor.position ||
        player.championId !== actor.championId
      )
        throw new Error('Tactical report is missing a pinned player');
      const rating = actualRating(player, won);
      const after = calculatePostMatchPlayerState(
        source,
        rating,
        durationMinutes,
        won,
      );
      return {
        feedback: source.feedback ?? null,
        careerPlayerId: actor.careerPlayerId,
        careerTeamId: actor.teamId,
        position: source.position,
        playerInstruction: source.playerInstruction,
        roleProficiency: source.roleProficiency,
        positionProficiency: source.positionProficiency,
        championArchetype: source.championArchetype,
        form: source.form,
        condition: source.condition,
        mental: source.mental,
        ...calculatePlayerMatchStateModifiers(source),
        formAfter: after.form,
        conditionAfter: after.condition,
        mentalAfter: after.mental,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        kda: player.kda,
        dpm: player.dpm,
        damageShare: player.damageShare,
        gold: player.goldEarned,
        goldShare: player.goldShare,
        gdAt15: player.gdAt15,
        csdAt15: player.csdAt15,
        kp: player.kp,
        rating,
      };
    });
    return { teamId: team.teamId, teamKills: own.kills, playerStats };
  }) as MatchStatsSimulationResult['teams'];

  const teams = input.teams.map((team, index): SimpleMatchTeamResult => {
    const source = team.sourceTeam!;
    const players = statsTeams[index].playerStats;
    return {
      teamId: team.teamId,
      teamCode: source.teamCode,
      teamStrategy: source.teamStrategy,
      strategyProficiency: team.strategyProficiency,
      chemistry: team.chemistry,
      effectiveChemistry: team.chemistry,
      activeSetBonuses: structuredClone(source.activeSetBonuses),
      // The tactical engine has no legacy additive performance equation.
      // Retain neutral compatibility columns, never claim they caused a win.
      strategyProficiencyModifier: 0,
      metaModifier: 0,
      chemistryModifier: 0,
      setBonusModifier: 0,
      archetypeModifier: 0,
      stateModifier: 0,
      rngModifier: 0,
      // Descriptive roster average; performance is actual average rating on a
      // 0..100 scale. Neither participates in winner selection.
      baseAbility:
        source.players.reduce(
          (sum, player) =>
            sum +
            PLAYER_CARD_BASE_STAT_FIELDS.reduce(
              (total, key) => total + player[key],
              0,
            ) /
              PLAYER_CARD_BASE_STAT_FIELDS.length,
          0,
        ) / source.players.length,
      performance:
        (players.reduce((sum, player) => sum + player.rating, 0) /
          players.length) *
        10,
    };
  }) as SimpleMatchSimulationResult['teams'];
  const winner = teams.find((team) => team.teamId === report.winnerTeamId)!;
  const adapted = {
    result: {
      seed: input.seed,
      currentMeta,
      winnerTeamId: winner.teamId,
      winnerTeamCode: winner.teamCode,
      teams,
    },
    statsResult: { durationMinutes, teams: statsTeams },
  };
  canonicalHash(adapted);
  return adapted;
}
