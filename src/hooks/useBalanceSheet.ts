/**
 * 지금 시점 대차(총자산·총부채·순자산) — computeBalanceSheet 파이프라인 단일 진입점.
 *
 * 잔액 엔진(computeAccountBalances) → 원화 환산 시세(buildAdjustedPrices) + 시세 없는 종목은 원가 대체
 * (priceFallback "cost") 포지션 → computeBalanceSheet. 페이지마다 이 세 줄을 복붙하면 입력(시세 환산·
 * fallback·대출)이 어긋나 화면마다 순자산이 달라질 수 있어 한 곳에 둔다.
 * 잔액·포지션을 다른 위젯에도 쓰는 페이지(대시보드·계좌)는 그 값을 재사용해 computeBalanceSheet를 직접 부른다.
 */
import { useMemo } from "react";
import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../types";
import { computeAccountBalances, computeBalanceSheet, computePositions, type BalanceSheet } from "../calculations";
import { buildAdjustedPrices } from "../utils/accountTimeline";

export function useBalanceSheet(params: {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  fxRate: number | null;
  loans: Loan[] | undefined;
}): BalanceSheet {
  const { accounts, ledger, trades, prices, fxRate, loans } = params;
  return useMemo(() => {
    const balances = computeAccountBalances(accounts, ledger, trades);
    const positions = computePositions(trades, buildAdjustedPrices(prices, fxRate), accounts, {
      fxRate: fxRate ?? undefined,
      priceFallback: "cost",
    });
    return computeBalanceSheet(balances, positions, fxRate, loans, ledger);
  }, [accounts, ledger, trades, prices, fxRate, loans]);
}
