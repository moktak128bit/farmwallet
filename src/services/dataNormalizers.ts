/**
 * 저장/가져오기 데이터 정규화 — 손상·구버전 타입을 안전하게 복원하는 순수 함수 모음.
 * dataService.loadData()/buildAppDataFromMigrated()에서 사용. 부작용 없음(localStorage 미접근).
 *
 * dataService.ts(god-module)에서 분리 — 순수라 단위 테스트가 용이하고 본체가 가벼워진다.
 */
import type {
  AssetSnapshotAccountBreakdown,
  AssetSnapshotPoint,
  DailyBudgetConfig,
  HistoricalDailyClose,
  HistoricalDailyFx,
  InvestmentGoals,
  MarketEnvSnapshot,
} from "../types";
import { DEFAULT_DAILY_BUDGET } from "../utils/dailyBudget";

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return null;
    const normalized = trimmed.replace(/,/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSnapshotAccountBreakdown(raw: unknown): AssetSnapshotAccountBreakdown[] {
  if (!Array.isArray(raw)) return [];
  const rows: AssetSnapshotAccountBreakdown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const accountId = String(obj.accountId ?? "").trim();
    if (!accountId) continue;
    const accountName = String(obj.accountName ?? accountId).trim() || accountId;
    const buyAmount = toNullableNumber(obj.buyAmount);
    const evaluationAmount = toNullableNumber(obj.evaluationAmount);
    if (buyAmount == null || evaluationAmount == null) continue;
    rows.push({ accountId, accountName, buyAmount, evaluationAmount });
  }
  return rows;
}

export function normalizeAssetSnapshots(raw: unknown): AssetSnapshotPoint[] {
  if (!Array.isArray(raw)) return [];
  const rows: AssetSnapshotPoint[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const dateRaw = String(obj.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) continue;

    rows.push({
      date: dateRaw,
      installmentSavings: toNullableNumber(obj.installmentSavings),
      termDeposit: toNullableNumber(obj.termDeposit),
      pensionPrincipal: toNullableNumber(obj.pensionPrincipal),
      pensionEvaluation: toNullableNumber(obj.pensionEvaluation),
      investmentBuyAmount: toNullableNumber(obj.investmentBuyAmount),
      investmentEvaluationAmount: toNullableNumber(obj.investmentEvaluationAmount),
      cryptoAssets: toNullableNumber(obj.cryptoAssets),
      dividendInterestCumulative: toNullableNumber(obj.dividendInterestCumulative),
      totalAssetBuyAmount: toNullableNumber(obj.totalAssetBuyAmount),
      totalAssetEvaluationAmount: toNullableNumber(obj.totalAssetEvaluationAmount),
      investmentPerformance: toNullableNumber(obj.investmentPerformance),
      accountBreakdown: normalizeSnapshotAccountBreakdown(obj.accountBreakdown)
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export function normalizeMarketEnvSnapshots(raw: unknown): MarketEnvSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const rows: MarketEnvSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const date = String(obj.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const fxRate = toNullableNumber(obj.fxRate);
    if (fxRate == null || fxRate <= 0) continue;
    const pricesRaw = Array.isArray(obj.prices) ? obj.prices : [];
    const prices: MarketEnvSnapshot["prices"] = [];
    for (const p of pricesRaw) {
      if (!p || typeof p !== "object") continue;
      const pr = p as Record<string, unknown>;
      const ticker = String(pr.ticker ?? "").trim();
      const price = toNullableNumber(pr.price);
      if (!ticker || price == null || !Number.isFinite(price)) continue;
      const currency = typeof pr.currency === "string" ? pr.currency : undefined;
      prices.push({ ticker, price, currency });
    }
    const recordedAt = typeof obj.recordedAt === "string" ? obj.recordedAt : new Date().toISOString();
    rows.push({ date, fxRate, prices, recordedAt });
  }
  const dedup = new Map<string, MarketEnvSnapshot>();
  for (const r of rows) {
    const prev = dedup.get(r.date);
    if (!prev || r.recordedAt > prev.recordedAt) dedup.set(r.date, r);
  }
  return Array.from(dedup.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeHistoricalDailyFx(raw: unknown): HistoricalDailyFx[] {
  if (!Array.isArray(raw)) return [];
  const dedup = new Map<string, number>(); // date → rate (날짜당 1건)
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const date = String(obj.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rate = toNullableNumber(obj.rate);
    if (rate == null || rate <= 0) continue;
    dedup.set(date, rate);
  }
  return Array.from(dedup.entries())
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * loadData에서 investmentGoals 필드 누락으로 매번 초기화되던 회귀 방지.
 * 잘못된 타입(문자열로 저장된 숫자, NaN 등)은 해당 필드만 떨궈 부분 복원 가능.
 * 모든 필드가 비어있으면 undefined 반환.
 */
export function normalizeInvestmentGoals(raw: unknown): InvestmentGoals | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: InvestmentGoals = {};
  if (typeof r.annualDepositTarget === "number" && Number.isFinite(r.annualDepositTarget)) {
    out.annualDepositTarget = r.annualDepositTarget;
  }
  if (typeof r.finalTotalAssetTarget === "number" && Number.isFinite(r.finalTotalAssetTarget)) {
    out.finalTotalAssetTarget = r.finalTotalAssetTarget;
  }
  if (typeof r.targetAnnualDividend === "number" && Number.isFinite(r.targetAnnualDividend)) {
    out.targetAnnualDividend = r.targetAnnualDividend;
  } else if (typeof r.targetMonthlyDividend === "number" && Number.isFinite(r.targetMonthlyDividend)) {
    // 마이그레이션: 직전 버전의 월 단위 목표 → 연 환산 (×12)
    out.targetAnnualDividend = r.targetMonthlyDividend * 12;
  }
  if (typeof r.investmentStartDate === "string" && r.investmentStartDate.length > 0) {
    out.investmentStartDate = r.investmentStartDate;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * dailyBudget(하루 예산 설정) 정규화. loadData 필드 누락으로 새로고침마다
 * 설정이 유실되던 회귀 방지 (investmentGoals와 동일 패턴).
 * dailyLimit이 유효 숫자가 아니면 설정 전체를 미설정으로 처리.
 */
export function normalizeDailyBudget(raw: unknown): DailyBudgetConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.dailyLimit !== "number" || !Number.isFinite(r.dailyLimit) || r.dailyLimit <= 0) return undefined;
  return {
    enabled: r.enabled === true,
    dailyLimit: r.dailyLimit,
    mode: r.mode === "weekly" ? "weekly" : "daily",
    excludedCategories: Array.isArray(r.excludedCategories)
      ? r.excludedCategories.map((v) => String(v))
      : [...DEFAULT_DAILY_BUDGET.excludedCategories],
    excludedSubCategories: Array.isArray(r.excludedSubCategories)
      ? r.excludedSubCategories.map((v) => String(v))
      : [...DEFAULT_DAILY_BUDGET.excludedSubCategories],
    warnOnExceed: r.warnOnExceed !== false
  };
}

export function normalizeHistoricalDailyCloses(raw: unknown): HistoricalDailyClose[] {
  if (!Array.isArray(raw)) return [];
  const rows: HistoricalDailyClose[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const ticker = String(obj.ticker ?? "").trim();
    const date = String(obj.date ?? "").trim();
    const close = toNullableNumber(obj.close);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null || !Number.isFinite(close)) continue;
    rows.push({
      ticker: ticker.toUpperCase(),
      date,
      close,
      currency: typeof obj.currency === "string" ? obj.currency : undefined
    });
  }
  return rows;
}
