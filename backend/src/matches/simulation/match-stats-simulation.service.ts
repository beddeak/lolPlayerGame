import { Injectable } from '@nestjs/common';
import { MATCH_STATS_CONFIG } from '../config/match-stats.config';
import { createSeededRandom } from './seeded-random';
import {
  MatchPlayerStatsResult,
  MatchStatsSimulationResult,
  MatchTeamStatsResult,
} from './match-stats.types';
import {
  SimpleMatchPlayerInput,
  SimpleMatchSimulationResult,
  SimpleMatchTeamInput,
} from './simple-match.types';

interface PartialPlayerStats {
  player: SimpleMatchPlayerInput;
  kills: number;
  deaths: number;
  assists: number;
  dpm: number;
  gold: number;
  gdAt15: number;
  csdAt15: number;
}

@Injectable()
export class MatchStatsSimulationService {
  simulate(
    teamA: SimpleMatchTeamInput,
    teamB: SimpleMatchTeamInput,
    matchResult: SimpleMatchSimulationResult,
    seed: number,
  ): MatchStatsSimulationResult {
    const random = createSeededRandom(
      (seed ^ MATCH_STATS_CONFIG.derivedSeedXor) >>> 0,
    );
    const durationMinutes = this.randomBetween(
      random,
      MATCH_STATS_CONFIG.durationMinutes.min,
      MATCH_STATS_CONFIG.durationMinutes.max,
    );
    const winnerKills = this.randomInteger(
      random,
      MATCH_STATS_CONFIG.winnerKills.min,
      MATCH_STATS_CONFIG.winnerKills.max,
    );
    const loserKills = this.randomInteger(
      random,
      MATCH_STATS_CONFIG.loserKills.min,
      MATCH_STATS_CONFIG.loserKills.max,
    );
    const teamAKills =
      matchResult.winnerTeamId === teamA.teamId ? winnerKills : loserKills;
    const teamBKills =
      matchResult.winnerTeamId === teamB.teamId ? winnerKills : loserKills;
    const teamAPartials = this.createTeamPartials(
      teamA,
      teamAKills,
      teamBKills,
      durationMinutes,
      random,
    );
    const teamBPartials = this.createTeamPartials(
      teamB,
      teamBKills,
      teamAKills,
      durationMinutes,
      random,
    );

    this.applyLaneDifferences(teamAPartials, teamBPartials, random);

    return {
      durationMinutes: this.round(durationMinutes),
      teams: [
        this.completeTeamStats(
          teamA.teamId,
          teamAKills,
          teamAPartials,
          matchResult.winnerTeamId === teamA.teamId,
        ),
        this.completeTeamStats(
          teamB.teamId,
          teamBKills,
          teamBPartials,
          matchResult.winnerTeamId === teamB.teamId,
        ),
      ],
    };
  }

  private createTeamPartials(
    team: SimpleMatchTeamInput,
    teamKills: number,
    teamDeaths: number,
    durationMinutes: number,
    random: () => number,
  ): PartialPlayerStats[] {
    const killWeights = team.players.map(
      (player) =>
        MATCH_STATS_CONFIG.killWeightFloor +
        (player.mechanics + player.teamFight) *
          this.randomBetween(
            random,
            MATCH_STATS_CONFIG.allocationRandomMultiplier.min,
            MATCH_STATS_CONFIG.allocationRandomMultiplier.max,
          ),
    );
    const deathWeights = team.players.map(
      (player) =>
        MATCH_STATS_CONFIG.deathWeightFloor +
        (100 - player.mental) *
          this.randomBetween(
            random,
            MATCH_STATS_CONFIG.allocationRandomMultiplier.min,
            MATCH_STATS_CONFIG.allocationRandomMultiplier.max,
          ),
    );
    const kills = this.allocateIntegerTotal(teamKills, killWeights);
    const deaths = this.allocateIntegerTotal(teamDeaths, deathWeights);

    return team.players.map((player, index) => {
      const participationRate = this.randomBetween(
        random,
        MATCH_STATS_CONFIG.participationRate.min,
        MATCH_STATS_CONFIG.participationRate.max,
      );
      const assists = Math.max(
        0,
        Math.min(
          teamKills - kills[index],
          Math.round(participationRate * teamKills - kills[index]),
        ),
      );
      const dpm = Math.max(
        MATCH_STATS_CONFIG.dpm.minimum,
        MATCH_STATS_CONFIG.dpm.base +
          player.mechanics * MATCH_STATS_CONFIG.dpm.mechanicsMultiplier +
          player.teamFight * MATCH_STATS_CONFIG.dpm.teamFightMultiplier +
          this.randomBetween(
            random,
            MATCH_STATS_CONFIG.dpm.randomMin,
            MATCH_STATS_CONFIG.dpm.randomMax,
          ),
      );
      const goldPerMinute = Math.max(
        MATCH_STATS_CONFIG.goldPerMinute.minimum,
        MATCH_STATS_CONFIG.goldPerMinute.base +
          player.laning * MATCH_STATS_CONFIG.goldPerMinute.laningMultiplier +
          player.mechanics *
            MATCH_STATS_CONFIG.goldPerMinute.mechanicsMultiplier +
          this.randomBetween(
            random,
            MATCH_STATS_CONFIG.goldPerMinute.randomMin,
            MATCH_STATS_CONFIG.goldPerMinute.randomMax,
          ),
      );

      return {
        player,
        kills: kills[index],
        deaths: deaths[index],
        assists,
        dpm,
        gold: Math.round(goldPerMinute * durationMinutes),
        gdAt15: 0,
        csdAt15: 0,
      };
    });
  }

