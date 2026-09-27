import { PlayerPersonality as P } from '../players/enums/player-personality.enum';
import { FeedbackOption as O } from './enums/feedback-option.enum';
import { calculateFeedbackReaction as react } from './feedback-reaction';
import { FeedbackPlayerState } from './feedback-effect';

describe('Contextual feedback reactions', () => {
  const loss = { won: false, rating: 5, teamAverageRating: 6 };
  const win = { won: true, rating: 9, teamAverageRating: 8 };
  const state = (
    personality: P,
    overrides: Partial<FeedbackPlayerState> = {},
  ): FeedbackPlayerState => ({
    personality,
    mental: 90,
    form: 60,
    coachTrust: 80,
    ...overrides,
  });

  it('same abusive team talk produces distinct reactions for all five personalities', () => {
    const loyal = react(state(P.LOYAL), O.ABUSIVE_TEAM, loss);
    const professional = react(state(P.PROFESSIONAL), O.ABUSIVE_TEAM, loss);
    const sensitive = react(state(P.SENSITIVE), O.ABUSIVE_TEAM, loss);
    const selfish = react(
      state(P.SELF_CENTERED, { mental: 65 }),
      O.ABUSIVE_TEAM,
      loss,
    );
    const devoted = react(state(P.DEVOTED), O.ABUSIVE_TEAM, loss);
    expect(loyal.mentalDelta).toBe(2);
    expect(loyal.reaction.motivation).toBe(8);
    expect(professional.mentalDelta).toBe(-1);
    expect(professional.formDelta).toBe(0);
    expect(sensitive.mentalDelta).toBe(-10);
    expect(sensitive.reaction.pressure).toBe(10);
    expect(selfish.coachTrustDelta).toBe(-12);
    expect(devoted.reaction.chemistry).toBe(-2);
  });

  it('support can burden low-mental or low-trust players instead of guaranteeing a buff', () => {
    expect(react(state(P.LOYAL), O.DEMAND_CARRY, win).reaction.carryBonus).toBe(
      2,
    );
    for (const player of [
      state(P.SENSITIVE),
      state(P.LOYAL, { mental: 40 }),
      state(P.LOYAL, { coachTrust: 20 }),
    ]) {
      const result = react(player, O.DEMAND_CARRY, loss);
      expect(result.reaction.carryBonus).toBe(-2);
      expect(result.formDelta).toBe(-2);
    }
  });

  it('uses results, performance, form and trust rather than tone alone', () => {
    const professional = state(P.PROFESSIONAL);
    expect(react(professional, O.PRAISE_TEAM, loss).reaction.confidence).toBe(
      -1,
    );
    expect(react(professional, O.PRAISE_TEAM, win).reaction.confidence).toBe(5);
    expect(
      react(state(P.SELF_CENTERED, { form: 90 }), O.PRAISE_TEAM, win).reaction
        .riskTaking,
    ).toBe(8);
    expect(
      react(state(P.LOYAL, { coachTrust: 20 }), O.WAKE_UP_TEAM, loss)
        .mentalDelta,
    ).toBeLessThan(0);
    expect(
      react(state(P.LOYAL), O.WAKE_UP_TEAM, loss).mentalDelta,
    ).toBeGreaterThan(0);
    expect(
      react(professional, O.BLAME_PLAYER, win).coachTrustDelta,
    ).toBeLessThan(react(professional, O.BLAME_PLAYER, loss).coachTrustDelta);
  });

  it('aggressive instructions trade opportunity for risk', () => {
    const safe = react(state(P.PROFESSIONAL), O.DEMAND_AGGRESSION, loss);
    const risky = react(state(P.SELF_CENTERED), O.DEMAND_AGGRESSION, loss);
    expect(safe.reaction.aggression).toBe(8);
    expect(risky.reaction.riskTaking).toBeGreaterThan(safe.reaction.riskTaking);
  });

  it('keeps every option within stat, form and trust limits without mutating the input', () => {
    for (const personality of Object.values(P))
      for (const option of Object.values(O))
        for (const bound of [0, 100, 119]) {
          const player = state(personality, {
            mental: bound,
            form: Math.min(bound, 100),
            coachTrust: Math.min(bound, 100),
          });
          const original = { ...player };
          const result = react(player, option, loss);
          expect(result.mentalAfter).toBeGreaterThanOrEqual(0);
          expect(result.mentalAfter).toBeLessThanOrEqual(119);
          for (const value of [
            result.formAfter,
            result.coachTrustAfter,
            result.reaction.acceptance,
          ]) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(100);
          }
          expect(player).toEqual(original);
        }
  });
});
