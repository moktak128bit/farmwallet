/**
 * 월별 계좌 타임라인(주식/저축/자산/부채/순자산) 집계 훅 — DashboardPage 전용.
 * 무거운 파생값이므로 부모(DashboardPage)에서 1회 호출하고,
 * 자식(NetWorthTrendChart 등)에는 결과를 props로 내려준다. 자식은 재계산하지 않는다.
 */
import { useMemo } from "react";
import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../../../types";
import { computeLoanBalanceAt, computePositions, positionMarketValueKRW } from "../../../calculations";
import { getMonthEndDate } from "../../../utils/date";
import { isUSDStock } from "../../../utils/finance";

export type AccountTimelineRow = {
  month: string;
  stock: number;
  savings: number;
  asset: number;
  debt: number;
  total: number;
};

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

  return useMemo(() => {
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const ledgerByMonth = new Map<string, LedgerEntry[]>();
    const tradesByMonth = new Map<string, StockTrade[]>();

    ledger.forEach((entry) => {
      if (!entry.date) return;
      const month = entry.date.slice(0, 7);
      const rows = ledgerByMonth.get(month);
      if (rows) rows.push(entry);
      else ledgerByMonth.set(month, [entry]);
    });
    trades.forEach((trade) => {
      if (!trade.date) return;
      const month = trade.date.slice(0, 7);
      const rows = tradesByMonth.get(month);
      if (rows) rows.push(trade);
      else tradesByMonth.set(month, [trade]);
    });

    const runningBalanceByAccount = new Map<string, number>();
    const runningUsdTransferNetByAccount = new Map<string, number>();
    accounts.forEach((account) => {
      const baseBalance =
        account.type === "securities" || account.type === "crypto"
          ? (account.initialCashBalance ?? account.initialBalance)
          : account.initialBalance;
      runningBalanceByAccount.set(
        account.id,
        baseBalance + (account.cashAdjustment ?? 0) + (account.savings ?? 0)
      );
      runningUsdTransferNetByAccount.set(account.id, 0);
    });

    const runningTrades: StockTrade[] = [];
    const rows: AccountTimelineRow[] = [];

    monthRange.forEach((month) => {
      const monthLedger = ledgerByMonth.get(month) ?? [];
      for (const entry of monthLedger) {
        if (entry.kind === "income" && entry.toAccountId) {
          runningBalanceByAccount.set(
            entry.toAccountId,
            (runningBalanceByAccount.get(entry.toAccountId) ?? 0) + entry.amount
          );
          continue;
        }
        if (entry.kind === "expense") {
          if (entry.fromAccountId) {
            runningBalanceByAccount.set(
              entry.fromAccountId,
              (runningBalanceByAccount.get(entry.fromAccountId) ?? 0) - entry.amount
            );
          }
          if (entry.toAccountId) {
            runningBalanceByAccount.set(
              entry.toAccountId,
              (runningBalanceByAccount.get(entry.toAccountId) ?? 0) + entry.amount
            );
          }
          continue;
        }
        if (entry.kind === "transfer") {
          if (entry.currency === "USD") {
            if (entry.fromAccountId) {
              runningUsdTransferNetByAccount.set(
                entry.fromAccountId,
                (runningUsdTransferNetByAccount.get(entry.fromAccountId) ?? 0) - entry.amount
              );
            }
            if (entry.toAccountId) {
              runningUsdTransferNetByAccount.set(
                entry.toAccountId,
                (runningUsdTransferNetByAccount.get(entry.toAccountId) ?? 0) + entry.amount
              );
            }
          } else {
            if (entry.fromAccountId) {
              runningBalanceByAccount.set(
                entry.fromAccountId,
                (runningBalanceByAccount.get(entry.fromAccountId) ?? 0) - entry.amount
              );
            }
            if (entry.toAccountId) {
              runningBalanceByAccount.set(
                entry.toAccountId,
                (runningBalanceByAccount.get(entry.toAccountId) ?? 0) + entry.amount
              );
            }
          }
          continue;
        }
      }

      const monthTrades = tradesByMonth.get(month) ?? [];
      for (const trade of monthTrades) {
        runningTrades.push(trade);
        const account = accountById.get(trade.accountId);
        if ((account?.type === "securities" || account?.type === "crypto") && isUSDStock(trade.ticker)) continue;
        runningBalanceByAccount.set(
          trade.accountId,
          (runningBalanceByAccount.get(trade.accountId) ?? 0) + trade.cashImpact
        );
      }

      const monthEndDate = getMonthEndDate(month);
      const monthPrices = adjustedPrices.filter((price) => {
        if (month === currentMonth) return true;
        if (!price.updatedAt) return false;
        return price.updatedAt.slice(0, 10) <= monthEndDate;
      });
      const monthPositions = computePositions(runningTrades, monthPrices, accounts, {
        fxRate: fxRate ?? undefined,
        priceFallback: "cost"
      });
      const stockByAccount = new Map<string, number>();
      monthPositions.forEach((position) => {
        stockByAccount.set(
          position.accountId,
          (stockByAccount.get(position.accountId) ?? 0) +
            positionMarketValueKRW(position, fxRate)
        );
      });

      let totalStockValue = 0;
      let totalSavingsValue = 0;
      let totalValue = 0;
      let totalAssetValue = 0;
      let totalDebtValue = 0;
      const row: AccountTimelineRow = { month, stock: 0, savings: 0, asset: 0, debt: 0, total: 0 };
      accounts.forEach((account) => {
        const cash = runningBalanceByAccount.get(account.id) ?? 0;
        const usdCash =
          account.type === "securities" || account.type === "crypto"
            ? (account.usdBalance ?? 0) + (runningUsdTransferNetByAccount.get(account.id) ?? 0)
            : 0;
        const usdToKrw = fxRate && usdCash !== 0 ? usdCash * fxRate : 0;
        const stock = stockByAccount.get(account.id) ?? 0;
        const debt = Math.abs(account.debt ?? 0);
        const accountAsset = cash + usdToKrw + stock;
        const accountValue = accountAsset - debt;
        totalAssetValue += accountAsset;
        totalDebtValue += debt;
        totalValue += accountValue;

        if (account.type === "securities" || account.type === "crypto") {
          totalStockValue += stock;
        } else if (account.type === "savings") {
          totalSavingsValue += cash - debt;
        }
      });

      // 월말 시점 대출 잔금 차감 (원금 상환은 차감, 이자 상환은 잔금 불변)
      const monthLoanBalance = computeLoanBalanceAt(loans, ledger, monthEndDate);
      totalDebtValue += monthLoanBalance;
      totalValue -= monthLoanBalance;

      row.stock = totalStockValue;
      row.savings = totalSavingsValue;
      row.asset = totalAssetValue;
      row.debt = totalDebtValue;
      row.total = totalValue;
      rows.push(row);
    });

    return rows;
  }, [monthRange, ledger, trades, adjustedPrices, accounts, fxRate, currentMonth, loans]);
}
