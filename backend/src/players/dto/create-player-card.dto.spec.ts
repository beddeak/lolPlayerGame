import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Position } from '../enums/position.enum';
import { CreatePlayerCardDto } from './create-player-card.dto';

describe('CreatePlayerCardDto', () => {
  const createInput = (cardYear: number, startingAge: number) => ({
    playerId: 1,
    themeId: 1,
    cardYear,
    startingAge,
    mainPosition: Position.MID,
    mechanics: 70,
    gameSense: 70,
    laning: 70,
    teamFight: 70,
    macro: 70,
    teamPlay: 70,
    mental: 70,
    championPool: 70,
    potential: 80,
  });

  it.each([
    [1900, 18],
    [9999, 38],
  ])('accepts cardYear %i and startingAge %i', (cardYear, startingAge) => {
    const dto = plainToInstance(
      CreatePlayerCardDto,
      createInput(cardYear, startingAge),
    );

    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([
    ['cardYear', 1899, 20],
    ['cardYear', 10000, 20],
    ['startingAge', 2026, 15],
    ['startingAge', 2026, 99],
  ])('rejects an out-of-range %s', (invalidProperty, cardYear, startingAge) => {
    const dto = plainToInstance(
      CreatePlayerCardDto,
      createInput(cardYear, startingAge),
    );
    const errors = validateSync(dto);

    expect(errors.map((error) => error.property)).toContain(invalidProperty);
  });
});
