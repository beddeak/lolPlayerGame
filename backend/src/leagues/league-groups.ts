import type {
  LeagueGroupResponseDto,
  LeagueStageResponseDto,
} from './dto/league-split-response.dto';
import { LeagueStageFormat } from './enums/league-stage-format.enum';
import { LeagueStageStatus } from './enums/league-stage-status.enum';
import { LeagueFixtureStatus } from './enums/league-fixture-status.enum';
import { LeagueGroupPairingMode } from './league-format.types';

type GroupStage = Pick<
  LeagueStageResponseDto,
  | 'code'
  | 'format'
  | 'status'
  | 'settings'
  | 'participants'
  | 'standings'
  | 'fixtures'
>;

/** Game tie rule: points, set difference, then prior seed (not code/name order). */
export function rankBattleGroups(
  groups: readonly LeagueGroupResponseDto[],
  participants: GroupStage['participants'],
): LeagueGroupResponseDto[] {
  const bestSeed = new Map<string, number>();
  for (const member of participants) {
    const code = member.groupCode ?? 'UNASSIGNED';
    bestSeed.set(
      code,
      Math.min(bestSeed.get(code) ?? Infinity, member.initialSeed),
    );
  }
  return [...groups]
    .filter((group) => group.standings.length > 0)
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.gameDifference - a.gameDifference ||
        (bestSeed.get(a.code) ?? Infinity) - (bestSeed.get(b.code) ?? Infinity),
    );
}

export function leagueGroupName(stageCode: string, code: string): string {
  // Display aliases only: old A/B saves keep their actual participants/results.
  if (stageCode === 'GROUP_BATTLE') {
    if (code === 'A' || code === 'BARON') return '바론 그룹';
    if (code === 'B' || code === 'ELDER') return '장로 그룹';
  }
  return (
    (
      {
        LEGEND: '레전드 그룹',
        RISE: '라이즈 그룹',
        ASCEND: '등봉조 · Ascend',
        NIRVANA: '열반조 · Nirvana',
        S: 'S 그룹',
        A: 'A 그룹',
        B: 'B 그룹',
        C: 'C 그룹',
        D: 'D 그룹',
        UNASSIGNED: '그룹 미지정',
      } as Record<string, string>
    )[code] ?? `${code} 그룹`
  );
}

/** Read-only projection; also used by qualification so UI and promotion agree. */
export function buildLeagueGroups(stage: GroupStage): LeagueGroupResponseDto[] {
  if (stage.format !== LeagueStageFormat.GROUP) return [];
  const codes = [
    ...new Set([
      ...(stage.settings.groupCodes ?? []),
      ...stage.participants.map((p) => p.groupCode ?? 'UNASSIGNED'),
    ]),
  ];
  const standings = new Map(stage.standings.map((row) => [row.teamId, row]));
  const teamGroups = new Map(
    stage.participants.map((p) => [p.teamId, p.groupCode ?? 'UNASSIGNED']),
  );
  const points = new Map<string, number>();
  for (const fixture of stage.fixtures) {
    if (
      fixture.status !== LeagueFixtureStatus.COMPLETED ||
      fixture.winnerTeamId === null
    )
      continue;
    const code = teamGroups.get(fixture.winnerTeamId);
    if (code === undefined) continue;
    const weight =
      stage.settings.superWeek &&
      fixture.bestOf === stage.settings.superWeek.bestOf
        ? stage.settings.superWeek.winPoints
        : 1;
    points.set(code, (points.get(code) ?? 0) + weight);
  }
  const groups: LeagueGroupResponseDto[] = codes.map((code) => {
    const members = stage.participants.filter(
      (p) => (p.groupCode ?? 'UNASSIGNED') === code,
    );
    const seeds = new Map(members.map((p) => [p.teamId, p.initialSeed]));
    const rows = members
      .flatMap((p) =>
        standings.has(p.teamId) ? [standings.get(p.teamId)!] : [],
      )
      .sort(
        (a, b) =>
          b.seriesWins - a.seriesWins ||
          b.gameDifference - a.gameDifference ||
          seeds.get(a.teamId)! - seeds.get(b.teamId)!,
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));
    return {
      code,
      name: leagueGroupName(stage.code, code),
      points: points.get(code) ?? 0,
      seriesWins: rows.reduce((sum, row) => sum + row.seriesWins, 0),
      seriesLosses: rows.reduce((sum, row) => sum + row.seriesLosses, 0),
      gameDifference: rows.reduce((sum, row) => sum + row.gameDifference, 0),
      battleStatus: null,
      battleTiebreaker: null,
      standings: rows,
    };
  });
  const populated = groups.filter((group) => group.standings.length > 0);
  if (
    stage.settings.pairingMode === LeagueGroupPairingMode.CROSS_GROUP &&
    populated.length >= 2
  ) {
    const [leader, runnerUp] = rankBattleGroups(populated, stage.participants);
    const tiedPoints = leader.points === runnerUp.points;
    const tied =
      tiedPoints && leader.gameDifference === runnerUp.gameDifference;
    const completed = stage.status === LeagueStageStatus.COMPLETED;
    for (const group of populated) {
      group.battleTiebreaker =
        leader.points > 0 && tiedPoints
          ? tied
            ? completed
              ? 'INITIAL_SEED'
              : null
            : 'GAME_DIFFERENCE'
          : null;
      group.battleStatus =
        leader.points === 0
          ? 'PENDING'
          : tied && !completed
            ? 'TIED'
            : group.code === leader.code
              ? completed
                ? 'WINNER'
                : 'LEADING'
              : completed
                ? 'LOSER'
                : 'TRAILING';
    }
  }
  return groups;
}
