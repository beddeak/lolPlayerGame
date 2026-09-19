import { CAREER_PLAYER_STATE_CONFIG } from '../../careers/config/player-state.config';
import {
  calculatePlayerMatchStateModifiers,
  calculatePostMatchPlayerState,
} from './player-match-state';

describe('player match state', () => {
  it('keeps the configured initial state neutral at Mental 50', () => {
    expect(
      calculatePlayerMatchStateModifiers({
        form: CAREER_PLAYER_STATE_CONFIG.initial.form,
        condition: CAREER_PLAYER_STATE_CONFIG.initial.condition,
        mental: 50,
      }),
    ).toEqual({
      formModifier: 0,
      conditionModifier: 0,
      mentalModifier: 0,
      stateModifier: 0,
    });
  });

  it('penalizes a player whose Form and Condition are poor', () => {
    expect(
      calculatePlayerMatchStateModifiers({
        form: 37,
        condition: 51,
        mental: 70,
      }),
    ).toEqual({
      formModifier: -1.56,
      conditionModifier: -5.88,
      mentalModifier: 1.6,
      stateModifier: -5.84,
    });
  });

  it('updates Form, Condition, and Mental after a strong win', () => {
    expect(
      calculatePostMatchPlayerState(
        { form: 50, condition: 100, mental: 50 },
        8,
        31,
        true,
      ),
    ).toEqual({
      form: 57,
      condition: 94,
      mental: 52,
      formDelta: 7,
      conditionDelta: -6,
      mentalDelta: 2,
    });
  });

  it('clamps Mental to 119 while Form and Condition remain in 0 to 100', () => {
    expect(
      calculatePostMatchPlayerState(
        { form: 0, condition: 2, mental: 0 },
        0,
        40,
        false,
      ),
    ).toEqual(
      expect.objectContaining({
        form: 0,
        condition: 0,
        mental: 0,
        formDelta: 0,
        conditionDelta: -2,
        mentalDelta: 0,
      }),
    );
    expect(
      calculatePostMatchPlayerState(
        { form: 100, condition: 100, mental: 119 },
        10,
        25,
        true,
      ),
    ).toEqual(expect.objectContaining({ form: 100, mental: 119 }));
  });

  it('does not reset valid high Mental to 100 after a loss', () => {
    const state = calculatePostMatchPlayerState(
      { form: 100, condition: 100, mental: 119 },
      5,
      25,
      false,
    );
    expect(state.mental).toBe(118);
    expect(state.mentalDelta).toBe(-1);
  });

  it('allows Mental above 100 to grow up to 119', () => {
    expect(
      calculatePostMatchPlayerState(
        { form: 100, condition: 100, mental: 118 },
        10,
        25,
        true,
      ).mental,
    ).toBe(119);
  });
});
