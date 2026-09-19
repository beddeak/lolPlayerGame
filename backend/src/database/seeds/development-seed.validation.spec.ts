import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateDevelopmentSeed } from './development-seed.validation';

const fixture = () => ({
  startYear: 2026,
  themes: [{ code: 'BASE', name: 'Base', description: null }],
  playerCards: [
    {
      key: 'top',
      nickname: 'Player',
      nationality: 'KR',
      themeCode: 'BASE',
      cardYear: 2026,
      startingAge: 20,
      mainPosition: 'TOP',
      mechanics: 119,
      gameSense: 80,
      laning: 80,
      teamFight: 80,
      macro: 80,
      teamPlay: 80,
      mental: 80,
      championPool: 80,
    },
  ],
  teams: [
    {
      code: 'TEAM',
      name: 'Team',
      region: 'LCK',
      starters: [{ position: 'TOP', playerCardKey: 'top' }],
      benches: [],
    },
  ],
  setBonuses: [],
});

describe('complete seed preflight before database access', () => {
  it('accepts valid card data and draft clubs without modifying or clamping authored values', () => {
    const value = fixture();
    const before = structuredClone(value);
    expect(validateDevelopmentSeed(value)).toBe(value);
    expect(value).toEqual(before);
  });

  it.each([{}, { key: '' }, null, [], 'player'])(
    'rejects incomplete card %p with its array index',
    (value) => {
      expect(() =>
        validateDevelopmentSeed({ ...fixture(), playerCards: [value] }),
      ).toThrow('playerCards[0]');
    },
  );

  it.each([
    ['nickname', ''],
    ['nickname', ' Player '],
    ['nationality', 7],
    ['startingAge', 15],
    ['startingAge', 41],
    ['startingAge', null],
    ['cardYear', 1800],
    ['mainPosition', 'JGL'],
    ['personality', 'INVALID'],
    ['mechanics', 120],
    ['potential', 120],
    ['themeCode', 'UNKNOWN'],
  ])('rejects invalid %s before running the importer', (field, value) => {
    const data = fixture();
    expect(() =>
      validateDevelopmentSeed({
        ...data,
        playerCards: [{ ...data.playerCards[0], [field]: value }],
      }),
    ).toThrow(field);
  });

  it('rejects key collisions and aliased duplicate player/theme/year rows', () => {
    const data = fixture();
    data.playerCards.push({ ...data.playerCards[0] });
    expect(() => validateDevelopmentSeed(data)).toThrow('duplicate value top');
    data.playerCards[1].key = 'alias';
    expect(() => validateDevelopmentSeed(data)).toThrow(
      'duplicate player/theme/year card identity',
    );
  });

  it('rejects numeric theme references even when their string value matches a theme', () => {
    const data = fixture();
    data.themes[0].code = '123';
    expect(() =>
      validateDevelopmentSeed({
        ...data,
        playerCards: [{ ...data.playerCards[0], themeCode: 123 }],
      }),
    ).toThrow('themeCode');
  });

  it('rejects two different year cards of the same player in the active world', () => {
    const data = fixture();
    data.playerCards.push({
      ...data.playerCards[0],
      key: 'top_old',
      cardYear: 2025,
    });
    data.teams.push({
      ...data.teams[0],
      code: 'OTHER',
      starters: [{ position: 'TOP', playerCardKey: 'top_old' }],
    });
    expect(() => validateDevelopmentSeed(data)).toThrow(
      'same player registered',
    );
  });

  it('rejects broken roster and set-bonus references', () => {
    const data = fixture();
    data.teams[0].starters[0].playerCardKey = 'missing';
    expect(() => validateDevelopmentSeed(data)).toThrow('missing');
    expect(() =>
      validateDevelopmentSeed({
        ...fixture(),
        setBonuses: [
          { code: 'BONUS', name: 'Bonus', requiredPlayerCardKeys: ['missing'] },
        ],
      }),
    ).toThrow('requiredPlayerCardKeys');
  });

  it.each(['themes', 'playerCards', 'teams', 'setBonuses'])(
    'rejects a missing %s array',
    (field) => {
      expect(() =>
        validateDevelopmentSeed({ ...fixture(), [field]: undefined }),
      ).toThrow(field);
    },
  );

  it('rejects malformed themes and duplicate theme identities', () => {
    expect(() =>
      validateDevelopmentSeed({ ...fixture(), themes: [null] }),
    ).toThrow('themes[0]');
    const data = fixture();
    data.themes.push({ ...data.themes[0], code: 'base' });
    expect(() => validateDevelopmentSeed(data)).toThrow('duplicate value base');
  });

  it('keeps optional age/potential fallback compatible with existing input', () => {
    const data = fixture();
    expect(() =>
      validateDevelopmentSeed({
        ...data,
        playerCards: [{ ...data.playerCards[0], startingAge: undefined }],
      }),
    ).not.toThrow();
  });

  it('validates the current authored catalog and restored T1 references', () => {
    const data = validateDevelopmentSeed(
      JSON.parse(
        readFileSync(
          resolve(__dirname, '../../../data/development-seed.json'),
          'utf8',
        ),
      ) as unknown,
    );
    const keys = data.teams.flatMap((team) =>
      [...team.starters, ...(team.benches ?? [])].map(
        (slot) => slot.playerCardKey,
      ),
    );
    const cardKeys = new Set(data.playerCards.map((card) => card.key));
    expect(keys.every((key) => cardKeys.has(key))).toBe(true);
    expect(
      data.teams
        .find((team) => team.code === 'T1')
        ?.starters.map((slot) => slot.playerCardKey),
    ).toHaveLength(5);
  });
});
