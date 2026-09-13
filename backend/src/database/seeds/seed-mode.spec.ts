import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCatalogOnlySeed } from './seed-mode';
import { ClubSeedData, validateClubSeeds } from './club-catalog.seed';

describe('catalog-only seed safety', () => {
  it.each([undefined, '', ' '])(
    'does not create a development career without a team: %s',
    (code) => {
      expect(isCatalogOnlySeed(code, [])).toBe(true);
    },
  );
  it('always honors explicit catalog-only mode', () => {
    expect(isCatalogOnlySeed('HLE', ['--catalog-only'])).toBe(true);
  });
  it('requires explicit configuration to use the legacy development career path', () => {
    expect(isCatalogOnlySeed('HLE', [])).toBe(false);
  });
  it('ships only real roster data and defaults to catalog-only import', () => {
    const data = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../data/development-seed.json'),
        'utf8',
      ),
    ) as {
      managedTeamCode?: string;
      playerCards: Array<{
        key: string;
        themeCode: string;
        nickname: string;
        imageUrl?: string;
      }>;
      teams: ClubSeedData[];
      themes: Array<{ code: string }>;
      setBonuses: Array<{ code: string }>;
    };
    expect(isCatalogOnlySeed(data.managedTeamCode, [])).toBe(true);
    expect(data.managedTeamCode).toBeUndefined();
    expect(
      data.playerCards.some((card) => /^(blue_|red_|demo_)/i.test(card.key)),
    ).toBe(false);
    expect(data.teams.some((team) => /^DEV_|^DEMO_/i.test(team.code))).toBe(
      false,
    );
    expect(
      data.setBonuses.some((bonus) => /^DEV_|^DEMO_/i.test(bonus.code)),
    ).toBe(false);
    expect(
      data.playerCards.every((card) =>
        data.themes.some((theme) => theme.code === card.themeCode),
      ),
    ).toBe(true);
    const keys = new Set(data.playerCards.map((card) => card.key));
    expect(keys.size).toBe(data.playerCards.length);
    expect(() => validateClubSeeds(data.teams, keys)).not.toThrow();
  });
});
