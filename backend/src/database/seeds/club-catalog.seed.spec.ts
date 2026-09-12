import { Region } from '../../careers/enums/region.enum';
import { Position } from '../../players/enums/position.enum';
import { ClubSeedData, validateClubSeeds } from './club-catalog.seed';

describe('club catalog import validation', () => {
  const team = (): ClubSeedData => ({
    code: 'TEST',
    name: '테스트 구단',
    region: Region.LCK,
    logoUrl: '/club-logos/test.png',
    starters: [{ position: Position.TOP, playerCardKey: 'top' }],
    benches: [{ playerCardKey: 'bench' }],
  });
  const keys = new Set(['top', 'bench']);
  it('allows incomplete draft rosters for the catalog readiness screen', () => {
    expect(() => validateClubSeeds([team()], keys)).not.toThrow();
  });
  it('allows hidden draft teams to reuse cards outside the active career world', () => {
    expect(() =>
      validateClubSeeds(
        [team(), { ...team(), code: 'DRAFT', enabled: false }],
        keys,
      ),
    ).not.toThrow();
  });
  it('rejects repeated active cards across teams', () => {
    expect(() =>
      validateClubSeeds([team(), { ...team(), code: 'OTHER' }], keys),
    ).toThrow('중복 선수');
  });
  it('rejects repeated team codes', () => {
    expect(() => validateClubSeeds([team(), team()], keys)).toThrow(
      '중복 구단',
    );
  });
  it('rejects unknown card references before writing anything', () => {
    expect(() => validateClubSeeds([team()], new Set())).toThrow(
      '없는 playerCardKey',
    );
  });
  it('rejects duplicate starting positions', () => {
    const value = team();
    value.starters.push({ position: Position.TOP, playerCardKey: 'bench' });
    value.benches = [];
    expect(() => validateClubSeeds([value], keys)).toThrow('포지션');
  });
  it('rejects starter/bench duplication', () => {
    const value = team();
    value.benches = [{ playerCardKey: 'top' }];
    expect(() => validateClubSeeds([value], keys)).toThrow('중복 선수');
  });
  it.each([
    'javascript:alert(1)',
    '//untrusted/logo.png',
    'C:\\images\\logo.png',
    '',
  ])('rejects unsupported logo path %s', (logoUrl) => {
    expect(() => validateClubSeeds([{ ...team(), logoUrl }], keys)).toThrow(
      'logoUrl',
    );
  });
  it.each([null, '/club-logos/team.webp', 'https://example.com/team.png'])(
    'allows supported or missing logo %s',
    (logoUrl) => {
      expect(() =>
        validateClubSeeds([{ ...team(), logoUrl }], keys),
      ).not.toThrow();
    },
  );
  it.each([-1, 101, 65.5, Number.NaN])(
    'rejects invalid chemistry %s',
    (initialChemistry) => {
      expect(() =>
        validateClubSeeds([{ ...team(), initialChemistry }], keys),
      ).toThrow('initialChemistry');
    },
  );
  it('keeps explicit zero state values valid', () => {
    const value = team();
    value.initialChemistry = 0;
    value.starters[0].initialCoachTrust = 0;
    value.benches![0].initialForm = 0;
    expect(() => validateClubSeeds([value], keys)).not.toThrow();
  });
  it('rejects more than five reserves', () => {
    const value = team();
    value.benches = Array.from({ length: 6 }, () => ({
      playerCardKey: 'bench',
    }));
    expect(() => validateClubSeeds([value], keys)).toThrow('benches');
  });
});
