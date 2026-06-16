import type { LedgerEntry } from "../types";
import { isDividendEntry, isInterestEntry } from "./categoryMatch";

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