  private applyLaneDifferences(
    teamAPlayers: PartialPlayerStats[],
    teamBPlayers: PartialPlayerStats[],
    random: () => number,
  ): void {
    for (const teamAPlayer of teamAPlayers) {
      const teamBPlayer = teamBPlayers.find(
        (candidate) =>
          candidate.player.position === teamAPlayer.player.position,
      );

      if (!teamBPlayer) {
        continue;
      }

      const laningDifference =
        teamAPlayer.player.laning - teamBPlayer.player.laning;
      const gdAt15 = Math.round(
        laningDifference *
          MATCH_STATS_CONFIG.laneDifference.goldPerLaningPoint +
          this.randomBetween(
            random,
            MATCH_STATS_CONFIG.laneDifference.goldRandomMin,
            MATCH_STATS_CONFIG.laneDifference.goldRandomMax,
          ),
      );
      const csdAt15 = Math.round(
        laningDifference * MATCH_STATS_CONFIG.laneDifference.csPerLaningPoint +
          this.randomBetween(
            random,
            MATCH_STATS_CONFIG.laneDifference.csRandomMin,
            MATCH_STATS_CONFIG.laneDifference.csRandomMax,
          ),
      );

      teamAPlayer.gdAt15 = gdAt15;
      teamBPlayer.gdAt15 = -gdAt15;
      teamAPlayer.csdAt15 = csdAt15;
      teamBPlayer.csdAt15 = -csdAt15;
    }
  }

  private completeTeamStats(
    teamId: number,
    teamKills: number,
    partials: PartialPlayerStats[],
    isWinner: boolean,
  ): MatchTeamStatsResult {
    const totalDpm = partials.reduce((total, player) => total + player.dpm, 0);
    const totalGold = partials.reduce(
      (total, player) => total + player.gold,
      0,
    );
    const playerStats = partials.map((partial) => {
      const kda =
        (partial.kills + partial.assists) / Math.max(1, partial.deaths);
      const kp =
        teamKills === 0
          ? 0
          : ((partial.kills + partial.assists) / teamKills) * 100;
      const damageShare = (partial.dpm / totalDpm) * 100;
      const goldShare = (partial.gold / totalGold) * 100;
      const rating = this.calculateRating(
        kda,
        partial.dpm,
        partial.gdAt15,
        kp,
        isWinner,
      );

      return {
        careerPlayerId: partial.player.careerPlayerId,
        careerTeamId: teamId,
        position: partial.player.position,
        playerInstruction: partial.player.playerInstruction,
        roleProficiency: partial.player.roleProficiency,
        championArchetype: partial.player.championArchetype,
        kills: partial.kills,
        deaths: partial.deaths,
        assists: partial.assists,
        kda: this.round(kda),
        dpm: this.round(partial.dpm),
        damageShare: this.round(damageShare),
        gold: partial.gold,
        goldShare: this.round(goldShare),
        gdAt15: partial.gdAt15,
        csdAt15: partial.csdAt15,
        kp: this.round(kp),
        rating: this.round(rating),
      } satisfies MatchPlayerStatsResult;
    });

    return { teamId, teamKills, playerStats };
  }

  private calculateRating(
    kda: number,
    dpm: number,
    gdAt15: number,
    kp: number,
    isWinner: boolean,
  ): number {
    const config = MATCH_STATS_CONFIG.rating;
    const rating =
      config.base +
      (kda - config.kdaBaseline) * config.kdaMultiplier +
      (dpm - config.dpmBaseline) / config.dpmDivisor +
      gdAt15 / config.gdAt15Divisor +
      (kp - config.kpBaseline) / config.kpDivisor +
      (isWinner ? config.winnerBonus : 0);

    return Math.min(config.max, Math.max(config.min, rating));
  }

  private allocateIntegerTotal(total: number, weights: number[]): number[] {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const exactValues = weights.map((weight) => (weight / totalWeight) * total);
    const allocated = exactValues.map((value) => Math.floor(value));
    let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
    const remainderOrder = exactValues
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort(
        (left, right) =>
          right.fraction - left.fraction || left.index - right.index,
      );

    for (const item of remainderOrder) {
      if (remainder === 0) {
        break;
      }

      allocated[item.index] += 1;
      remainder -= 1;
    }

    return allocated;
  }

  private randomInteger(
    random: () => number,
    min: number,
    max: number,
  ): number {
    return Math.floor(this.randomBetween(random, min, max + 1));
  }

  private randomBetween(
    random: () => number,
    min: number,
    max: number,
  ): number {
    return min + random() * (max - min);
  }

  private round(value: number): number {
    return Number(value.toFixed(MATCH_STATS_CONFIG.displayedDecimalPlaces));
  }
}
