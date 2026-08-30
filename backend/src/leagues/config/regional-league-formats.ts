import { Region } from '../../careers/enums/region.enum';
import { LeagueStageFormat } from '../enums/league-stage-format.enum';
import {
  LeagueGroupPairingMode,
  RegionalLeagueFormat,
} from '../league-format.types';

const bo5Playoffs = (qualifierCount: number) => ({
  code: 'PLAYOFFS',
  name: 'Playoffs',
  format: LeagueStageFormat.DOUBLE_ELIMINATION,
  bestOf: 5 as const,
  settings: {
    qualifierCount,
    description: 'Two losses eliminate a team.',
  },
});

export const REGIONAL_LEAGUE_FORMATS: Record<
  Region,
  Record<number, RegionalLeagueFormat>
> = {
  [Region.LCK]: {
    1: {
      region: Region.LCK,
      splitNumber: 1,
      name: 'LCK Split 1',
      expectedTeamCount: 10,
      stages: [
        {
          code: 'GROUP_BATTLE',
          name: 'Group Battle',
          format: LeagueStageFormat.GROUP,
          bestOf: 3,
          settings: {
            groupCodes: ['A', 'B'],
            pairingMode: LeagueGroupPairingMode.CROSS_GROUP,
            cycles: 1,
            description: 'Every team plays each team in the opposite group.',
          },
        },
        {
          code: 'PLAY_IN',
          name: 'Play-In',
          format: LeagueStageFormat.PLAY_IN,
          bestOf: 3,
          settings: { qualifierCount: 3 },
        },
        bo5Playoffs(6),
      ],
    },
    2: {
      region: Region.LCK,
      splitNumber: 2,
      name: 'LCK Split 2',
      expectedTeamCount: 10,
      stages: [
        {
          code: 'REGULAR_SEASON',
          name: 'Regular Season',
          format: LeagueStageFormat.ROUND_ROBIN,
          bestOf: 3,
          settings: { cycles: 2 },
        },
        {
          code: 'PLAYOFFS',
          name: 'King of the Hill Playoffs',
          format: LeagueStageFormat.GAUNTLET,
          bestOf: 5,
          settings: { qualifierCount: 6 },
        },
      ],
    },
    3: {
      region: Region.LCK,
      splitNumber: 3,
      name: 'LCK Split 3',
      expectedTeamCount: 10,
      stages: [
        {
          code: 'LEGEND_RISE',
          name: 'Legend / Rise',
          format: LeagueStageFormat.GROUP,
          bestOf: 3,
          settings: {
            groupCodes: ['LEGEND', 'RISE'],
            pairingMode: LeagueGroupPairingMode.INTRA_GROUP,
            cycles: 3,
          },
        },
        {
          code: 'PLAY_IN',
          name: 'Play-In',
          format: LeagueStageFormat.PLAY_IN,
          bestOf: 5,
          settings: { qualifierCount: 2 },
        },
        bo5Playoffs(6),
      ],
    },
  },
  [Region.LPL]: {
    1: {
      region: Region.LPL,
      splitNumber: 1,
      name: 'LPL Split 1',
      expectedTeamCount: 16,
      stages: [
        {
          code: 'TIER_GROUPS',
          name: 'S / A / B Tier Groups',
          format: LeagueStageFormat.GROUP,
          bestOf: 3,
          settings: {
            groupCodes: ['S', 'A', 'B'],
            pairingMode: LeagueGroupPairingMode.INTRA_GROUP,
            cycles: 2,
          },
        },
        {
          code: 'KNIGHTS_RIVAL',
          name: 'Knights Rival Play-In',
          format: LeagueStageFormat.PLAY_IN,
          bestOf: 5,
          settings: { qualifierCount: 4 },
        },
        bo5Playoffs(8),
      ],
    },
    2: {
      region: Region.LPL,
      splitNumber: 2,
      name: 'LPL Split 2',
      expectedTeamCount: 16,
      stages: [
        {
          code: 'GROUP_STAGE',
          name: 'Four Group Stage',
          format: LeagueStageFormat.GROUP,
          bestOf: 3,
          settings: {
            groupCodes: ['A', 'B', 'C', 'D'],
            pairingMode: LeagueGroupPairingMode.INTRA_GROUP,
            cycles: 2,
          },
        },
        {
          code: 'RUMBLE_STAGE',
          name: 'Ascend / Nirvana Rumble Stage',
          format: LeagueStageFormat.GROUP,
          bestOf: 3,
          settings: {
            groupCodes: ['ASCEND', 'NIRVANA'],
            pairingMode: LeagueGroupPairingMode.INTRA_GROUP,
            cyclesByGroup: { ASCEND: 2, NIRVANA: 1 },
          },
        },
        {
          code: 'KNIGHTS_RIVAL',
          name: 'Knights Rival',
          format: LeagueStageFormat.PLAY_IN,
          bestOf: 5,
          settings: { qualifierCount: 4 },
        },
        bo5Playoffs(8),
      ],
    },
    3: {
      region: Region.LPL,
      splitNumber: 3,
      name: 'LPL Split 3',
      expectedTeamCount: 12,
      stages: [
        {
          code: 'ASCEND_NIRVANA',
          name: 'Ascend / Nirvana',
          format: LeagueStageFormat.GROUP,
          bestOf: 3,
          settings: {
            groupCodes: ['ASCEND', 'NIRVANA'],
            pairingMode: LeagueGroupPairingMode.INTRA_GROUP,
            cycles: 2,
          },
        },
        {
          code: 'KNIGHTS_RIVAL',
          name: 'Knights Rival',
          format: LeagueStageFormat.PLAY_IN,
          bestOf: 5,
          settings: { qualifierCount: 2 },
        },
        bo5Playoffs(8),
      ],
    },
  },
  [Region.LEC]: {
    1: {
      region: Region.LEC,
      splitNumber: 1,
      name: 'LEC Split 1',
      expectedTeamCount: 10,
      stages: [
        {
          code: 'REGULAR_SEASON',
          name: 'Single Round Robin',
          format: LeagueStageFormat.ROUND_ROBIN,
          bestOf: 1,
          settings: { cycles: 1 },
        },
        bo5Playoffs(8),
      ],
    },
    2: {
      region: Region.LEC,
      splitNumber: 2,
      name: 'LEC Split 2',
      expectedTeamCount: 10,
      stages: [
        {
          code: 'REGULAR_SEASON',
          name: 'Single Round Robin',
          format: LeagueStageFormat.ROUND_ROBIN,
          bestOf: 1,
          settings: { cycles: 1 },
        },
        bo5Playoffs(6),
      ],
    },
    3: {
      region: Region.LEC,
      splitNumber: 3,
      name: 'LEC Split 3',
      expectedTeamCount: 10,
      stages: [
        {
          code: 'REGULAR_SEASON',
          name: 'Single Round Robin',
          format: LeagueStageFormat.ROUND_ROBIN,
          bestOf: 1,
          settings: { cycles: 1 },
        },
        bo5Playoffs(6),
      ],
    },
  },
  [Region.LCS]: {
    1: {
      region: Region.LCS,
      splitNumber: 1,
      name: 'LCS Split 1',
      expectedTeamCount: 8,
      stages: [
        {
          code: 'SWISS_STAGE',
          name: 'Three Round Swiss Stage',
          format: LeagueStageFormat.SWISS,
          bestOf: 3,
          settings: { swissRounds: 3 },
        },
        bo5Playoffs(6),
      ],
    },
    2: {
      region: Region.LCS,
      splitNumber: 2,
      name: 'LCS Split 2',
      expectedTeamCount: 8,
      stages: [
        {
          code: 'REGULAR_SEASON',
          name: 'Single Round Robin',
          format: LeagueStageFormat.ROUND_ROBIN,
          bestOf: 3,
          settings: { cycles: 1 },
        },
        bo5Playoffs(6),
      ],
    },
    3: {
      region: Region.LCS,
      splitNumber: 3,
      name: 'LCS Split 3',
      expectedTeamCount: 8,
      stages: [
        {
          code: 'REGULAR_SEASON',
          name: 'Single Round Robin',
          format: LeagueStageFormat.ROUND_ROBIN,
          bestOf: 3,
          settings: { cycles: 1 },
        },
        {
          code: 'PLAYOFFS',
          name: 'Modified Double Elimination / Gauntlet',
          format: LeagueStageFormat.DOUBLE_ELIMINATION,
          bestOf: 5,
          settings: {
            qualifierCount: 6,
            description:
              'Two-loss elimination with a gauntlet-style lower path.',
          },
        },
      ],
    },
  },
};

export function getRegionalLeagueFormat(
  region: Region,
  splitNumber: number,
): RegionalLeagueFormat {
  return REGIONAL_LEAGUE_FORMATS[region][splitNumber];
}
