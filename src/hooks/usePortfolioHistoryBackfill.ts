import { useCallback, useEffect, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/config";
import { useAppStore } from "../store/appStore";
import { fetchHistoricalCloses, fetchStockLookup } from "../yahooFinanceApi";
import { mergeFxBackfill } from "../utils/fxBackfill";
import { canonicalTickerForMatch } from "../utils/finance";
import { getTodayKST } from "../utils/date";
import { mergePortfolioHistory, portfolioHistoryRequests } from "../utils/portfolioHistoryBackfill";
import type { StockLookupData } from "../utils/stockLookup";

const THROTTLE_MS = 12 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<StockLookupData | null>>();
type FetchStamps = Record<string, { at: number; startDate: string; endDate: string }>;

function readStamps(): FetchStamps {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS.PORTFOLIO_HISTORY_FETCH) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as FetchStamps : {};
  } catch { return {}; }
}

/** 성과 차트 진입 시 과거 매도 종목까지 일별 시세·환율 이력을 보강하며 거래는 건드리지 않는다. */
export function usePortfolioHistoryBackfill() {
  const trades = useAppStore((s) => s.data.trades);
  const setData = useAppStore((s) => s.setData);
  const running = useRef(false);
  const mounted = useRef(false);
  const [status, setStatus] = useState({ loading: false, completed: 0, total: 0, changed: 0, failed: 0, fxFailed: false });

  const refresh = useCallback(async (force = false) => {
    if (running.current) return;
    const today = getTodayKST();
    const current = useAppStore.getState().data;
    const stamps = readStamps();
    const cachedTickers = new Set((current.historicalDailyCloses ?? [])
      .filter((c) => Number.isFinite(c.close) && c.close > 0).map((c) => canonicalTickerForMatch(c.ticker)));
    const targets = portfolioHistoryRequests(current.trades, today).filter((r) => {
      const stamp = stamps[r.ticker];
      return force || !cachedTickers.has(r.ticker) || !stamp || !(stamp.at > 0)
        || Date.now() - stamp.at >= THROTTLE_MS || stamp.startDate > r.startDate || stamp.endDate < r.endDate;
    });
    if (!targets.length) return;
    running.current = true;
    let completed = 0, changed = 0, failed = 0, fxFailed = false;
    const report = (loading: boolean) => {
      if (mounted.current) setStatus({ loading, completed, total: targets.length, changed, failed, fxFailed });
    };
    report(true);
    try {
      // 원화 환산도 같은 일별 구간으로 복원한다. 기존에 기록된 환율은 덮어쓰지 않는다.
      try {
        const oldest = [...targets].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
        const fetchedFx = await fetchHistoricalCloses("USDKRW=X", oldest.range);
        fxFailed = fetchedFx.length === 0;
        setData((prev) => {
          const merged = mergeFxBackfill(prev.historicalDailyFx, fetchedFx, today);
          return merged ? { ...prev, historicalDailyFx: merged.next } : prev;
        });
      } catch { fxFailed = true; }
      for (const request of targets) {
        try {
          const key = `${request.symbol}|${request.range}`;
          let pending = inFlight.get(key);
          if (!pending) {
            pending = fetchStockLookup(request.symbol, request.range);
            inFlight.set(key, pending);
          }
          let result: StockLookupData | null;
          try { result = await pending; } finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
          if (!result || result.meta.currency !== request.currency || !result.closes.some((c) =>
            c.date >= request.startDate && c.date <= request.endDate && c.date < today && Number.isFinite(c.close) && c.close > 0)) {
            failed += 1;
          } else {
            const closes = result.closes;
            setData((prev) => {
              // 조회 도중 복원·삭제된 거래를 되살리거나 새 장부에 예전 종목 캐시를 주입하지 않는다.
              if (!prev.trades.some((t) => canonicalTickerForMatch(t.ticker) === request.ticker)) return prev;
              const merged = mergePortfolioHistory(prev.historicalDailyCloses, request, closes, today);
              changed += merged.changed;
              return merged.changed ? { ...prev, historicalDailyCloses: merged.next } : prev;
            });
            try {
              const nextStamps = readStamps();
              nextStamps[request.ticker] = { at: Date.now(), startDate: request.startDate, endDate: request.endDate };
              localStorage.setItem(STORAGE_KEYS.PORTFOLIO_HISTORY_FETCH, JSON.stringify(nextStamps));
            } catch { /* 저장소가 막혀 있어도 이번 조회 결과는 유지한다. */ }
          }
        } catch { failed += 1; }
        completed += 1;
        report(true);
      }
    } finally {
      running.current = false;
      report(false);
    }
  }, [setData]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [trades, refresh]);

  return { ...status, refresh };
}
