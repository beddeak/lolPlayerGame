import { Region } from '../../careers/enums/region.enum';
import { LeagueStageFormat } from '../enums/league-stage-format.enum';
import { REGIONAL_LEAGUE_FORMATS } from './regional-league-formats';

describe('regional league formats', () => {
  it('defines all three splits for all four regions', () => {
    for (const region of Object.values(Region)) {
      expect(Object.keys(REGIONAL_LEAGUE_FORMATS[region])).toEqual([
        '1',
        '2',
        '3',
      ]);
    }
  });

  it('keeps each region-specific 2026 identity', () => {
    expect(REGIONAL_LEAGUE_FORMATS.LCK[1].stages[0].code).toBe('GROUP_BATTLE');
    expect(REGIONAL_LEAGUE_FORMATS.LCK[3].stages[0].code).toBe('LEGEND_RISE');
    expect(REGIONAL_LEAGUE_FORMATS.LPL[2].stages[1].code).toBe('RUMBLE_STAGE');
    expect(REGIONAL_LEAGUE_FORMATS.LEC[2].stages[0].format).toBe(
      LeagueStageFormat.ROUND_ROBIN,
    );
    expect(REGIONAL_LEAGUE_FORMATS.LEC[2].stages[0].bestOf).toBe(1);
    expect(REGIONAL_LEAGUE_FORMATS.LCS[1].stages[0].format).toBe(
      LeagueStageFormat.SWISS,
    );
  });

  it('uses BO5 for every playoff stage', () => {
    const playoffStages = Object.values(REGIONAL_LEAGUE_FORMATS).flatMap(
      (regionFormats) =>
        Object.values(regionFormats).flatMap((format) =>
          format.stages.filter((stage) => stage.code === 'PLAYOFFS'),
        ),
    );

    expect(playoffStages).toHaveLength(12);
    expect(playoffStages.every((stage) => stage.bestOf === 5)).toBe(true);
  });
});
