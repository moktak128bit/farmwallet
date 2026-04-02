import { useEffect, useRef } from "react";
import type { AppData, HistoricalDailyClose, StockTrade } from "../types";
import { canonicalTickerForMatch } from "../utils/finance";
import { fetchYahooHistoricalCloses } from "../yahooFinanceApi";

const LAST_FETCH_KEY = "fw-historical-closes-last-fetch";
const FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간마다 보충 수집

function getDateRange(trades: StockTrade[]): { start: string; end: string } | null {
  const dates = trades.map((t) => t.date).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 거래된 티커별 첫 거래일 ~ 오늘까지 필요한 날짜 목록 (1일, 15일 기준 포함) */
function getRequiredDatesByTicker(trades: StockTrade[]): Map<string, Set<string>> {
  const byTicker = new Map<string, string[]>();
  for (const t of trades) {
    const key = canonicalTickerForMatch(t.ticker) ?? t.ticker.toUpperCase();
    if (!key) continue;
    const list = byTicker.get(key) ?? [];
    list.push(t.date);
    byTicker.set(key, list);
  }

  const today = getTodayIso();
  const result = new Map<string, Set<string>>();

  for (const [ticker, dates] of byTicker) {
    const sorted = [...dates].sort();
    const start = sorted[0];
    const required = new Set<string>();

    // start ~ today 사이 1일, 15일 포함 날짜
    const startDate = new Date(start + "T00:00:00");
    const endDate = new Date(today + "T00:00:00");
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      required.add(ds);
    }
    // 반월(1, 15일)만 쓸 경우 용량 절약 가능하지만, 1일/15일 수익률 정확도를 위해 일별 수집
    result.set(ticker, required);
  }
  return result;
}

function buildStoredMap(stored: HistoricalDailyClose[]): Map<string, Map<string, number>> {
  const byTicker = new Map<string, Map<string, number>>();
  for (const row of stored) {
    const key = canonicalTickerForMatch(row.ticker) ?? row.ticker;
    let dates = byTicker.get(key);
    if (!dates) {
      dates = new Map();
      byTicker.set(key, dates);
    }
    dates.set(row.date, row.close);
  }
  return byTicker;
}

/** 저장된 데이터에서 asOfDate 이전 최근 종가 조회 */
export function findStoredCloseAtOrBefore(
  stored: HistoricalDailyClose[],
  ticker: string,
  asOfDate: string
): number | null {
  const key = canonicalTickerForMatch(ticker) ?? ticker.toUpperCase();
  const rows = stored
    .filter((r) => (canonicalTickerForMatch(r.ticker) ?? r.ticker) === key && r.date <= asOfDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  return rows[0]?.close ?? null;
}

export function useAutoFetchHistoricalCloses(
  data: AppData,
  setData: (next: AppData | ((prev: AppData) => AppData)) => void
): void {
  const isRunningRef = useRef(false);
  const lastTradesRef = useRef<string>("");

  useEffect(() => {
    if (!data.trades.length) return;
    const tradesKey = JSON.stringify(data.trades.map((t) => ({ ticker: t.ticker, date: t.date })));
    if (tradesKey === lastTradesRef.current) {
      const lastFetch = typeof window !== "undefined" ? window.localStorage.getItem(LAST_FETCH_KEY) : null;
      if (lastFetch) {
        const lastTs = Number(lastFetch);
        if (Number.isFinite(lastTs) && Date.now() - lastTs < FETCH_INTERVAL_MS) return;
      }
    }
    lastTradesRef.current = tradesKey;

    if (isRunningRef.current) return;
    isRunningRef.current = true;

    const range = getDateRange(data.trades);
    if (!range) {
      isRunningRef.current = false;
      return;
    }

    const today = getTodayIso();
    const endDate = range.end < today ? today : range.end;
    const requiredByTicker = getRequiredDatesByTicker(data.trades);
    const storedMap = buildStoredMap(data.historicalDailyCloses ?? []);

    const tickersToFetch: string[] = [];
    for (const [ticker, required] of requiredByTicker) {
      const stored = storedMap.get(ticker);
      const missing = [...required].filter((d) => !stored?.has(d));
      if (missing.length > 0) tickersToFetch.push(ticker);
    }

    if (tickersToFetch.length === 0) {
      isRunningRef.current = false;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_FETCH_KEY, String(Date.now()));
      }
      return;
    }

    let cancelled = false;
    (async () => {
      const existing = data.historicalDailyCloses ?? [];
      const byKey = new Map<string, Map<string, number>>();
      for (const row of existing) {
        const k = canonicalTickerForMatch(row.ticker) ?? row.ticker;
        let m = byKey.get(k);
        if (!m) {
          m = new Map();
          byKey.set(k, m);
        }
        m.set(row.date, row.close);
      }

      for (const ticker of tickersToFetch) {
        if (cancelled) break;
        try {
          const rows = await fetchYahooHistoricalCloses(ticker, range.start, endDate);
          const key = canonicalTickerForMatch(ticker) ?? ticker;
          let m = byKey.get(key);
          if (!m) {
            m = new Map();
            byKey.set(key, m);
          }
          for (const r of rows) {
            if (r.date >= range.start && r.date <= endDate) m.set(r.date, r.close);
          }
          await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
          console.warn("[useAutoFetchHistoricalCloses] fetch failed for", ticker, err);
        }
      }

      if (cancelled) {
        isRunningRef.current = false;
        return;
      }

      const nextCloses: HistoricalDailyClose[] = [];
      byKey.forEach((dates, ticker) => {
        const sorted = [...dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        for (const [date, close] of sorted) {
          nextCloses.push({ ticker, date, close });
        }
      });
      nextCloses.sort((a, b) => {
        const byT = a.ticker.localeCompare(b.ticker);
        return byT !== 0 ? byT : a.date.localeCompare(b.date);
      });

      if (!cancelled) {
        setData((prev) => {
          const next = { ...prev, historicalDailyCloses: nextCloses };
          return next;
        });
        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_FETCH_KEY, String(Date.now()));
        }
      }
      isRunningRef.current = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [
    data.trades,
    data.historicalDailyCloses,
    setData
  ]);
}
