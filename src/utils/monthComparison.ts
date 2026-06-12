import type { CategoryPresets, LedgerEntry } from "../types";
import { classifyLedgerFlow, toKrwAmount } from "../features/dashboard/summaryMath";

export interface MonthComparison {
  current: number;
  previousMonth: number;
  previousYearSameMonth: number;
  diffPrevMonth: number;
  diffPrevYear: number;
  /** 비교 기준(전월/전년 동월)이 0이고 현재 > 0이면 null — UI에서 "신규"로 표시 */
  diffPrevMonthPct: number | null;
  diffPrevYearPct: number | null;
}

const offsetMonth = (yyyymm: string, deltaMonths: number) => {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** 기준이 0이면: 현재도 0 → 0%, 현재 > 0 → null ("▲ 0.0%" 같은 모순 표시 방지) */
const pctOrNull = (current: number, base: number): number | null => {
  if (base === 0) return current === 0 ? 0 : null;
  return ((current - base) / base) * 100;
};

/**
 * 전월·전년 동월 비교 — summaryMath와 동일 분류 기준 사용:
 * 신용결제 제외(이중계상 방지), 레거시 저축성지출은 재테크로 분리(지출 비교에서 제외),
 * USD 항목은 fxRate로 원화 환산.
 */
export function compareMonths(
  ledger: LedgerEntry[],
  currentMonth: string,
  kind: "expense" | "income" = "expense",
  fxRate: number | null = null,
  categoryPresets?: CategoryPresets
): MonthComparison {
  const prevMonthKey = offsetMonth(currentMonth, -1);
  const prevYearKey = offsetMonth(currentMonth, -12);
  let current = 0, prevMonth = 0, prevYear = 0;
  for (const e of ledger) {
    if (!e.date) continue;
    if (classifyLedgerFlow(e, categoryPresets) !== kind) continue;
    const ym = e.date.slice(0, 7);
    if (ym !== currentMonth && ym !== prevMonthKey && ym !== prevYearKey) continue;
    const amt = toKrwAmount(e, fxRate);
    if (ym === currentMonth) current += amt;
    else if (ym === prevMonthKey) prevMonth += amt;
    else prevYear += amt;
  }

  return {
    current,
    previousMonth: prevMonth,
    previousYearSameMonth: prevYear,
    diffPrevMonth: current - prevMonth,
    diffPrevYear: current - prevYear,
    diffPrevMonthPct: pctOrNull(current, prevMonth),
    diffPrevYearPct: pctOrNull(current, prevYear)
  };
}
