import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLAYER_CARD_BASE_STAT_FIELDS } from '../../players/constants/player-card.constants';
import { validatePlayerCardSeeds } from './player-card-seed.validation';

describe('player card seed validation before database writes', () => {
  const valid = {
    key: 'valid_2026',
    mechanics: 119,
    gameSense: 0,
    laning: 70,
    teamFight: 70,
    macro: 70,
    teamPlay: 70,
    mental: 70,
    championPool: 70,
  };

  it('accepts explicit 119 potential and a missing derived potential', () => {
    expect(() => validatePlayerCardSeeds([valid])).not.toThrow();
    expect(() =>
      validatePlayerCardSeeds([{ ...valid, potential: 119 }]),
    ).not.toThrow();
  });

  describe.each([...PLAYER_CARD_BASE_STAT_FIELDS, 'potential'])(
    '%s',
    (field) => {
      it.each([120, 256, 999, -1, 1.5, '119', null])(
        'rejects invalid value %s with the card key and field',
        (value) => {
          expect(() =>
            validatePlayerCardSeeds([{ ...valid, [field]: value }]),
          ).toThrow(`valid_2026.${field} must be an integer between 0 and 119`);
        },
      );
    },
  );

  it.each(PLAYER_CARD_BASE_STAT_FIELDS)(
    'rejects missing base stat %s',
    (field) => {
      expect(() =>
        validatePlayerCardSeeds([{ ...valid, [field]: undefined }]),
      ).toThrow(`valid_2026.${field}`);
    },
  );

  it.each([null, 1, [], 'card'])('rejects malformed card %s', (card) => {
    expect(() => validatePlayerCardSeeds([card])).toThrow(
      'playerCards[0] must be an object',
    );
  });

  it('keeps the current user catalog within the same safe range', () => {
    const data = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../data/development-seed.json'),
        'utf8',
      ),
    ) as { playerCards: unknown[] };
    expect(() => validatePlayerCardSeeds(data.playerCards)).not.toThrow();
  });
});
