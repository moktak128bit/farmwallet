import type { CategoryPresets, LedgerEntry, RecurringExpense } from "../types";
import { parseIsoLocal } from "./date";
import { classifyLedgerFlow, toKrwAmount } from "../features/dashboard/summaryMath";
import { expenseMainName } from "./categoryMerge";

/**
 * 예측 집계 옵션 — 대시보드 지출 정의(classifyLedgerFlow + toKrwAmount)와 동일한 입력.
 * - fxRate: USD 항목 원화 환산 환율 (null/미지정이면 액면 그대로 — 대시보드 공통 정책)
 * - categoryPresets: 저축성지출(재테크) 판정용 사용자 프리셋
 */
interface ForecastOptions {
  fxRate?: number | null;
  categoryPresets?: CategoryPresets;
}

/** 실질 소비 지출인지 — 대시보드 단일 분류(classifyLedgerFlow==="expense")에 위임 */
const isRealExpense = (e: LedgerEntry, opts?: ForecastOptions): boolean =>
  e.kind === "expense" && e.amount > 0 && !!e.date && classifyLedgerFlow(e, opts?.categoryPresets) === "expense";

interface CategoryForecast {
  category: string;
  recurringAmount: number;
  variableAverage: number;
  forecast: number;
  lower: number;
  upper: number;
  basedOnMonths: number;
}

interface ForecastResult {
  totalForecast: number;
  totalLower: number;
  totalUpper: number;
  byCategory: CategoryForecast[];
  baseMonth: string;
  forecastMonth: string;
}

const yyyymmOf = (iso: string) => iso.slice(0, 7);

/**
 * 특정 월(YYYY-MM)의 expenseMainName별 실제 소비 합계(KRW 환산).
 * forecastNextMonth의 버킷/제외 기준(대시보드 classifyLedgerFlow==="expense" — 신용결제·재테크·환전·투자손익 제외,
 * 대분류=expenseMainName, USD는 toKrwAmount 환산)과 동일하게 계산 —
 * ForecastView '현재월 실적'이 예측과 같은 키·금액 기준을 쓰도록 단일소스.
 */
export function expenseMainTotalsForMonth(
  ledger: LedgerEntry[],
  monthPrefix: string,
  opts?: ForecastOptions
): Map<string, number> {
  const map = new Map<string, number>();
  const fxRate = opts?.fxRate ?? null;
  for (const e of ledger) {
    if (!isRealExpense(e, opts)) continue;
    if (!e.date.startsWith(monthPrefix)) continue;
    const cat = expenseMainName(e);
    if (!cat) continue;
    map.set(cat, (map.get(cat) ?? 0) + toKrwAmount(e, fxRate));
  }
  return map;
}

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
 * 매주 반복지출이 특정 월("YYYY-MM")에 몇 번 발생하는지 계산.
 * startDate의 요일 기준 7일 간격, 시작일 이전·종료일 이후는 제외.
 */
function countWeeklyOccurrencesInMonth(r: RecurringExpense, month: string): number {
  const start = parseIsoLocal(r.startDate);
  if (!start) return 0;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return 0;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  const end = r.endDate ? parseIsoLocal(r.endDate) : null;
  if (start > monthEnd) return 0;
  // 시작일이 월 시작 이전이면 같은 요일을 유지한 채 월 안쪽 첫 발생일로 당김
  const cursor = new Date(start);
  if (cursor < monthStart) {
    const diffDays = Math.ceil((monthStart.getTime() - cursor.getTime()) / 86400000);
    cursor.setDate(cursor.getDate() + Math.ceil(diffDays / 7) * 7);
  }
  let count = 0;
  while (cursor <= monthEnd) {
    if (!end || cursor <= end) count++;
    cursor.setDate(cursor.getDate() + 7);
  }
  return count;
}

/**
 * 다음 달 카테고리별 지출 예측.
 * - 반복지출(recurring) 합계 + 비반복 N개월 이동평균
 * - lookback은 진행 중인 현재 월을 제외한 "완결된 과거 N개월"만 사용
 *   (현재 월을 포함하면 월초마다 평균이 체계적으로 과소 추정됨 — anomaly.ts와 동일 기준)
 * - 신뢰구간(±1σ) 함께 제공
 * - 지출 판정·금액은 대시보드와 동일 (classifyLedgerFlow==="expense" + toKrwAmount USD 환산)
 */
export function forecastNextMonth(
  ledger: LedgerEntry[],
  recurring: RecurringExpense[],
  currentMonth: string,
  lookbackMonths = 6,
  opts?: ForecastOptions
): ForecastResult {
  const forecastMonth = offsetMonth(currentMonth, 1);
  const fxRate = opts?.fxRate ?? null;

  const monthSet = new Set<string>();
  const monthOrder: string[] = [];
  for (let i = 1; i <= lookbackMonths; i++) {
    const mm = offsetMonth(currentMonth, -i); // 현재 월 제외 — 직전 월부터 N개월
    monthSet.add(mm);
    monthOrder.push(mm);
  }

  const recurringByCat = new Map<string, number>();
  for (const r of recurring) {
    if (!r.category) continue;
    if (r.frequency === "monthly") {
      recurringByCat.set(r.category, (recurringByCat.get(r.category) ?? 0) + r.amount);
    } else if (r.frequency === "weekly") {
      // 매주 반복은 예측 월의 실제 발생 횟수로 월 환산해 고정 지출에 포함
      const n = countWeeklyOccurrencesInMonth(r, forecastMonth);
      if (n > 0) recurringByCat.set(r.category, (recurringByCat.get(r.category) ?? 0) + r.amount * n);
    }
    // yearly는 발생 월에만 의미가 있어 월 예측의 "고정" 합에는 포함하지 않음
  }

  const byCatMonth = new Map<string, Map<string, number>>();
  for (const e of ledger) {
    // 실제 소비만 — 신용결제(이중계상)·재테크(저축/투자)·환전(계좌이동)·투자손익은 대시보드 단일 분류로 제외
    if (!isRealExpense(e, opts)) continue;
    // 대분류는 expenseMainName 단일소스 — 현행 스키마(category="지출")가 한 버킷으로 뭉쳐 카테고리 예측이 무의미해지는 것 방지
    const cat = expenseMainName(e);
    if (!cat) continue;
    const ym = yyyymmOf(e.date);
    if (!monthSet.has(ym)) continue;
    let slot = byCatMonth.get(cat);
    if (!slot) {
      slot = new Map();
      byCatMonth.set(cat, slot);
    }
    slot.set(ym, (slot.get(ym) ?? 0) + toKrwAmount(e, fxRate));
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
