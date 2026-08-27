import { Injectable } from '@nestjs/common';
import { SIMPLE_MATCH_CONFIG } from '../config/simple-match.config';
import { TEAM_STRATEGY_CONFIG } from '../config/team-strategy.config';
import {
  META_MATCH_CONFIG,
  STRATEGY_PROFICIENCY_MATCH_CONFIG,
} from '../config/meta-strategy-proficiency.config';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import {
  PLAYER_INSTRUCTION_CONFIG,
  ROLE_PROFICIENCY_MATCH_CONFIG,
} from '../config/player-instruction.config';
import { TEAM_CHEMISTRY_MATCH_CONFIG } from '../config/team-chemistry.config';
import {
  CHAMPION_ARCHETYPE_CONFIG,
  CHAMPION_ARCHETYPE_PHASE_CONFIG,
  ChampionArchetypeTuning,
} from '../config/champion-archetype.config';
import { createSeededRandom } from './seeded-random';
import { calculatePlayerMatchStateModifiers } from './player-match-state';
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
    currentMeta: TeamStrategy,
  ): SimpleMatchSimulationResult {
    this.assertCompleteTeam(teamA);
    this.assertCompleteTeam(teamB);

    const random = createSeededRandom(seed);
    const teamAResult = this.calculateTeamResult(teamA, random(), currentMeta);
    const teamBResult = this.calculateTeamResult(teamB, random(), currentMeta);
    const winner = this.pickWinner(teamAResult, teamBResult, random);

    return {
      seed,
      currentMeta,
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
    currentMeta: TeamStrategy,
  ): SimpleMatchTeamResult {
    const baseAbility = this.calculateTeamAbility(team, {}, false, false);
    const archetypeAdjustedAbility = this.calculateTeamAbility(
      team,
      {},
      true,
      false,
    );
    const archetypeModifier = archetypeAdjustedAbility - baseAbility;
    const stateAdjustedAbility = this.calculateTeamAbility(
      team,
      {},
      false,
      true,
    );
    const stateModifier = stateAdjustedAbility - baseAbility;
    const setBonusStatModifiers = this.sumSetBonusStatModifiers(team);
    const setBonusAdjustedAbility = this.calculateTeamAbility(
      team,
      setBonusStatModifiers,
      false,
      false,
    );
    const setBonusModifier = setBonusAdjustedAbility - baseAbility;
    const rngModifier =
      SIMPLE_MATCH_CONFIG.rngModifierMin +
      randomValue *
        (SIMPLE_MATCH_CONFIG.rngModifierMax -
          SIMPLE_MATCH_CONFIG.rngModifierMin);
    const strategyProficiency = Math.min(
      STRATEGY_PROFICIENCY_MATCH_CONFIG.max,
      Math.max(STRATEGY_PROFICIENCY_MATCH_CONFIG.min, team.strategyProficiency),
    );
    const strategyProficiencyModifier =
      this.calculateStrategyProficiencyModifier(strategyProficiency);
    const metaModifier =
      team.teamStrategy === currentMeta
        ? META_MATCH_CONFIG.matchingStrategyBonus
        : META_MATCH_CONFIG.nonMatchingStrategyModifier;
    const chemistry = this.clamp(
      team.chemistry,
      TEAM_CHEMISTRY_MATCH_CONFIG.min,
      TEAM_CHEMISTRY_MATCH_CONFIG.max,
    );
    const effectiveChemistry = this.clamp(
      chemistry +
        team.activeSetBonuses.reduce(
          (total, setBonus) => total + setBonus.chemistryBonus,
          0,
        ),
      TEAM_CHEMISTRY_MATCH_CONFIG.min,
      TEAM_CHEMISTRY_MATCH_CONFIG.max,
    );
    const chemistryModifier =
      this.calculateChemistryModifier(effectiveChemistry);

    return {
      teamId: team.teamId,
      teamCode: team.teamCode,
      teamStrategy: team.teamStrategy,
      strategyProficiency,
      strategyProficiencyModifier,
      metaModifier,
      chemistry,
      effectiveChemistry,
      chemistryModifier,
      activeSetBonuses: team.activeSetBonuses,
      setBonusModifier,
      archetypeModifier,
      stateModifier,
      baseAbility,
      rngModifier,
      performance:
        baseAbility +
        setBonusModifier +
        archetypeModifier +
        stateModifier +
        chemistryModifier +
        rngModifier +
        strategyProficiencyModifier +
        metaModifier,
    };
  }

  private calculateTeamAbility(
    team: SimpleMatchTeamInput,
    statBonuses: Partial<Record<keyof SimpleMatchPlayerStats, number>>,
    applyChampionArchetype: boolean,
    applyPlayerState: boolean,
  ): number {
    const strategyConfig = TEAM_STRATEGY_CONFIG[team.teamStrategy];
    const playerAbilities = team.players.map((player) => ({
      ability: this.calculatePlayerAbility(
        player,
        strategyConfig.statMultipliers,
        statBonuses,
        applyChampionArchetype,
        applyPlayerState,
      ),
      positionMultiplier:
        strategyConfig.positionMultipliers[player.position] ?? 1,
    }));
    const positionWeightTotal = playerAbilities.reduce(
      (total, player) => total + player.positionMultiplier,
      0,
    );

    return (
      playerAbilities.reduce(
        (total, player) => total + player.ability * player.positionMultiplier,
        0,
      ) / positionWeightTotal
    );
  }

  private sumSetBonusStatModifiers(
    team: SimpleMatchTeamInput,
  ): Partial<Record<keyof SimpleMatchPlayerStats, number>> {
    return team.activeSetBonuses.reduce(
      (total, setBonus) => ({
        laning: (total.laning ?? 0) + setBonus.laningBonus,
        teamFight: (total.teamFight ?? 0) + setBonus.teamFightBonus,
        macro: (total.macro ?? 0) + setBonus.macroBonus,
        teamPlay: (total.teamPlay ?? 0) + setBonus.teamPlayBonus,
      }),
      {} as Partial<Record<keyof SimpleMatchPlayerStats, number>>,
    );
  }

  private calculateStrategyProficiencyModifier(proficiency: number): number {
    const config = STRATEGY_PROFICIENCY_MATCH_CONFIG;

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

  private calculatePlayerAbility(
    player: SimpleMatchPlayerInput,
    strategyStatMultipliers: Partial<
      Record<keyof SimpleMatchPlayerStats, number>
    >,
    statBonuses: Partial<Record<keyof SimpleMatchPlayerStats, number>>,
    applyChampionArchetype: boolean,
    applyPlayerState: boolean,
  ): number {
    const instructionStatMultipliers = player.playerInstruction
      ? PLAYER_INSTRUCTION_CONFIG[player.position][player.playerInstruction]
          ?.statMultipliers
      : undefined;
    const archetypeConfig = applyChampionArchetype
      ? this.getChampionArchetypeConfig(player)
      : undefined;
    const weightedStats = SIMPLE_MATCH_CONFIG.playerStatKeys.map((statKey) => ({
      value: player[statKey] + (statBonuses[statKey] ?? 0),
      weight:
        (strategyStatMultipliers[statKey] ?? 1) *
        (instructionStatMultipliers?.[statKey] ?? 1) *
        (archetypeConfig?.statMultipliers[statKey] ?? 1),
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

    return (
      ability +
      this.calculateRoleProficiencyModifier(player) +
      (archetypeConfig
        ? this.calculateArchetypePhaseModifier(archetypeConfig)
        : 0) +
      (applyPlayerState
        ? calculatePlayerMatchStateModifiers(player).stateModifier
        : 0)
    );
  }

  private getChampionArchetypeConfig(
    player: SimpleMatchPlayerInput,
  ): ChampionArchetypeTuning | undefined {
    if (player.championArchetype === null) {
      return undefined;
    }

    const config = CHAMPION_ARCHETYPE_CONFIG[player.championArchetype];

    if (config.position !== player.position) {
      throw new RangeError(
        `${player.championArchetype} is not valid for ${player.position}`,
      );
    }

    return config;
  }

  private calculateArchetypePhaseModifier(
    archetype: ChampionArchetypeTuning,
  ): number {
    const config = CHAMPION_ARCHETYPE_PHASE_CONFIG;
    const rating = this.clamp(
      archetype.phaseRatings.early * config.weights.early +
        archetype.phaseRatings.mid * config.weights.mid +
        archetype.phaseRatings.late * config.weights.late,
      config.minRating,
      config.maxRating,
    );

    if (rating >= config.neutralRating) {
      return (
        ((rating - config.neutralRating) /
          (config.maxRating - config.neutralRating)) *
        config.maxBonus
      );
    }

    return (
      ((config.neutralRating - rating) /
        (config.neutralRating - config.minRating)) *
      config.maxPenalty
    );
  }

  private calculateChemistryModifier(chemistry: number): number {
    const config = TEAM_CHEMISTRY_MATCH_CONFIG;

    if (chemistry >= config.neutral) {
      return (
        ((chemistry - config.neutral) / (config.max - config.neutral)) *
        config.maxBonus
      );
    }

    return (
      ((config.neutral - chemistry) / (config.neutral - config.min)) *
      config.maxPenalty
    );
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
      strategyProficiencyModifier: this.round(
        result.strategyProficiencyModifier,
      ),
      metaModifier: this.round(result.metaModifier),
      chemistryModifier: this.round(result.chemistryModifier),
      setBonusModifier: this.round(result.setBonusModifier),
      archetypeModifier: this.round(result.archetypeModifier),
      stateModifier: this.round(result.stateModifier),
      performance: this.round(result.performance),
    };
  }

  private round(value: number): number {
    return Number(value.toFixed(SIMPLE_MATCH_CONFIG.displayedDecimalPlaces));
  }
}
