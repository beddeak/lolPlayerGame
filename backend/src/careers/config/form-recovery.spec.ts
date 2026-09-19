import {
  feedbackFormRecovery,
  formRecovery,
  mentalRecoveryFactor,
  passiveRecoveryInterval,
} from './form-recovery';
import { calculatePostMatchPlayerState } from '../../matches/simulation/player-match-state';

describe('Mental-dependent form recovery', () => {
  it('uses the full 0..119 ability range with strong low/high differences', () => {
    expect(mentalRecoveryFactor(-5)).toBe(0);
    expect(mentalRecoveryFactor(120)).toBe(1);
    expect(formRecovery(0, 'match')).toBe(3);
    expect(formRecovery(119, 'match')).toBe(7);
    expect(formRecovery(0, 'rest')).toBe(1);
    expect(formRecovery(119, 'rest')).toBe(3);
    expect(passiveRecoveryInterval(0)).toBe(14);
    expect(passiveRecoveryInterval(119)).toBe(2);
  });

  it('is monotonic and keeps match practice above rest, scrims and positive feedback for every Mental value', () => {
    for (let mental = 0; mental <= 119; mental++) {
      const match = formRecovery(mental, 'match');
      expect(match).toBeGreaterThan(formRecovery(mental, 'rest'));
      expect(match).toBeGreaterThan(formRecovery(mental, 'scrim'));
      expect(match).toBeGreaterThan(feedbackFormRecovery(mental, 100));
      expect(formRecovery(mental + 1, 'match')).toBeGreaterThanOrEqual(match);
      expect(formRecovery(mental + 1, 'rest')).toBeGreaterThanOrEqual(
        formRecovery(mental, 'rest'),
      );
      expect(passiveRecoveryInterval(mental + 1)).toBeLessThanOrEqual(
        passiveRecoveryInterval(mental),
      );
    }
  });

  it('gives form through repeated matches while condition keeps falling; Mental determines resilience', () => {
    for (const mental of [0, 50, 90, 119]) {
      let state = { form: 20, condition: 90, mental };
      for (let game = 0; game < 3; game++) {
        const after = calculatePostMatchPlayerState(state, 5, 30, false);
        expect(after.form).toBeGreaterThan(state.form);
        expect(after.condition).toBeLessThan(state.condition);
        state = after;
      }
    }
    const low = calculatePostMatchPlayerState(
      { form: 30, condition: 80, mental: 10 },
      2,
      30,
      false,
    );
    const high = calculatePostMatchPlayerState(
      { form: 30, condition: 80, mental: 119 },
      2,
      30,
      false,
    );
    expect(high.formDelta).toBeGreaterThan(low.formDelta);
    expect(low.formDelta).toBeLessThan(0);
    expect(high.formDelta).toBeGreaterThan(0);
    expect(high.conditionDelta).toBe(low.conditionDelta);
  });

  it('records actual deltas at all caps rather than displaying gains that did not occur', () => {
    const result = calculatePostMatchPlayerState(
      { form: 99, condition: 1, mental: 118 },
      10,
      30,
      true,
    );
    expect(result).toEqual({
      form: 100,
      condition: 0,
      mental: 119,
      formDelta: 1,
      conditionDelta: -1,
      mentalDelta: 1,
    });
    expect(feedbackFormRecovery(119, -3)).toBe(-3);
    expect(feedbackFormRecovery(10, 5)).toBeLessThan(
      feedbackFormRecovery(119, 5),
    );
  });
});
