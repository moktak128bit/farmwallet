import type { LedgerEntry } from "../types";

export interface MonthComparison {
  current: number;
  previousMonth: number;
  previousYearSameMonth: number;
  diffPrevMonth: number;
  diffPrevYear: number;
  diffPrevMonthPct: number;
  diffPrevYearPct: number;
}

const offsetMonth = (yyyymm: string, deltaMonths: number) => {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function compareMonths(
  ledger: LedgerEntry[],
  currentMonth: string,
  kind: "expense" | "income" = "expense"
): MonthComparison {
  const prevMonthKey = offsetMonth(currentMonth, -1);
  const prevYearKey = offsetMonth(currentMonth, -12);
  let current = 0, prevMonth = 0, prevYear = 0;
  for (const e of ledger) {
    if (e.kind !== kind || !e.date) continue;
    const ym = e.date.slice(0, 7);
    if (ym === currentMonth) current += e.amount;
    else if (ym === prevMonthKey) prevMonth += e.amount;
    else if (ym === prevYearKey) prevYear += e.amount;
  }

  return {
    current,
    previousMonth: prevMonth,
    previousYearSameMonth: prevYear,
    diffPrevMonth: current - prevMonth,
    diffPrevYear: current - prevYear,
    diffPrevMonthPct: prevMonth === 0 ? 0 : ((current - prevMonth) / prevMonth) * 100,
    diffPrevYearPct: prevYear === 0 ? 0 : ((current - prevYear) / prevYear) * 100
  };
}
