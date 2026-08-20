import { useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import { useAppStore } from "../store/appStore";
import { STORAGE_KEYS } from "../constants/config";
import { getTodayKST } from "../utils/date";
import { mergeFxBackfill, missingFxDates } from "../utils/fxBackfill";
import { fetchHistoricalCloses } from "../yahooFinanceApi";

/** 자동 backfill 최소 간격 — 이 시간 안에 시도했으면 다시 호출하지 않는다 (실패 반복 hammering 방지) */
const BACKFILL_THROTTLE_MS = 12 * 60 * 60 * 1000; // 12시간
/** 결번 탐색 구간 (dailyFx 일별 보존 구간과 동일) */
const BACKFILL_RECENT_DAYS = 180;
/** Yahoo range — 180일 ≈ 6mo */
const BACKFILL_RANGE = "6mo";
const FX_SYMBOL = "USDKRW=X";

/**
 * 마운트당 1회, 최근 180일 중 historicalDailyFx 결번(영업일)이 있으면 Yahoo USDKRW=X 과거 종가로 보강한다.
 * - 기존 값 불변·없는 날짜만 append (utils/fxBackfill.mergeFxBackfill).
 * - 12시간 throttle(localStorage FX_BACKFILL_LAST_AT) — 매 새로고침마다 호출하지 않음.
 * - setData(비-undo) — 자동 적립이 Ctrl+Z 히스토리를 오염시키지 않게.
 * - 처음 보강되면 토스트로 고지: 과거 TWR·양도세 환산값이 소급 변동할 수 있다(환율 곡선이 촘촘해지므로).
 * best-effort: 실패는 조용히 넘어가고 다음 마운트(12h 후)에 재시도.
 * @param enabled 초기 데이터 로드 완료 후 true — 빈 초기 스토어를 "전부 결번"으로 오판하지 않게
 */
export function useFxBackfill(enabled: boolean): void {
  const setData = useAppStore((s) => s.setData);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!enabled || ranRef.current) return;
    const today = getTodayKST();
    const missing = missingFxDates(useAppStore.getState().data.historicalDailyFx, today, {
      recentDays: BACKFILL_RECENT_DAYS,
    });
    if (missing.length === 0) {
      ranRef.current = true; // 결번 없음 — 이번 마운트에선 더 볼 것 없음
      return;
    }

    let last = 0;
    try {
      last = Number(localStorage.getItem(STORAGE_KEYS.FX_BACKFILL_LAST_AT) ?? 0);
    } catch {
      /* localStorage 불가 환경 — throttle 없이 진행 */
    }
    if (Number.isFinite(last) && Date.now() - last < BACKFILL_THROTTLE_MS) return;

    ranRef.current = true;
    try {
      localStorage.setItem(STORAGE_KEYS.FX_BACKFILL_LAST_AT, String(Date.now()));
    } catch {
      /* 무시 */
    }

    void (async () => {
      try {
        const fetched = await fetchHistoricalCloses(FX_SYMBOL, BACKFILL_RANGE);
        if (fetched.length === 0) return;
        let added = 0;
        setData((prev) => {
          const merged = mergeFxBackfill(prev.historicalDailyFx, fetched, getTodayKST());
          if (!merged) return prev;
          added = merged.added;
          return { ...prev, historicalDailyFx: merged.next };
        });
        if (added > 0) {
          toast(`환율 이력 ${added}일 보강 — 과거 TWR·양도세 환산값이 소급 반영될 수 있습니다.`, {
            duration: 7000,
          });
        }
      } catch {
        /* best-effort — 다음 마운트에서 재시도 */
      }
    })();
  }, [enabled, setData]);
}
