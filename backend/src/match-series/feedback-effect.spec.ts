import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { FeedbackOption } from './enums/feedback-option.enum';
import { calculateFeedbackPlayerEffect } from './feedback-effect';

describe('calculateFeedbackPlayerEffect', () => {
  const baseState = {
    mental: 50,
    form: 50,
    coachTrust: 50,
  };

  it('makes a sensitive player react more strongly than a professional', () => {
    const sensitive = calculateFeedbackPlayerEffect(
      { ...baseState, personality: PlayerPersonality.SENSITIVE },
      FeedbackOption.ABUSIVE_TEAM,
    );
    const professional = calculateFeedbackPlayerEffect(
      { ...baseState, personality: PlayerPersonality.PROFESSIONAL },
      FeedbackOption.ABUSIVE_TEAM,
    );

    expect(Math.abs(sensitive.mentalDelta)).toBeGreaterThan(
      Math.abs(professional.mentalDelta),
    );
    expect(Math.abs(sensitive.coachTrustDelta)).toBeGreaterThan(
      Math.abs(professional.coachTrustDelta),
    );
  });

  it('rewards a self-centered player for a carry demand', () => {
    const selfCentered = calculateFeedbackPlayerEffect(
      { ...baseState, personality: PlayerPersonality.SELF_CENTERED },
      FeedbackOption.DEMAND_CARRY,
    );
    const professional = calculateFeedbackPlayerEffect(
      { ...baseState, personality: PlayerPersonality.PROFESSIONAL },
      FeedbackOption.DEMAND_CARRY,
    );

    expect(selfCentered.formDelta).toBeGreaterThan(professional.formDelta);
  });

  it('lets high Mental absorb harsh feedback better', () => {
    const lowMental = calculateFeedbackPlayerEffect(
      {
        ...baseState,
        personality: PlayerPersonality.SENSITIVE,
        mental: 20,
      },
      FeedbackOption.BLAME_PLAYER,
    );
    const highMental = calculateFeedbackPlayerEffect(
      {
        ...baseState,
        personality: PlayerPersonality.SENSITIVE,
        mental: 90,
      },
      FeedbackOption.BLAME_PLAYER,
    );

    expect(Math.abs(lowMental.mentalDelta)).toBeGreaterThan(
      Math.abs(highMental.mentalDelta),
    );
  });

  it('clamps every resulting state to the 0 to 100 range', () => {
    const result = calculateFeedbackPlayerEffect(
      {
        personality: PlayerPersonality.SENSITIVE,
        mental: 1,
        form: 1,
        coachTrust: 1,
      },
      FeedbackOption.ABUSIVE_TEAM,
    );

    expect(result.mentalAfter).toBe(0);
    expect(result.formAfter).toBe(0);
    expect(result.coachTrustAfter).toBe(0);
  });
});
