import { useMemo } from "react";
import type { LedgerEntry, StockTrade } from "../../../types";

export interface DashboardIndex {
  ledgerByMonth: Map<string, LedgerEntry[]>;
  ledgerByDate: Map<string, LedgerEntry[]>;
  ledgerByCategory: Map<string, LedgerEntry[]>;
  tradesByMonth: Map<string, StockTrade[]>;
  tradesByDate: Map<string, StockTrade[]>;
  tradesByTicker: Map<string, StockTrade[]>;
}

export function useDashboardIndex(
  ledger: LedgerEntry[],
  trades: StockTrade[]
): DashboardIndex {
  return useMemo(() => {
    const ledgerByMonth = new Map<string, LedgerEntry[]>();
    const ledgerByDate = new Map<string, LedgerEntry[]>();
    const ledgerByCategory = new Map<string, LedgerEntry[]>();

    for (const l of ledger) {
      if (l.date) {
        const month = l.date.slice(0, 7);
        const monthList = ledgerByMonth.get(month) ?? [];
        monthList.push(l);
        ledgerByMonth.set(month, monthList);

        const dateList = ledgerByDate.get(l.date) ?? [];
        dateList.push(l);
        ledgerByDate.set(l.date, dateList);
      }
      if (l.category) {
        const catList = ledgerByCategory.get(l.category) ?? [];
        catList.push(l);
        ledgerByCategory.set(l.category, catList);
      }
    }

    const tradesByMonth = new Map<string, StockTrade[]>();
    const tradesByDate = new Map<string, StockTrade[]>();
    const tradesByTicker = new Map<string, StockTrade[]>();

    for (const t of trades) {
      if (t.date) {
        const month = t.date.slice(0, 7);
        const monthList = tradesByMonth.get(month) ?? [];
        monthList.push(t);
        tradesByMonth.set(month, monthList);

        const dateList = tradesByDate.get(t.date) ?? [];
        dateList.push(t);
        tradesByDate.set(t.date, dateList);
      }
      const ticker = t.ticker?.toUpperCase() ?? "";
      if (ticker) {
        const tickerList = tradesByTicker.get(ticker) ?? [];
        tickerList.push(t);
        tradesByTicker.set(ticker, tickerList);
      }
    }

    return {
      ledgerByMonth,
      ledgerByDate,
      ledgerByCategory,
      tradesByMonth,
      tradesByDate,
      tradesByTicker
    };
  }, [ledger, trades]);
}
