import type { LedgerEntry } from "../types";
import { isDividendEntry, isInterestEntry } from "./categoryMatch";
import { addDaysToIso, getMonthEndDate, parseIsoLocal } from "./date";
import { toKrwByRate } from "./currency";
import type { ForwardDividendMonth } from "./forwardDividends";

/** 한국 분리과세 배당·이자소득세율 (소득세 14% + 지방세 1.4%) */
export const SEPARATE_TAX_RATE = 0.154;

/** 종합과세 전환 기준 (배당+이자 합계, 원) */
export const COMPREHENSIVE_TAX_THRESHOLD = 20_000_000;

/** 해외(USD) 배당 원천징수율 — 미국 주식 배당은 현지에서 15% 원천징수 후 입금 */
export const US_DIVIDEND_WITHHOLDING_RATE = 0.15;

/** 세금 계산 옵션 */
interface TaxComputeOptions {
  /**
   * 세전(gross-up) 환산. 가계부 amount는 원천징수 후 입금액일 가능성이 높은데, 종합과세 임계(2,000만원)
   * 판단 기준은 세전이라 그대로 쓰면 실제보다 ~15% 낮게 나와 경고가 늦게 뜬다.
   * true면 항목별로 역산: USD 배당 ÷(1−0.15), 그 외(국내 배당·이자, USD 이자) ÷(1−0.154).
   * 기본 false = 기존 동작(입력 금액 그대로) 100% 유지.
   */
  grossUp?: boolean;
  /**
   * 임계 합산에서 제외할 수령 계좌 id(절세계좌 — ISA·연금저축·IRP, 4-1). 이 계좌(toAccountId)로 들어온
   * 배당·이자는 금융소득 종합과세 2,000만 합산 대상이 아니므로 빼고, 뺀 금액은 excludedKRW로 노출한다.
   * 미지정이면 기존 동작(전부 합산) 100% 유지.
   */
  excludeAccountIds?: ReadonlySet<string> | readonly string[];
  /**
   * 선행배당(utils/forwardDividends.buildForwardDividends().months) — 4-6. 주어지면 트래커의 연말 예상을
   * "YTD + 남은 달(다음 달~12월) 예상 배당 + 이자는 기존 일 페이스"로, 임계 도달 예상일을 "누적이 임계를
   * 넘는 첫 달의 말일"로 계산한다. 미지정이면 기존 선형 페이스(ytd÷경과일×연간일수) 100% 유지.
   * 이번 달 잔여분(오늘~말일)은 months에 없으므로(다음 달부터 시작) 포함되지 않는다 — 보수적.
   */
  forwardMonths?: readonly ForwardDividendMonth[];
}

function toExcludeSet(v: TaxComputeOptions["excludeAccountIds"]): ReadonlySet<string> | null {
  if (!v) return null;
  const set = v instanceof Set ? (v as ReadonlySet<string>) : new Set(v as readonly string[]);
  return set.size > 0 ? set : null;
}

/**
 * 항목 1건의 과세표준 기여분 계산. grossUp이면 원천징수 전 역산(세전 환산), 아니면 입력 금액(원화 환산)을 그대로 쓴다.
 * USD 이자도 국내 금융사 달러 RP·외화예금 등에서 15.4% 원천징수하는 경우가 대부분이라 국내율을 적용한다.
 * LedgerEntry에는 종목 정보가 없으므로 해외 판정은 currency==="USD"(배당)만으로 한다.
 */
function taxableKrw(e: LedgerEntry, fxRate: number | null | undefined, grossUp: boolean, isDividend: boolean): number {
  const krw = toKrwByRate(e.amount, e.currency, fxRate);
  if (!grossUp) return krw;
  const rate = isDividend && e.currency === "USD" ? US_DIVIDEND_WITHHOLDING_RATE : SEPARATE_TAX_RATE;
  return krw / (1 - rate);
}

export interface TaxYearSummary {
  year: number;
  dividendGross: number;
  interestGross: number;
  totalGross: number;
  separateTax: number;
  netIncome: number;
  exceedsThreshold: boolean;
  amountOverThreshold: number;
  estimatedAdditionalTaxIfComprehensive: number;
  /** 세전 환산(grossUp) 적용 여부 */
  grossUpApplied: boolean;
  /** 입력 금액(세후 입금액 기준) 합계 — 세전 환산 전(원) */
  netTotal: number;
  /** 과세표준으로 쓰는 합계 — 세전 환산 후(원). grossUp=false면 netTotal과 같다 */
  grossTotal: number;
  /** 절세계좌(excludeAccountIds) 수령분이라 임계 합산에서 뺀 금액(원, 과세표준 기준). 옵션 미지정이면 0 */
  excludedKRW: number;
}

