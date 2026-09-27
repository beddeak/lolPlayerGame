import { positionProficiencyModifier } from './position-proficiency.config';

describe('position proficiency penalty', () => {
  it.each([
    [0, -40],
    [20, -32],
    [50, -20],
    [99, -0.4],
    [100, 0],
    [120, 0],
    [-10, -40],
  ])('proficiency %s gives %s ability points', (proficiency, penalty) => {
    expect(positionProficiencyModifier(proficiency)).toBeCloseTo(penalty);
  });
});
