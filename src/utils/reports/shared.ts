// ---------------------------------------------------------------------------
// reportGenerator 분해 — 여러 reports/*.ts 파일이 공유하는 헬퍼.
// (순수 이동만 — 로직 변경 없음. 원본 src/utils/reportGenerator.ts 참조)
// ---------------------------------------------------------------------------

import type { Account, LedgerEntry, StockTrade } from "../../types";
import { buildClosedTradeRecords } from "../investmentRecord";
import { isDividendEntry } from "../categoryMatch";
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
export function realizedPnlKRWByTradeId(trades: StockTrade[], accounts: Account[], fxRate?: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of buildClosedTradeRecords(trades, accounts, fxRate)) m.set(r.tradeId, r.realizedPnlKRW);
  return m;
}

/** 배당 수입 판정 — categoryMatch 단일 진입점 (category/subCategory 정확 매칭, 위양성 방지) */
export function isDividendIncomeEntry(entry: LedgerEntry): boolean {
  return entry.kind === "income" && isDividendEntry(entry);
}
