import type { LedgerEntry } from "../types";
import { isDividendEntry, isInterestEntry } from "./categoryMatch";
import { addDaysToIso, parseIsoLocal } from "./date";

/** 한국 분리과세 배당·이자소득세율 (소득세 14% + 지방세 1.4%) */
export const SEPARATE_TAX_RATE = 0.154;

/** 종합과세 전환 기준 (배당+이자 합계, 원) */
export const COMPREHENSIVE_TAX_THRESHOLD = 20_000_000;

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
}

/**
 * 가계부 항목 중 카테고리가 "배당" 또는 "이자"를 포함하는 수입 합계 기준으로
 * 한국 세법에 따른 분리과세/종합과세 시뮬레이션을 수행한다.
 *
 * 가계부 amount는 세후 입금액일 가능성이 높지만(은행 자동 차감), 본 계산은
 * 사용자가 입력한 금액을 grossTaxable로 가정하고 표시한다.
 */
export function summarizeTaxYear(ledger: LedgerEntry[], year: number, fxRate?: number | null): TaxYearSummary {
  const yearStr = String(year);
  // USD 배당/이자는 원화로 환산해야 과세표준이 맞다 (환율 미로드 시 액면 폴백 — 합산 정책 일관)
  const toKrw = (e: LedgerEntry) => (e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount);

  let dividendGross = 0;
  let interestGross = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date?.startsWith(yearStr)) continue;
    if (isDividendEntry(e)) { dividendGross += toKrw(e); continue; }
    if (isInterestEntry(e)) interestGross += toKrw(e);
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
    estimatedAdditionalTaxIfComprehensive
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
  fxRate?: number | null
): ComprehensiveTaxTracker {
  const year = parseIsoLocal(today)?.getFullYear() ?? new Date().getFullYear();
  const yearStr = String(year);
  const toKrw = (e: LedgerEntry) => (e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount);

  let dividendGross = 0;
  let interestGross = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date || e.date < `${yearStr}-01-01` || e.date > today) continue;
    if (isDividendEntry(e)) { dividendGross += toKrw(e); continue; }
    if (isInterestEntry(e)) interestGross += toKrw(e);
  }

  const ytdGross = dividendGross + interestGross;
  const threshold = COMPREHENSIVE_TAX_THRESHOLD;
  const remainingToThreshold = Math.max(0, threshold - ytdGross);
  const exceeded = ytdGross > threshold;

  const elapsed = Math.max(1, dayOfYear(today));
  const totalDays = daysInYear(year);
  const dailyPace = ytdGross / elapsed;
  const projectedYearEndGross = dailyPace * totalDays;

  let projectedThresholdDate: string | null = null;
  if (!exceeded && dailyPace > 0) {
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
    projectedThresholdDate
  };
}
