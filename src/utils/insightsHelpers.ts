import type { LedgerEntry } from "../types";

/**
 * 월별 합계 배열에서 trend 요약 계산.
 * - monthTrend: 최근 두 달 비교 (up/down/flat)
 * - mom: 전월 대비 증감률 (%)
 * - nonZero: 0보다 큰 월 수
 * - monthAvg: 0 제외 월평균
 */
export function calcTrend(mt: number[]): {
  monthTrend: "up" | "down" | "flat";
  mom: number;
  nonZero: number[];
  monthAvg: number;
} {
  const nz = mt.filter((v) => v > 0);
  const l2 = mt.slice(-2);
  const mom =
    l2.length === 2 && l2[0] > 0 ? Math.round(((l2[1] - l2[0]) / l2[0]) * 100) : 0;
  const tr: "up" | "down" | "flat" = mom > 10 ? "up" : mom < -10 ? "down" : "flat";
  const avg =
    nz.length > 0 ? Math.round(nz.reduce((a, b) => a + b, 0) / nz.length) : 0;
  return { monthTrend: tr, mom, nonZero: nz, monthAvg: avg };
}

/**
 * 주어진 months("YYYY-MM") 배열에 대해 ledger에서 match를 만족하는 항목의 월별 합계 반환.
 */
export function mTotalsFor(
  months: string[],
  ledger: LedgerEntry[],
  match: (l: LedgerEntry) => boolean
): number[] {
  return months.map((m) => {
    let t = 0;
    for (const l of ledger) {
      if (l.date?.slice(0, 7) !== m || !match(l)) continue;
      t += Number(l.amount);
    }
    return t;
  });
}
