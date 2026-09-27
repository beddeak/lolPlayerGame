import { createHash } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { Region } from '../careers/enums/region.enum';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { LeagueStageFormat } from '../leagues/enums/league-stage-format.enum';
import { FirstSelection } from './draft-state';
import { InternationalFixture } from '../internationals/entities/international-fixture.entity';

const roll = (seed: number, label: string) =>
  createHash('sha256')
    .update(`${seed}:selection:${label}`)
    .digest()
    .readUInt32BE(0) / 0x100000000;
export function coinToss(seed: number, teamAId: number, teamBId: number) {
  return roll(seed, 'coin') < 0.5 ? teamAId : teamBId;
}
export function showdown(team: CareerTeam, seed: number) {
  const players = team.rosters
    .filter((r) => r.role === RosterRole.STARTER)
    .map((r) => r.careerPlayer)
    .sort(
      (a, b) =>
        b.currentMechanics +
          b.currentGameSense -
          (a.currentMechanics + a.currentGameSense) || a.id - b.id,
    )
    .slice(0, 2);
  if (players.length !== 2) throw new Error('2v2 requires two starters');
  const skill =
    players.reduce(
      (n, p) => n + (p.currentMechanics * 0.6 + p.currentGameSense * 0.4),
      0,
    ) / 2;
  return {
    playerIds: players.map((p) => p.id),
    score:
      Math.round(
        (skill * 0.9 +
          team.chemistry * 0.1 +
          (roll(seed, `showdown:${team.id}`) - 0.5) * 20) *
          100,
      ) / 100,
  };
}
/** Game policy: regular season coin toss (LCP showdown); playoffs use upper bracket, then higher seed.
 * Cross-region seeds are not comparable, so international matches default to a coin toss. */
export async function firstGameSelection(
  manager: EntityManager,
  series: MatchSeries,
  teams: CareerTeam[],
): Promise<FirstSelection> {
  const selection: FirstSelection = {
    firstSelectionTeamId: coinToss(series.seed, series.teamAId, series.teamBId),
    policy: 'RANDOM',
    choices: [],
    blueTeamId: null,
    redTeamId: null,
    firstPickTeamId: null,
    secondPickTeamId: null,
  };
  const fixture = await manager.findOne(LeagueFixture, {
    where: { seriesId: series.id },
    relations: { leagueSplit: true, leagueStage: { participants: true } },
  });
  if (!fixture) {
    const international = await manager.findOne(InternationalFixture, {
      where: { seriesId: series.id },
      relations: { tournament: true },
    });
    if (international?.key === 'GF') {
      const upperWinner = international.tournament.state.games.find(
        (g) => g.key === 'UF',
      )?.winner;
      if (upperWinner && [series.teamAId, series.teamBId].includes(upperWinner))
        return {
          ...selection,
          policy: 'UPPER_BRACKET',
          firstSelectionTeamId: upperWinner,
        };
    }
    return selection;
  }
  const playoff = [
    LeagueStageFormat.SINGLE_ELIMINATION,
    LeagueStageFormat.DOUBLE_ELIMINATION,
    LeagueStageFormat.GAUNTLET,
  ].includes(fixture.leagueStage.format);
  if (!playoff && fixture.leagueSplit.region === Region.LCP) {
    const a = showdown(
        teams.find((t) => t.id === series.teamAId)!,
        series.seed,
      ),
      b = showdown(
        teams.find((t) => t.id === series.teamBId)!,
        series.seed,
      );
    return {
      ...selection,
      policy: 'LCP_2V2',
      firstSelectionTeamId:
        a.score === b.score
          ? selection.firstSelectionTeamId
          : a.score > b.score
            ? series.teamAId
            : series.teamBId,
      showdown: {
        teamAId: series.teamAId,
        teamBId: series.teamBId,
        teamAPlayerIds: a.playerIds,
        teamBPlayerIds: b.playerIds,
        teamAScore: a.score,
        teamBScore: b.score,
      },
    };
  }
  if (playoff) {
    if (
      fixture.leagueStage.format === LeagueStageFormat.DOUBLE_ELIMINATION ||
      fixture.leagueStage.settings.bracket
    ) {
      const matches = await manager.find(LeagueFixture, {
        where: { leagueStageId: fixture.leagueStageId },
        relations: { series: { games: true } },
      });
      const losses = (id: number) =>
        matches.filter(
          (f) =>
            f.series &&
            f.series.id !== series.id &&
            [f.teamAId, f.teamBId].includes(id) &&
            f.series.games.filter((g) => g.winnerTeamId !== id).length >=
              Math.floor(f.bestOf / 2) + 1,
        ).length;
      const aLoss = losses(series.teamAId),
        bLoss = losses(series.teamBId);
      if ((aLoss === 0) !== (bLoss === 0))
        return {
          ...selection,
          policy: 'UPPER_BRACKET',
          firstSelectionTeamId: aLoss === 0 ? series.teamAId : series.teamBId,
        };
    }
    const a = fixture.leagueStage.participants.find(
      (p) => p.careerTeamId === series.teamAId,
    )?.initialSeed;
    const b = fixture.leagueStage.participants.find(
      (p) => p.careerTeamId === series.teamBId,
    )?.initialSeed;
    if (a && b && a !== b)
      return {
        ...selection,
        policy: 'HIGHER_SEED',
        firstSelectionTeamId: a < b ? series.teamAId : series.teamBId,
      };
  }
  return selection;
}
