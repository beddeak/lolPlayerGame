import { LeagueStageFormat } from './enums/league-stage-format.enum';
import {
  LeagueGroupPairingMode,
  LeagueStageSettings,
} from './league-format.types';

interface CalendarStage {
  code: string;
  format: LeagueStageFormat;
  settings: LeagueStageSettings;
  participants?: ReadonlyArray<{ groupCode: string | null }>;
}

/** Conservative round bounds reserve time for every possible playoff result. */
export function getLeagueStageRoundBudgets(
  stages: readonly CalendarStage[],
  initialTeamCount: number,
): number[] {
  return stages.map((stage) => {
    if (stage.settings.bracket)
      return { HYBRID_SIX: 5, DOUBLE_SIX: 6, DOUBLE_FOUR: 4, CBLOL_PLAY_IN: 2 }[
        stage.settings.bracket
      ];
    const teamCount =
      stage.participants?.length ||
      Math.min(
        initialTeamCount,
        stage.settings.qualifierCount ?? initialTeamCount,
      );

    switch (stage.format) {
      case LeagueStageFormat.ROUND_ROBIN:
        return Math.max(
          1,
          roundRobinRounds(teamCount) * (stage.settings.cycles ?? 1),
        );
      case LeagueStageFormat.GROUP: {
        const groups = getGroupSizes(stage, teamCount);

        if (stage.settings.pairingMode === LeagueGroupPairingMode.CROSS_GROUP) {
          return (
            Math.max(1, ...groups.map((group) => group.size)) *
            (stage.settings.cycles ?? 1)
          );
        }

        return Math.max(
          1,
          ...groups.map(
            (group) =>
              roundRobinRounds(group.size) *
              (stage.settings.cyclesByGroup?.[group.code] ??
                stage.settings.cycles ??
                1),
          ),
        );
      }
      case LeagueStageFormat.SWISS:
        return stage.settings.advancementWins
          ? 6
          : (stage.settings.swissRounds ?? 3);
      case LeagueStageFormat.PLAY_IN:
        return 1;
      case LeagueStageFormat.GAUNTLET:
        return Math.max(1, teamCount - 1);
      case LeagueStageFormat.DOUBLE_ELIMINATION:
        // Each round must consume at least one of the 2N-1 possible losses,
        // including the undefeated finalist losing once (bracket reset).
        return Math.max(1, teamCount * 2 - 1);
      case LeagueStageFormat.SINGLE_ELIMINATION:
        return Math.max(1, Math.ceil(Math.log2(teamCount)));
    }
  });
}

function roundRobinRounds(teamCount: number): number {
  return teamCount < 2 ? 0 : teamCount % 2 === 0 ? teamCount - 1 : teamCount;
}

function getGroupSizes(
  stage: CalendarStage,
  teamCount: number,
): Array<{ code: string; size: number }> {
  const codes = stage.settings.groupCodes ?? ['ALL'];

  if (stage.participants?.length) {
    const counts = new Map<string, number>();
    stage.participants.forEach((participant) => {
      const code = participant.groupCode ?? 'ALL';
      counts.set(code, (counts.get(code) ?? 0) + 1);
    });
    return [...counts].map(([code, size]) => ({ code, size }));
  }

  let upperCount: number | undefined;

  if (stage.code === 'LEGEND_RISE') {
    upperCount = Math.ceil(teamCount / 2);
  } else if (stage.code === 'ASCEND_NIRVANA') {
    upperCount = Math.ceil((teamCount * 2) / 3);
  } else if (stage.code === 'RUMBLE_STAGE') {
    const initialGroups = Math.min(4, Math.max(1, Math.floor(teamCount / 2)));
    const automaticQualifiers = Math.min(teamCount, initialGroups * 2);
    upperCount = Math.min(
      teamCount,
      Math.max(automaticQualifiers, 2, Math.round((teamCount * 10) / 16)),
    );
  }

  if (upperCount !== undefined) {
    return [
      { code: codes[0], size: upperCount },
      { code: codes[1], size: teamCount - upperCount },
    ];
  }

  const groupCount = Math.min(
    codes.length,
    Math.max(1, Math.floor(teamCount / 2)),
  );
  return codes.slice(0, groupCount).map((code, index) => ({
    code,
    size:
      Math.floor(teamCount / groupCount) +
      (index < teamCount % groupCount ? 1 : 0),
  }));
}
