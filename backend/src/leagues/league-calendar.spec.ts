import {
  getLeagueFixtureDate,
  getLeagueSplitWindow,
} from '../calendars/config/season-calendar.config';
import { Region } from '../careers/enums/region.enum';
import { REGIONAL_LEAGUE_FORMATS } from './config/regional-league-formats';
import { LeagueStageFormat } from './enums/league-stage-format.enum';
import { getLeagueStageRoundBudgets } from './league-calendar';

describe('regional fixture round budgets', () => {
  for (const formats of Object.values(REGIONAL_LEAGUE_FORMATS)) {
    for (const format of Object.values(formats)) {
      it(`${format.name} fits its full roster and all playoff outcomes inside its domestic window`, () => {
        for (
          let teamCount = 2;
          teamCount <= format.expectedTeamCount;
          teamCount += 1
        ) {
          const budgets = getLeagueStageRoundBudgets(format.stages, teamCount);
          const window = getLeagueSplitWindow(2026, format.splitNumber);
          let previous: string | undefined;

          budgets.forEach((rounds, stageIndex) => {
            for (let round = 1; round <= rounds; round += 1) {
              const scheduled = getLeagueFixtureDate(
                2026,
                format.splitNumber,
                stageIndex + 1,
                round,
                previous ?? '2026-01-01',
                previous,
                budgets,
              );
              expect(scheduled >= window.startsAt).toBe(true);
              expect(scheduled <= window.endsAt).toBe(true);
              expect(!previous || scheduled > previous).toBe(true);
              previous = scheduled;
            }
          });
        }
      });
    }
  }

  it('counts odd group byes and asymmetric Ascend/Nirvana cycles', () => {
    expect(
      getLeagueStageRoundBudgets(
        REGIONAL_LEAGUE_FORMATS[Region.LCK][3].stages,
        10,
      ),
    ).toEqual([15, 1, 11]);
    expect(
      getLeagueStageRoundBudgets(
        REGIONAL_LEAGUE_FORMATS[Region.LPL][2].stages,
        16,
      ),
    ).toEqual([6, 18, 1, 15]);
    expect(
      getLeagueStageRoundBudgets(
        REGIONAL_LEAGUE_FORMATS[Region.LPL][3].stages,
        12,
      ),
    ).toEqual([14, 1, 15]);
  });

  it('uses persisted participant groups without changing their assignment', () => {
    const stage = {
      ...REGIONAL_LEAGUE_FORMATS[Region.LPL][2].stages[1],
      participants: [
        ...Array.from({ length: 8 }, () => ({ groupCode: 'ASCEND' })),
        ...Array.from({ length: 4 }, () => ({ groupCode: 'NIRVANA' })),
      ],
    };
    const before = JSON.stringify(stage);
    expect(getLeagueStageRoundBudgets([stage], 16)).toEqual([14]);
    expect(JSON.stringify(stage)).toBe(before);
  });

  it('reserves a possible double-elimination bracket reset and one-day play-ins', () => {
    expect(
      getLeagueStageRoundBudgets(
        [
          { code: 'PLAY_IN', format: LeagueStageFormat.PLAY_IN, settings: {} },
          {
            code: 'PO',
            format: LeagueStageFormat.DOUBLE_ELIMINATION,
            settings: {},
          },
        ],
        2,
      ),
    ).toEqual([1, 3]);
  });
});
