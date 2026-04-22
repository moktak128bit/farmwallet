import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { useFxRateValue } from "../context/FxRateContext";
import { getTodayKST } from "../utils/date";
import type { MarketEnvSnapshot } from "../types";

/**
 * 오늘이 월 1일 또는 15일(KST)이고, 해당 날짜의 market env 스냅샷이 아직 없으면
 * 현재 prices + fxRate를 사용해 한 번 기록한다.
 * 한 번 기록된 스냅샷은 덮어쓰지 않는다 — 과거 시세 환경은 불변.
 */
export function useMarketEnvSnapshotRecorder(): void {
  const fxRate = useFxRateValue();
  const setData = useAppStore((s) => s.setData);
  const pricesLength = useAppStore((s) => (s.data.prices ?? []).length);
  const recordedThisMountRef = useRef(false);

  useEffect(() => {
    if (recordedThisMountRef.current) return;
    if (!fxRate || fxRate <= 0) return;
    if (pricesLength === 0) return;

    const today = getTodayKST();
    const day = today.slice(-2);
    if (day !== "01" && day !== "15") return;

    const current = useAppStore.getState().data;
    const existing = current.marketEnvSnapshots ?? [];
    if (existing.some((s) => s.date === today)) {
      recordedThisMountRef.current = true;
      return;
    }

    const prices = current.prices ?? [];
    const snapshotPrices: MarketEnvSnapshot["prices"] = [];
    const seen = new Set<string>();
    for (const p of prices) {
      if (!p?.ticker) continue;
      if (typeof p.price !== "number" || !Number.isFinite(p.price)) continue;
      const key = p.ticker.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      snapshotPrices.push({
        ticker: p.ticker,
        price: p.price,
        currency: p.currency,
      });
    }
    if (snapshotPrices.length === 0) return;

    const newSnap: MarketEnvSnapshot = {
      date: today,
      fxRate,
      prices: snapshotPrices,
      recordedAt: new Date().toISOString(),
    };
    recordedThisMountRef.current = true;
    setData((prev) => ({
      ...prev,
      marketEnvSnapshots: [...(prev.marketEnvSnapshots ?? []), newSnap].sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
    }));
  }, [fxRate, pricesLength, setData]);
}
