import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { useFxRateValue } from "../context/FxRateContext";
import { getTodayKST } from "../utils/date";
import { buildMissingMarketEnvSnapshots } from "../utils/marketEnvBackfill";
import { buildFxHistory } from "../utils/portfolioHistory";
import type { MarketEnvSnapshot } from "../types";

/**
 * 오늘이 월 1일 또는 15일(KST)이고, 해당 날짜의 market env 스냅샷이 아직 없으면
 * 현재 prices + fxRate를 사용해 한 번 기록한다.
 * 한 번 기록된 스냅샷은 덮어쓰지 않는다 — 과거 시세 환경은 불변.
 *
 * 추가로 마운트당 1회, 놓친 과거 1일·15일을 일별 종가·환율 이력으로 소급 박제한다
 * (그날 앱을 안 열어 결번이 된 점이 '현재가'로 흔들리는 문제 해소 — marketEnvBackfill 참조).
 */
export function useMarketEnvSnapshotRecorder(): void {
  const fxRate = useFxRateValue();
  const setData = useAppStore((s) => s.setData);
  const pricesLength = useAppStore((s) => (s.data.prices ?? []).length);
  const recordedThisMountRef = useRef(false);
  const backfilledThisMountRef = useRef(false);

  // 소급 박제 — 날짜 무관, 마운트당 1회. 정시 기록과 별개 effect(가드도 별개).
  useEffect(() => {
    if (backfilledThisMountRef.current) return;
    if (!fxRate || fxRate <= 0) return; // 환율 로드 후에 — fallbackFxRate로도 쓰인다
    backfilledThisMountRef.current = true;

    const current = useAppStore.getState().data;
    const added = buildMissingMarketEnvSnapshots({
      trades: current.trades ?? [],
      historicalDailyCloses: current.historicalDailyCloses,
      fxHistory: buildFxHistory(current.historicalDailyFx, current.marketEnvSnapshots),
      existingSnapshots: current.marketEnvSnapshots,
      fallbackFxRate: fxRate,
      today: getTodayKST(),
      nowIso: new Date().toISOString(),
    });
    if (added.length === 0) return;

    setData((prev) => {
      // 계산~쓰기 사이에 다른 탭이 같은 날짜를 먼저 박제했을 수 있다 — prev 기준으로 재중복 제거
      const have = new Set((prev.marketEnvSnapshots ?? []).map((s) => s.date));
      const fresh = added.filter((s) => !have.has(s.date));
      if (fresh.length === 0) return prev;
      return {
        ...prev,
        marketEnvSnapshots: [...(prev.marketEnvSnapshots ?? []), ...fresh].sort((a, b) =>
          a.date.localeCompare(b.date)
        ),
      };
    });
  }, [fxRate, setData]);

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
