import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { CareerPlayer } from '../../careers/entities/career-player.entity';
import { PLAYER_CARD_BASE_STAT_FIELDS } from '../constants/player-card.constants';
import { PlayerCard } from '../entities/player-card.entity';
import {
  assertPlayerStat,
  PLAYER_STAT_TRANSFORMER,
} from './player-stat.transformer';

describe('persistent player stat boundaries', () => {
  it.each([0, 100, 119])('preserves valid stat %i', (value) => {
    expect(PLAYER_STAT_TRANSFORMER.to(value)).toBe(value);
    expect(PLAYER_STAT_TRANSFORMER.from(value)).toBe(value);
  });

  it.each([120, 256, 999, -1, 1.5, '119', null, undefined, NaN, Infinity])(
    'rejects invalid write %s rather than silently clamping',
    (value) => {
      expect(() => PLAYER_STAT_TRANSFORMER.to(value)).toThrow(RangeError);
      expect(() => assertPlayerStat(value, 'card.mental')).toThrow(
        'card.mental must be an integer between 0 and 119',
      );
    },
  );

  it('guards all persistent base stats and potential on both entities', () => {
    const columns = getMetadataArgsStorage().columns;
    for (const field of [...PLAYER_CARD_BASE_STAT_FIELDS, 'potential']) {
      expect(
        columns.find(
          (column) =>
            column.target === PlayerCard && column.propertyName === field,
        )?.options.transformer,
      ).toBe(PLAYER_STAT_TRANSFORMER);
    }
    for (const field of PLAYER_CARD_BASE_STAT_FIELDS) {
      const currentField = `current${field[0].toUpperCase()}${field.slice(1)}`;
      expect(
        columns.find(
          (column) =>
            column.target === CareerPlayer &&
            column.propertyName === currentField,
        )?.options.transformer,
      ).toBe(PLAYER_STAT_TRANSFORMER);
    }
  });

  it('does not change the separate form, condition or coach-trust scales', () => {
    for (const field of ['form', 'condition', 'coachTrust']) {
      expect(
        getMetadataArgsStorage().columns.find(
          (column) =>
            column.target === CareerPlayer && column.propertyName === field,
        )?.options.transformer,
      ).toBeUndefined();
    }
  });
});
