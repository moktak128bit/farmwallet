import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { useFxRateValue } from "../context/FxRateContext";
import { getTodayKST } from "../utils/date";
import { upsertDailyFx } from "../utils/dailyFx";

/**
 * 하루 1회(KST 기준) 현재 USD/KRW 환율을 historicalDailyFx에 적립한다.
 * 과거 시점 USD 평가액을 일별로 복원(portfolioHistory)하기 위한 환율 백본 — marketEnvSnapshots(반월)보다
 * 촘촘한 일별 곡선을 만든다.
 *
 * 시세/스냅샷 적립과 동일하게 setData(비-undo)로 기록 — 자동 적립이 Ctrl+Z 히스토리를 오염시키지 않게.
 */
export function useDailyFxRecorder(): void {
  const fxRate = useFxRateValue();
  const setData = useAppStore((s) => s.setData);
  const recordedTodayRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fxRate || fxRate <= 0) return;
    const today = getTodayKST();
    if (recordedTodayRef.current === today) return;

    const current = useAppStore.getState().data;
    const next = upsertDailyFx(current.historicalDailyFx, fxRate, today);
    recordedTodayRef.current = today;
    if (!next) return;
    setData((prev) => ({ ...prev, historicalDailyFx: next }));
  }, [fxRate, setData]);
}
