import type { LedgerEntry, RecurringExpense } from "../types";

export interface CategoryForecast {
  category: string;
  recurringAmount: number;
  variableAverage: number;
  forecast: number;
  lower: number;
  upper: number;
  basedOnMonths: number;
}

export interface ForecastResult {
  totalForecast: number;
  totalLower: number;
  totalUpper: number;
  byCategory: CategoryForecast[];
  baseMonth: string;
  forecastMonth: string;
}

const yyyymmOf = (iso: string) => iso.slice(0, 7);

const offsetMonth = (yyyymm: string, deltaMonths: number) => {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * 다음 달 카테고리별 지출 예측.
 * - 반복지출(recurring) 합계 + 비반복 6개월 이동평균
 * - 신뢰구간(±1σ) 함께 제공
 */
export function forecastNextMonth(
  ledger: LedgerEntry[],
  recurring: RecurringExpense[],
  currentMonth: string,
  lookbackMonths = 6
): ForecastResult {
  const forecastMonth = offsetMonth(currentMonth, 1);

  const monthSet = new Set<string>();
  const monthOrder: string[] = [];
  for (let i = 1; i <= lookbackMonths; i++) {
    const mm = offsetMonth(currentMonth, -i + 1);
    monthSet.add(mm);
    monthOrder.push(mm);
  }

  const recurringByCat = new Map<string, number>();
  for (const r of recurring) {
    if (!r.category || r.frequency !== "monthly") continue;
    recurringByCat.set(r.category, (recurringByCat.get(r.category) ?? 0) + r.amount);
  }

  const byCatMonth = new Map<string, Map<string, number>>();
  for (const e of ledger) {
    if (e.kind !== "expense" || e.amount <= 0 || !e.category || !e.date) continue;
    const ym = yyyymmOf(e.date);
    if (!monthSet.has(ym)) continue;
    let slot = byCatMonth.get(e.category);
    if (!slot) {
      slot = new Map();
      byCatMonth.set(e.category, slot);
    }
    slot.set(ym, (slot.get(ym) ?? 0) + e.amount);
  }

  const categories = new Set<string>([...byCatMonth.keys(), ...recurringByCat.keys()]);
  const byCategory: CategoryForecast[] = [];

  categories.forEach((cat) => {
    const recurringSum = recurringByCat.get(cat) ?? 0;
    const perMonth = byCatMonth.get(cat);
    const monthlySums = monthOrder.map((mm) => perMonth?.get(mm) ?? 0);
    const variableAvg = monthlySums.length === 0
      ? 0
      : monthlySums.reduce((s, v) => s + v, 0) / monthlySums.length;
    const variance = monthlySums.length === 0
      ? 0
      : monthlySums.reduce((s, v) => s + (v - variableAvg) ** 2, 0) / monthlySums.length;
    const std = Math.sqrt(variance);

    const forecast = Math.max(recurringSum, variableAvg);
    byCategory.push({
      category: cat,
      recurringAmount: recurringSum,
      variableAverage: variableAvg,
      forecast,
      lower: Math.max(0, forecast - std),
      upper: forecast + std,
      basedOnMonths: monthlySums.length
    });
  });

  byCategory.sort((a, b) => b.forecast - a.forecast);

  const totalForecast = byCategory.reduce((s, c) => s + c.forecast, 0);
  const totalLower = byCategory.reduce((s, c) => s + c.lower, 0);
  const totalUpper = byCategory.reduce((s, c) => s + c.upper, 0);

  return {
    totalForecast,
    totalLower,
    totalUpper,
    byCategory,
    baseMonth: currentMonth,
    forecastMonth
  };
}
