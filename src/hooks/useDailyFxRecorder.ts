import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { useFxRateInfoValue } from "../context/FxRateContext";
import { getTodayKST } from "../utils/date";
import { shouldRecordDailyFx, upsertDailyFx } from "../utils/dailyFx";

/**
 * 하루 1회(KST 기준) 현재 USD/KRW 환율을 historicalDailyFx에 적립한다.
 * 과거 시점 USD 평가액을 일별로 복원(portfolioHistory)하기 위한 환율 백본 — marketEnvSnapshots(반월)보다
 * 촘촘한 일별 곡선을 만든다.
 *
 * 신선도 가드: FxRateContext 초기값은 localStorage 캐시(며칠 전 수신)일 수 있으므로, fetchedAt이 오늘(KST)인
 * 값만 적립한다(shouldRecordDailyFx). 캐시를 오늘 날짜로 박제하면 뒤이어 도착한 신선 환율이 막혀
 * TWR·양도세 환산·marketEnvBackfill까지 묵은 값이 전파된다.
 *
 * 시세/스냅샷 적립과 동일하게 setData(비-undo)로 기록 — 자동 적립이 Ctrl+Z 히스토리를 오염시키지 않게.
 */
export function useDailyFxRecorder(): void {
  const { rate, fetchedAt } = useFxRateInfoValue();
  const setData = useAppStore((s) => s.setData);
  /** 이번 세션에서 신선값으로 적립한 날짜 — 캐시값 스킵은 여기 기록하지 않는다(뒤이어 오는 신선값이 적립돼야 하므로) */
  const recordedTodayRef = useRef<string | null>(null);

  useEffect(() => {
    const today = getTodayKST();
    if (!rate || !shouldRecordDailyFx({ rate, fetchedAt, today, recordedFor: recordedTodayRef.current })) return;

    const current = useAppStore.getState().data;
    const next = upsertDailyFx(current.historicalDailyFx, rate, today);
    recordedTodayRef.current = today;
    if (!next) return;
    setData((prev) => ({ ...prev, historicalDailyFx: next }));
  }, [rate, fetchedAt, setData]);
}
