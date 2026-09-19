/** All API money values are integer ten-thousand KRW, never floating-point 억. */
export function formatMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return "금액을 확인해 주세요";
  const eok = Math.floor(value / 10000);
  const man = value % 10000;
  if (!eok) return `${man.toLocaleString("ko-KR")}만원`;
  return `${eok.toLocaleString("ko-KR")}억${man ? ` ${man.toLocaleString("ko-KR")}만원` : "원"}`;
}

export const DEFAULT_ANNUAL_SALARY = 10000;