/**
 * 가계부 항목 중 카테고리가 "배당" 또는 "이자"를 포함하는 수입 합계 기준으로
 * 한국 세법에 따른 분리과세/종합과세 시뮬레이션을 수행한다.
 *
 * 가계부 amount는 세후 입금액일 가능성이 높지만(은행 자동 차감), 본 계산은
 * 사용자가 입력한 금액을 grossTaxable로 가정하고 표시한다.
 */
export function summarizeTaxYear(
  ledger: LedgerEntry[],
  year: number,
  fxRate?: number | null,
  options?: TaxComputeOptions
): TaxYearSummary {
  const yearStr = String(year);
  const grossUp = options?.grossUp === true;
  const exclude = toExcludeSet(options?.excludeAccountIds);
  // USD 배당/이자는 원화로 환산해야 과세표준이 맞다 (환율 미로드 시 액면 폴백 — 합산 정책 일관)
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);

  let dividendGross = 0;
  let interestGross = 0;
  let netTotal = 0;
  let excludedKRW = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date?.startsWith(yearStr)) continue;
    const isDiv = isDividendEntry(e);
    if (!isDiv && !isInterestEntry(e)) continue;
    if (exclude && e.toAccountId && exclude.has(e.toAccountId)) {
      excludedKRW += taxableKrw(e, fxRate, grossUp, isDiv);
      continue;
    }
    if (isDiv) { dividendGross += taxableKrw(e, fxRate, grossUp, true); netTotal += toKrw(e); continue; }
    interestGross += taxableKrw(e, fxRate, grossUp, false); netTotal += toKrw(e);
  }

  const totalGross = dividendGross + interestGross;
  const separateTax = totalGross * SEPARATE_TAX_RATE;
  const netIncome = totalGross - separateTax;

  const exceedsThreshold = totalGross > COMPREHENSIVE_TAX_THRESHOLD;
  const amountOverThreshold = Math.max(0, totalGross - COMPREHENSIVE_TAX_THRESHOLD);

  // 종합과세 누진세율(개략): 초과분에 24% 적용 가정 (1.5억 이하 구간)
  const estimatedAdditionalTaxIfComprehensive = exceedsThreshold
    ? amountOverThreshold * (0.24 - SEPARATE_TAX_RATE)
    : 0;

  return {
    year,
    dividendGross,
    interestGross,
    totalGross,
    separateTax,
    netIncome,
    exceedsThreshold,
    amountOverThreshold,
    estimatedAdditionalTaxIfComprehensive,
    grossUpApplied: grossUp,
    netTotal,
    grossTotal: totalGross,
    excludedKRW
  };
}

interface ComprehensiveTaxTracker {
  year: number;
  /** 올해 누적 금융소득 (배당+이자, 원, today까지) */
  ytdGross: number;
  dividendGross: number;
  interestGross: number;
  threshold: number;
  /** 임계까지 남은 금액 (max 0) */
  remainingToThreshold: number;
  exceeded: boolean;
  /** ytd / threshold (0~) */
  pctOfThreshold: number;
  /** YTD 페이스로 추정한 연말 금융소득 */
  projectedYearEndGross: number;
  /** 페이스 기준 임계 도달 예상일 (YYYY-MM-DD). 이미 초과했거나 올해 안에 도달 전망 없으면 null */
  projectedThresholdDate: string | null;
  /** 세전 환산(grossUp) 적용 여부 */
  grossUpApplied: boolean;
  /** 입력 금액(세후 입금액 기준) YTD 합계 — 세전 환산 전(원) */
  netTotal: number;
  /** 임계 비교용 — YTD 합계, 세전 환산 후(원, = ytdGross). grossUp=false면 netTotal과 같다 */
  grossTotal: number;
  /** 절세계좌(excludeAccountIds) 수령분이라 임계 합산에서 뺀 금액(원, 과세표준 기준, YTD). 옵션 미지정이면 0 */
  excludedKRW: number;
  /** 연말 예상·도달일의 근거 — "forward"=선행배당 월별 예상(opts.forwardMonths), "linear"=YTD 일 페이스 */
  projectionBasis: "linear" | "forward";
}

