import type { HistoricalDailyClose, StockTrade } from "../types";
import { addDaysToIso } from "./date";
import { canonicalTickerForMatch, cryptoDisplaySymbol, isCryptoStock, isUSDStock } from "./finance";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface HistoryRequest {
  ticker: string;
  symbol: string;
  currency: "KRW" | "USD";
  startDate: string;
  endDate: string;
  range: string;
}

/** 전량 매도한 종목도 포함해 실제로 보유했던 기간을 복원한다. */
export function portfolioHistoryRequests(trades: StockTrade[], today: string): HistoryRequest[] {
  const byTicker = new Map<string, { first: string; last: string; quantity: number }>();
  for (const t of trades) {
    const ticker = canonicalTickerForMatch(t.ticker);
    if (!ticker || !ISO_DATE.test(t.date) || t.date > today || !Number.isFinite(t.quantity)) continue;
    const row = byTicker.get(ticker) ?? { first: t.date, last: t.date, quantity: 0 };
    row.first = t.date < row.first ? t.date : row.first;
    row.last = t.date > row.last ? t.date : row.last;
    row.quantity += t.side === "buy" ? t.quantity : -t.quantity;
    byTicker.set(ticker, row);
  }
  return [...byTicker].map(([ticker, row]) => ({
    ticker,
    // 코인 거래는 KRW 원가이므로 USD 가격을 그대로 섞지 않는다.
    symbol: isCryptoStock(ticker) ? `${cryptoDisplaySymbol(ticker)}-KRW` : ticker,
    currency: isUSDStock(ticker) ? "USD" as const : "KRW" as const,
    startDate: row.first,
    endDate: row.quantity > 1e-8 ? today : row.last,
    range: row.first >= addDaysToIso(today, -365) ? "1y"
      : row.first >= addDaysToIso(today, -730) ? "2y"
        : row.first >= addDaysToIso(today, -1825) ? "5y" : "max",
  })).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** 확정된 과거 일별 종가로 보강. 당일 장중 가격과 다른 종목·기간은 보존한다. */
export function mergePortfolioHistory(
  existing: HistoricalDailyClose[] | undefined,
  request: Pick<HistoryRequest, "ticker" | "currency" | "startDate" | "endDate">,
  fetched: Array<{ date: string; close: number }>,
  today: string,
): { next: HistoricalDailyClose[]; changed: number } {
  const ticker = canonicalTickerForMatch(request.ticker);
  const map = new Map<string, HistoricalDailyClose>();
  for (const c of existing ?? []) {
    map.set(`${canonicalTickerForMatch(c.ticker)}|${c.date}`, c);
  }
  let changed = 0;
  for (const c of fetched) {
    if (!ISO_DATE.test(c.date) || c.date < request.startDate || c.date > request.endDate || c.date >= today
      || !Number.isFinite(c.close) || c.close <= 0) continue;
    const key = `${ticker}|${c.date}`;
    const prev = map.get(key);
    if (prev?.close === c.close && prev.currency === request.currency) continue;
    map.set(key, { ticker, date: c.date, close: c.close, currency: request.currency });
    changed += 1;
  }
  return { next: changed ? [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)) : existing ?? [], changed };
}
