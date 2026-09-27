import { PlayerPersonality as P } from '../players/enums/player-personality.enum';
import { FeedbackOption as O } from './enums/feedback-option.enum';
import {
  calculateFeedbackPlayerEffect,
  FeedbackPlayerState,
} from './feedback-effect';
import { feedbackClamp as clamp, FeedbackReaction } from './next-set-feedback';

// Acceptance is personality-derived, not a new seed stat or a synonym for trust.
const ACCEPTANCE = {
  [P.DEVOTED]: 85,
  [P.LOYAL]: 75,
  [P.SELF_CENTERED]: 40,
  [P.PROFESSIONAL]: 95,
  [P.SENSITIVE]: 55,
};

export function calculateFeedbackReaction(
  state: FeedbackPlayerState,
  option: O,
  context: { won: boolean; rating: number; teamAverageRating: number },
) {
  const effect = calculateFeedbackPlayerEffect(state, option);
  const acceptance = Math.round(
    clamp(
      ACCEPTANCE[state.personality] + (state.coachTrust - 50) * 0.3,
      0,
      100,
    ),
  );
  const pressureProne = state.personality === P.SENSITIVE || state.mental < 55;
  const harsh = [O.BLAME_PLAYER, O.DISAPPOINTED_TEAM, O.ABUSIVE_TEAM].includes(
    option,
  );
  const justified =
    !context.won ||
    context.rating < 6.5 ||
    context.rating < context.teamAverageRating - 0.6;
  const reaction: FeedbackReaction = {
    version: 1,
    acceptance,
    mental: effect.mentalDelta,
    form: effect.formDelta,
    confidence: 2,
    motivation: 1,
    pressure: 0,
    aggression: 0,
    riskTaking: 0,
    carryBonus: 0,
    chemistry: 0,
    text: '감독의 말을 받아들이며 다음 세트를 준비합니다.',
  };
  let trust = effect.coachTrustDelta;
  if ([O.TRUST_PLAYER, O.PRAISE_TEAM].includes(option)) {
    if (!justified && context.rating >= 7.5) {
      reaction.confidence = 5;
      reaction.text = '직전 활약을 인정받아 자신감이 올랐습니다.';
    } else if (
      state.coachTrust < 35 ||
      (justified && state.personality === P.PROFESSIONAL)
    ) {
      reaction.confidence = -1;
      reaction.mental = 0;
      reaction.form = 0;
      reaction.text = '경기 내용과 맞지 않는 칭찬을 납득하지 못했습니다.';
    }
    if (state.form >= 80 && state.personality === P.SELF_CENTERED) {
      reaction.riskTaking = 8;
      reaction.text = '칭찬에 자신감이 넘쳐 무리한 플레이 위험도 커졌습니다.';
    }
  }
  if (option === O.DEMAND_CARRY) {
    if (pressureProne || state.coachTrust < 35) {
      reaction.mental = -4;
      reaction.form = -2;
      reaction.pressure = 10;
      reaction.confidence = -3;
      reaction.carryBonus = -2;
      reaction.text = '캐리 책임을 부담으로 받아들였습니다.';
    } else {
      reaction.confidence = 7;
      reaction.motivation = 5;
      reaction.carryBonus = 2;
      reaction.text =
        '기대를 동력으로 삼습니다. 캐리 역할을 맡기면 보정이 적용됩니다.';
    }
  }
  if (option === O.RELIEVE_PRESSURE || option === O.REFOCUS_TEAM) {
    reaction.pressure = -5;
    reaction.confidence = 3;
    reaction.text = '부담이 줄어 침착하게 다음 세트를 준비합니다.';
    if (state.personality === P.SELF_CENTERED && state.form >= 75) {
      reaction.motivation = -4;
      reaction.aggression = -4;
      reaction.text = '소극적인 주문으로 느껴 승부욕이 약해졌습니다.';
    }
  }
  if (option === O.DEMAND_AGGRESSION) {
    const overreach =
      state.personality === P.SELF_CENTERED ||
      state.personality === P.SENSITIVE ||
      state.mental < 60;
    reaction.aggression = 8;
    reaction.riskTaking = overreach ? 12 : 3;
    reaction.confidence = 1;
    reaction.form = overreach ? -1 : 1;
    reaction.text = overreach
      ? '공격적인 주문을 과하게 받아들여 무리한 진입 위험이 커졌습니다.'
      : '평소보다 적극적으로 기회를 노립니다. 교전과 데스 위험이 함께 증가합니다.';
  }
  if (option === O.WAKE_UP_TEAM) {
    const responds =
      acceptance >= 65 && state.coachTrust >= 50 && !pressureProne;
    reaction.mental = responds ? 2 : -3;
    reaction.form = responds ? 1 : -1;
    reaction.motivation = responds ? 5 : -2;
    reaction.pressure = responds ? 0 : 5;
    reaction.text = responds
      ? '지적을 받아들여 집중력을 끌어올립니다.'
      : '지적에 위축되어 부담이 커졌습니다.';
  }
  if (harsh) {
    reaction.confidence = -3;
    reaction.motivation = -2;
    reaction.pressure = 4;
    if (state.personality === P.PROFESSIONAL) {
      reaction.mental = -1;
      reaction.form = 0;
      reaction.confidence = 0;
      reaction.motivation = 0;
      reaction.pressure = 0;
      reaction.text = '말투는 불쾌하지만 경기와 감정을 분리합니다.';
    } else if (state.personality === P.SENSITIVE) {
      reaction.mental = option === O.ABUSIVE_TEAM ? -10 : -6;
      reaction.form = -3;
      reaction.pressure = 10;
      reaction.text = '질책에 크게 위축되어 다음 플레이를 두려워합니다.';
    } else if (state.mental >= 85 && state.coachTrust >= 60 && justified) {
      reaction.mental = 2;
      reaction.form = 1;
      reaction.motivation = 8;
      reaction.confidence = 2;
      reaction.pressure = 1;
      reaction.text =
        '자존심이 자극되었습니다. 다음 세트에서 보여주겠다고 다짐합니다.';
    } else if (state.personality === P.SELF_CENTERED) {
      trust = option === O.ABUSIVE_TEAM ? -12 : -8;
      reaction.motivation = -4;
      reaction.text =
        option === O.BLAME_PLAYER
          ? '개인적인 비난으로 받아들여 감독에게 반감을 느낍니다.'
          : '공개적인 비난으로 받아들여 감독에게 반감을 느낍니다.';
    }
    if (state.personality === P.DEVOTED && option !== O.BLAME_PLAYER) {
      reaction.chemistry = -2;
      reaction.text += ' 팀 분위기가 가라앉은 것도 신경 쓰입니다.';
    }
    if (!justified) {
      trust -= 2;
      reaction.pressure += 2;
    }
  }
  const mentalAfter = clamp(state.mental + reaction.mental, 0, 119);
  const formAfter = clamp(state.form + reaction.form, 0, 100);
  reaction.mental = mentalAfter - state.mental;
  reaction.form = formAfter - state.form;
  return {
    ...effect,
    mentalAfter,
    mentalDelta: reaction.mental,
    formAfter,
    formDelta: reaction.form,
    coachTrustAfter: clamp(state.coachTrust + trust, 0, 100),
    coachTrustDelta: clamp(state.coachTrust + trust, 0, 100) - state.coachTrust,
    reaction,
  };
}
