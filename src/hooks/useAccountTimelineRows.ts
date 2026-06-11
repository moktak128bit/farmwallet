/**
 * 월별 계좌 타임라인(주식/저축/자산/부채/순자산) 집계 훅 — 대시보드·인사이트 공용.
 * 무거운 파생값이므로 부모 페이지에서 1회 호출하고,
 * 자식(NetWorthTrendChart 등)에는 결과를 props로 내려준다. 자식은 재계산하지 않는다.
 * 계산 본문은 utils/accountTimeline의 순수 함수 — 여기서는 useMemo로 감싸기만 한다.
 */
import { useMemo } from "react";
import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../types";
import { computeAccountTimelineRows, type AccountTimelineRow } from "../utils/accountTimeline";

export function useAccountTimelineRows(params: {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  /** USD 시세를 원화 환산해 둔 가격 목록 (부모 adjustedPrices memo) */
  adjustedPrices: StockPrice[];
  fxRate: number | null;
  currentMonth: string;
  monthRange: string[];
  loans: Loan[];
}): AccountTimelineRow[] {
  const { accounts, ledger, trades, adjustedPrices, fxRate, currentMonth, monthRange, loans } = params;

  return useMemo(
    () => computeAccountTimelineRows({ accounts, ledger, trades, adjustedPrices, fxRate, currentMonth, monthRange, loans }),
    [monthRange, ledger, trades, adjustedPrices, accounts, fxRate, currentMonth, loans]
  );
}
