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
 * 양 끝 trimRatio(0~0.5)를 잘라낸 평균. 길이가 짧으면 단순 평균으로 fallback.
 * 예: 의료비 1회 큰 값이 평균을 끌어올리는 것을 방지.
 */
function trimmedMean(values: number[], trimRatio = 0.1): number {
  if (values.length === 0) return 0;
  if (values.length < 5) {
    return values.reduce((s, v) => s + v, 0) / values.length;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * trimRatio);
  const sliced = sorted.slice(trim, sorted.length - trim);
  if (sliced.length === 0) return sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return sliced.reduce((s, v) => s + v, 0) / sliced.length;
}

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
    // 단순 평균 대신 양 끝 10% trim — 의료비·여행 같은 일회성 큰 지출이 추세를 왜곡하는 것 방지.
    // 표본이 5개 미만이면 단순 평균으로 fallback (trimmedMean이 처리).
    const variableAvg = trimmedMean(monthlySums, 0.1);
    const variance = monthlySums.length === 0
      ? 0
      : monthlySums.reduce((s, v) => s + (v - variableAvg) ** 2, 0) / monthlySums.length;
    // 부동소수점 오차로 음수가 나올 수 있어 0으로 클램프 후 sqrt
    const std = Math.sqrt(Math.max(0, variance));

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