function dayOfYear(today: string): number {
  const d = parseIsoLocal(today);
  if (!d) return 1;
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000) + 1;
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * 종합과세 임계(2,000만) 실시간 추적 — "올해 얼마 받았고, 임계까지 얼마 남았고, 이대로면 언제 넘는지".
 * 배당 수령 타이밍/규모 조절(절세) 의사결정용. today(KST YYYY-MM-DD)는 호출부가 주입(테스트 결정성).
 */
export function buildComprehensiveTaxTracker(
  ledger: LedgerEntry[],
  today: string,
  fxRate?: number | null,
  options?: TaxComputeOptions
): ComprehensiveTaxTracker {
  const year = parseIsoLocal(today)?.getFullYear() ?? new Date().getFullYear();
  const yearStr = String(year);
  const grossUp = options?.grossUp === true;
  const exclude = toExcludeSet(options?.excludeAccountIds);
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);

  let dividendGross = 0;
  let dividendNet = 0;
  let interestGross = 0;
  let netTotal = 0;
  let excludedKRW = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date || e.date < `${yearStr}-01-01` || e.date > today) continue;
    const isDiv = isDividendEntry(e);
    if (!isDiv && !isInterestEntry(e)) continue;
    if (exclude && e.toAccountId && exclude.has(e.toAccountId)) {
      excludedKRW += taxableKrw(e, fxRate, grossUp, isDiv);
      continue;
    }
    if (isDiv) {
      dividendGross += taxableKrw(e, fxRate, grossUp, true);
      const n = toKrw(e);
      dividendNet += n;
      netTotal += n;
      continue;
    }
    interestGross += taxableKrw(e, fxRate, grossUp, false); netTotal += toKrw(e);
  }

  const ytdGross = dividendGross + interestGross;
  const threshold = COMPREHENSIVE_TAX_THRESHOLD;
  const remainingToThreshold = Math.max(0, threshold - ytdGross);
  const exceeded = ytdGross > threshold;

  const elapsed = Math.max(1, dayOfYear(today));
  const totalDays = daysInYear(year);
  const dailyPace = ytdGross / elapsed;
  let projectedYearEndGross = dailyPace * totalDays;
  let projectedThresholdDate: string | null = null;
  let projectionBasis: "linear" | "forward" = "linear";

  const forward = options?.forwardMonths;
  if (forward) {
    // 4-6 선행배당 기반: 남은 달(다음 달~12월)은 월별 예상 배당, 이자는 YTD 일 페이스 유지.
    // forwardMonths는 가계부 입금액(세후) 기준이므로 grossUp이면 YTD 배당의 세전/세후 비율로 같이 역산한다.
    projectionBasis = "forward";
    const grossRatio = grossUp && dividendNet > 0 ? dividendGross / dividendNet : 1;
    const interestDaily = interestGross / elapsed;
    const thisMonth = today.slice(0, 7);
    const remaining = forward
      .filter((m) => m.month.startsWith(`${yearStr}-`) && m.month > thisMonth)
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    let cum = ytdGross;
    for (const m of remaining) {
      const monthEnd = getMonthEndDate(m.month);
      const interestToMonthEnd = interestDaily * Math.max(0, dayOfYear(monthEnd) - elapsed);
      cum += m.amountKRW * grossRatio;
      if (!exceeded && projectedThresholdDate == null && cum + interestToMonthEnd > threshold) {
        projectedThresholdDate = monthEnd;
      }
    }
    projectedYearEndGross = cum + interestDaily * (totalDays - elapsed);
    // 남은 달이 없거나(12월) 달 말일 체크 사이를 이자 페이스만으로 넘는 경우 — 연말 기준으로 한 번 더 확인
    if (!exceeded && projectedThresholdDate == null && projectedYearEndGross > threshold) {
      projectedThresholdDate = `${yearStr}-12-31`;
    }
  } else if (!exceeded && dailyPace > 0) {
    const daysToHit = Math.ceil(threshold / dailyPace);
    if (daysToHit <= totalDays) {
      projectedThresholdDate = addDaysToIso(`${yearStr}-01-01`, daysToHit - 1);
    }
  }

  return {
    year,
    ytdGross,
    dividendGross,
    interestGross,
    threshold,
    remainingToThreshold,
    exceeded,
    pctOfThreshold: threshold > 0 ? ytdGross / threshold : 0,
    projectedYearEndGross,
    projectedThresholdDate,
    grossUpApplied: grossUp,
    netTotal,
    grossTotal: ytdGross,
    excludedKRW,
    projectionBasis
  };
}
