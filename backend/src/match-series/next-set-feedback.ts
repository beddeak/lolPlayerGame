import type { SimpleMatchTeamInput } from '../matches/simulation/simple-match.types';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { Position } from '../players/enums/position.enum';

/** Transient modifiers, attached only to the set immediately after this talk. */
export interface NextSetFeedback {
  mental: number;
  form: number;
  confidence: number;
  motivation: number;
  pressure: number;
  aggression: number;
  riskTaking: number;
  carryBonus: number;
}

export interface FeedbackReaction extends NextSetFeedback {
  version: 1;
  acceptance: number;
  chemistry: number;
  text: string;
}

export const feedbackClamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function feedbackPerformance(feedback?: NextSetFeedback | null): number {
  if (!feedback) return 0;
  return feedbackClamp(
    feedback.confidence * 0.12 +
      feedback.motivation * 0.1 -
      feedback.pressure * 0.2 +
      feedback.aggression * 0.1 -
      feedback.riskTaking * 0.16 +
      feedback.carryBonus,
    -8,
    8,
  );
}

export interface StoredFeedbackForSet {
  id: number;
  afterGameNumber: number;
  targetTeamId: number;
  effects: Array<{
    careerPlayerId: number;
    reaction?: FeedbackReaction | null;
  }>;
}

export function applyNextSetFeedback(
  team: SimpleMatchTeamInput,
  feedbacks: StoredFeedbackForSet[],
  gameNumber: number,
): SimpleMatchTeamInput {
  const effects = feedbacks
    .filter(
      (f) =>
        f.afterGameNumber === gameNumber - 1 && f.targetTeamId === team.teamId,
    )
    .flatMap((f) => f.effects)
    .filter((e) => e.reaction?.version === 1);
  if (!effects.length) return team;
  const ids = new Set(team.players.map((p) => p.careerPlayerId));
  return {
    ...team,
    chemistry: feedbackClamp(
      team.chemistry +
        feedbackClamp(
          effects
            .filter((e) => ids.has(e.careerPlayerId))
            .reduce((sum, e) => sum + e.reaction!.chemistry, 0),
          -5,
          5,
        ),
      0,
      100,
    ),
    players: team.players.map((player) => {
      const own = effects.filter(
        (e) => e.careerPlayerId === player.careerPlayerId,
      );
      if (!own.length) return player;
      const feedback = Object.fromEntries(
        [
          'mental',
          'form',
          'confidence',
          'motivation',
          'pressure',
          'aggression',
          'riskTaking',
          'carryBonus',
        ].map((key) => [
          key,
          feedbackClamp(
            own.reduce(
              (sum, e) => sum + e.reaction![key as keyof NextSetFeedback],
              0,
            ),
            key === 'carryBonus' ? -4 : -20,
            key === 'carryBonus' ? 4 : 20,
          ),
        ]),
      ) as unknown as NextSetFeedback;
      const carryRole =
        player.playerInstruction?.includes('CARRY') ||
        (team.teamStrategy === TeamStrategy.TOP_CARRY &&
          player.position === Position.TOP) ||
        (team.teamStrategy === TeamStrategy.MID_CARRY &&
          player.position === Position.MID) ||
        (team.teamStrategy === TeamStrategy.BOT_CARRY &&
          player.position === Position.ADC);
      if (!carryRole) feedback.carryBonus = 0;
      return { ...player, feedback };
    }),
  };
}
