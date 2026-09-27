import type { DraftVariant } from "./draft-preview";

type ProfileTone = "strength" | "balanced" | "weakness";
export interface VariantDescription {
  short: string;
  summary: string;
  timing: string;
  timingDetail: string;
  traits: { label: string; value: number; detail: string; tone: ProfileTone }[];
}

// Public 0–100 variant profile only. These bands describe attributes, not win
// probability, player proficiency, abilities, or an automatic ban recommendation.
const band = (value: number) =>
  value >= 80 ? "강함" : value < 70 ? "약함" : "무난";
const phrase = (value: number) =>
  value >= 80 ? "강한" : value < 70 ? "약한" : "무난한";

export function describeVariant(variant: DraftVariant): VariantDescription {
  const lane = band(variant.lanePower);
  const fight = band(variant.teamFight);
  const laneLabel = variant.position === "JUNGLE" ? "라인 압박" : "라인전";
  const laneWord = { 강함: "강", 약함: "약", 무난: "무난" }[lane];
  const opposite =
    (lane === "강함" && fight === "약함") ||
    (lane === "약함" && fight === "강함");
  const summary =
    lane === fight
      ? `${laneLabel}과 한타가 모두 ${phrase(variant.lanePower)} 유형입니다.`
      : `${laneLabel}은 ${laneWord}${opposite ? "하지만" : "하고"}, 한타는 ${phrase(variant.teamFight)} 유형입니다.`;
  const phases = [
    { label: "초반", value: variant.early },
    { label: "중반", value: variant.mid },
    { label: "후반", value: variant.late },
  ];
  const high = Math.max(...phases.map((p) => p.value));
  const low = Math.min(...phases.map((p) => p.value));
  const peaks = phases.filter((p) => high - p.value <= 5).map((p) => p.label);
  const timing =
    high - low < 12 ? "고른 시간대 성능" : `${peaks.join("·")} 중심`;
  let timingDetail =
    high - low < 12
      ? "초반부터 후반까지 성능 편차가 작습니다."
      : `${peaks.join("·")}에 상대적으로 힘이 실립니다.`;
  if (variant.early - variant.late >= 20)
    timingDetail += " 후반에는 초반보다 힘이 떨어집니다.";
  else if (variant.late - variant.early >= 20)
    timingDetail += " 초반보다 후반을 바라보는 선택입니다.";
  const trait = (label: string, value: number) => ({
    label,
    value,
    detail: value >= 80 ? "강점" : value < 40 ? "약점" : "보통",
    tone: (value >= 80
      ? "strength"
      : value < 40
        ? "weakness"
        : "balanced") as ProfileTone,
  });
  return {
    short: `${laneLabel} ${lane} · 한타 ${fight}`,
    summary,
    timing,
    timingDetail,
    traits: [
      {
        label: "사거리",
        value: variant.range,
        detail:
          variant.range >= 75
            ? "장거리"
            : variant.range < 40
              ? "근거리"
              : "중거리",
        tone: "balanced",
      },
      trait("교전 개시", variant.engage),
      trait("전방 유지력", variant.frontline),
    ],
  };
}
