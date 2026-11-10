// ---------------------------------------------------------------------------
// reportGenerator 분해 — 여러 reports/*.ts 파일이 공유하는 헬퍼.
// (순수 이동만 — 로직 변경 없음. 원본 src/utils/reportGenerator.ts 참조)
// ---------------------------------------------------------------------------

import type { Account, LedgerEntry, StockTrade } from "../../types";
import { buildClosedTradeRecords } from "../investmentRecord";
import { isDividendEntry, isDividendEntryLoose, isInterestEntryLoose } from "../categoryMatch";
import type { FxPoint } from "../portfolioHistory";
import { classifyIncomeNature } from "../realIncome";
import { isExcludedIncomeEntry } from "../savingsRate";
import { isUSDStock } from "../finance";
import { toKrwByRate } from "../currency";

export const INVESTING_ACCOUNT_TYPES = new Set<Account["type"]>(["savings", "securities", "crypto"]);

export function toKrwAmount(amount: number, currency?: string, fxRate?: number): number {
  return toKrwByRate(amount, currency, fxRate);
}

function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  const shifted = new Date(y, m - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function buildMonthRange(startMonth: string, endMonth: string): string[] {
  const result: string[] = [];
  let current = startMonth;
  while (current <= endMonth) {
    result.push(current);
    current = shiftMonth(current, 1);
  }
  return result;
}

export function convertPositionAmount(
  amount: number,
  ticker: string,
  account: Account | undefined,
  fxRate?: number
): number {
  if (!fxRate) return amount;
  if (isUSDStock(ticker) || account?.currency === "USD") {
    return amount * fxRate;
  }
  return amount;
}

/**
 * 매도 건별 실현손익(KRW) — lot별 거래시점 환율(fxRateAtTrade) 기준.
 * 대시보드·투자기록 카드(buildClosedTradeRecords)와 동일 정의로 통일 —
 * 과거 USD 매도를 '현재' 환율로 환산하면 환변동분이 손익에 섞여 화면마다 값이 달라짐(불변식: 과거손익 보존).
 */
export function realizedPnlKRWByTradeId(trades: StockTrade[], accounts: Account[], fxRate?: number, fxHistory: FxPoint[] = []): Map<string, number> {
  const m = new Map<string, number>();
  // 환율 이력(fxHistory)으로 거래일 환율을 찾는다 — 대시보드·주식 탭과 같은 입력. 이력에서도 못 찾은(fxUnreliable)
  // 매도는 손익이 왜곡값이라 넣지 않는다(summarizeRecords와 같은 제외 기준).
  for (const r of buildClosedTradeRecords(trades, accounts, fxRate, fxHistory)) {
    if (!r.fxUnreliable) m.set(r.tradeId, r.realizedPnlKRW);
  }
  return m;
}

/**
 * 투자 계좌로 들어온 수입 중 '원금'으로 볼 것 — 퇴직연금 이전(소득 집계 제외)·이월 또는 일시·이전성/부채 성격.
 * 배당·이자는 계좌가 번 돈이라 원금이 아니다. 대시보드 glanceMath(투자 총손익 원금)와 같은 규칙.
 */
export function isPrincipalLikeIncomeEntry(e: LedgerEntry): boolean {
  if (e.kind !== "income") return false;
  if (isDividendEntryLoose(e) || isInterestEntryLoose(e)) return false;
  if (isExcludedIncomeEntry(e)) return true;
  const nature = classifyIncomeNature(e.subCategory || e.category || "");
  return nature === "일시" || nature === "부채";
}

/**
 * 리포트 '쓸 수 있는 수입' 게이트 — 이월·원래 보유·퇴직연금(isExcludedIncomeEntry)과 대출 실행(부채)은 소득이 아니다.
 * 월별·연도별·소비 영향 리포트가 같은 규칙을 쓴다 (실장부: 대출 2,000만·퇴직연금 이전이 수입·투자여력에 섞였다).
 */
export function isReportIncomeEntry(e: LedgerEntry): boolean {
  if (e.kind !== "income" || isExcludedIncomeEntry(e)) return false;
  return classifyIncomeNature(e.subCategory || e.category || "") !== "부채";
}

/** 배당 수입 판정 — categoryMatch 단일 진입점 (category/subCategory 정확 매칭, 위양성 방지) */
export function isDividendIncomeEntry(entry: LedgerEntry): boolean {
  return entry.kind === "income" && isDividendEntry(entry);
}
