import type { LedgerEntry } from "../types";

export interface AnomalyResult {
  category: string;
  currentMonthAmount: number;
  averageAmount: number;
  stdDev: number;
  zScore: number;
  percentChange: number;
  isAnomaly: boolean;
  severity: "normal" | "elevated" | "extreme";
}

const yyyymmOf = (iso: string) => iso.slice(0, 7);

/**
 * 최근 N개월 (현재월 제외) 평균과 표준편차를 기준으로
 * 현재월 카테고리별 지출의 z-score를 계산해 이상치를 표시한다.
 */
export function detectSpendAnomalies(
  ledger: LedgerEntry[],
  currentMonth: string,
  lookbackMonths = 6
): AnomalyResult[] {
  const months = new Set<string>();
  const [y, m] = currentMonth.split("-").map(Number);
  for (let i = 1; i <= lookbackMonths; i++) {
    const d = new Date(y, m - 1 - i, 1);
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const byCat = new Map<string, { monthly: Map<string, number>; current: number }>();
  for (const e of ledger) {
    if (e.kind !== "expense" || e.amount <= 0 || !e.category || !e.date) continue;
    const ym = yyyymmOf(e.date);
    const isCurrent = ym === currentMonth;
    const isLookback = months.has(ym);
    if (!isCurrent && !isLookback) continue;
    let slot = byCat.get(e.category);
    if (!slot) {
      slot = { monthly: new Map(), current: 0 };
      byCat.set(e.category, slot);
    }
    if (isCurrent) slot.current += e.amount;
    if (isLookback) slot.monthly.set(ym, (slot.monthly.get(ym) ?? 0) + e.amount);
  }

  const results: AnomalyResult[] = [];
  byCat.forEach(({ monthly, current }, cat) => {
    const validSums = Array.from(monthly.values()).filter((s) => s > 0);
    if (validSums.length < 2) return;
    const mean = validSums.reduce((s, v) => s + v, 0) / validSums.length;
    const variance = validSums.reduce((s, v) => s + (v - mean) ** 2, 0) / validSums.length;
    const stdDev = Math.sqrt(variance);
    const z = stdDev === 0 ? 0 : (current - mean) / stdDev;
    const pct = mean === 0 ? 0 : ((current - mean) / mean) * 100;

    let severity: AnomalyResult["severity"] = "normal";
    if (z >= 3) severity = "extreme";
    else if (z >= 2) severity = "elevated";

    results.push({
      category: cat,
      currentMonthAmount: current,
      averageAmount: mean,
      stdDev,
      zScore: z,
      percentChange: pct,
      isAnomaly: severity !== "normal",
      severity
    });
  });

  return results.sort((a, b) => b.zScore - a.zScore);
}
