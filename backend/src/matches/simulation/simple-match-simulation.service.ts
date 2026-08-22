import { Injectable } from '@nestjs/common';
import { SIMPLE_MATCH_CONFIG } from '../config/simple-match.config';
import { TEAM_STRATEGY_CONFIG } from '../config/team-strategy.config';
import {
  PLAYER_INSTRUCTION_CONFIG,
  ROLE_PROFICIENCY_MATCH_CONFIG,
} from '../config/player-instruction.config';
import { createSeededRandom } from './seeded-random';
import {
  SimpleMatchPlayerInput,
  SimpleMatchPlayerStats,
  SimpleMatchSimulationResult,
  SimpleMatchTeamInput,
  SimpleMatchTeamResult,
} from './simple-match.types';

@Injectable()
export class SimpleMatchSimulationService {
  simulate(
    teamA: SimpleMatchTeamInput,
    teamB: SimpleMatchTeamInput,
    seed: number,
  ): SimpleMatchSimulationResult {
    this.assertCompleteTeam(teamA);
    this.assertCompleteTeam(teamB);

    const random = createSeededRandom(seed);
    const teamAResult = this.calculateTeamResult(teamA, random());
    const teamBResult = this.calculateTeamResult(teamB, random());
    const winner = this.pickWinner(teamAResult, teamBResult, random);

    return {
      seed,
      winnerTeamId: winner.teamId,
      winnerTeamCode: winner.teamCode,
      teams: [
        this.roundTeamResult(teamAResult),
        this.roundTeamResult(teamBResult),
      ],
    };
  }

  private assertCompleteTeam(team: SimpleMatchTeamInput): void {
    if (team.players.length !== SIMPLE_MATCH_CONFIG.requiredStarterCount) {
      throw new RangeError(
        `Team ${team.teamCode} must have exactly ${SIMPLE_MATCH_CONFIG.requiredStarterCount} starters`,
      );
    }
  }

  private calculateTeamResult(
    team: SimpleMatchTeamInput,
    randomValue: number,
  ): SimpleMatchTeamResult {
    const strategyConfig = TEAM_STRATEGY_CONFIG[team.teamStrategy];
    const playerAbilities = team.players.map((player) => ({
      ability: this.calculatePlayerAbility(
        player,
        strategyConfig.statMultipliers,
      ),
      positionMultiplier:
        strategyConfig.positionMultipliers[player.position] ?? 1,
    }));
    const positionWeightTotal = playerAbilities.reduce(
      (total, player) => total + player.positionMultiplier,
      0,
    );
    const baseAbility =
      playerAbilities.reduce(
        (total, player) => total + player.ability * player.positionMultiplier,
        0,
      ) / positionWeightTotal;
    const rngModifier =
      SIMPLE_MATCH_CONFIG.rngModifierMin +
      randomValue *
        (SIMPLE_MATCH_CONFIG.rngModifierMax -
          SIMPLE_MATCH_CONFIG.rngModifierMin);

    return {
      teamId: team.teamId,
      teamCode: team.teamCode,
      teamStrategy: team.teamStrategy,
      baseAbility,
      rngModifier,
      performance: baseAbility + rngModifier,
    };
  }

  private calculatePlayerAbility(
    player: SimpleMatchPlayerInput,
    strategyStatMultipliers: Partial<
      Record<keyof SimpleMatchPlayerStats, number>
    >,
  ): number {
    const instructionStatMultipliers = player.playerInstruction
      ? PLAYER_INSTRUCTION_CONFIG[player.position][player.playerInstruction]
          ?.statMultipliers
      : undefined;
    const weightedStats = SIMPLE_MATCH_CONFIG.playerStatKeys.map((statKey) => ({
      value: player[statKey],
      weight:
        (strategyStatMultipliers[statKey] ?? 1) *
        (instructionStatMultipliers?.[statKey] ?? 1),
    }));
    const weightTotal = weightedStats.reduce(
      (total, stat) => total + stat.weight,
      0,
    );

    const ability =
      weightedStats.reduce(
        (total, stat) => total + stat.value * stat.weight,
        0,
      ) / weightTotal;

    return ability + this.calculateRoleProficiencyModifier(player);
  }

  private calculateRoleProficiencyModifier(
    player: SimpleMatchPlayerInput,
  ): number {
    if (player.playerInstruction === null || player.roleProficiency === null) {
      return 0;
    }

    const config = ROLE_PROFICIENCY_MATCH_CONFIG;
    const proficiency = Math.min(
      config.max,
      Math.max(config.min, player.roleProficiency),
    );

    if (proficiency >= config.neutral) {
      return (
        ((proficiency - config.neutral) / (config.max - config.neutral)) *
        config.maxBonus
      );
    }

    return (
      ((config.neutral - proficiency) / (config.neutral - config.min)) *
      config.maxPenalty
    );
  }

  private pickWinner(
    teamA: SimpleMatchTeamResult,
    teamB: SimpleMatchTeamResult,
    random: () => number,
  ): SimpleMatchTeamResult {
    if (teamA.performance > teamB.performance) {
      return teamA;
    }

    if (teamB.performance > teamA.performance) {
      return teamB;
    }

    return random() < 0.5 ? teamA : teamB;
  }

  private roundTeamResult(
    result: SimpleMatchTeamResult,
  ): SimpleMatchTeamResult {
    return {
      ...result,
      baseAbility: this.round(result.baseAbility),
      rngModifier: this.round(result.rngModifier),
      performance: this.round(result.performance),
    };
  }

  private round(value: number): number {
    return Number(value.toFixed(SIMPLE_MATCH_CONFIG.displayedDecimalPlaces));
  }
}
