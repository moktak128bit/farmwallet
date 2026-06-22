import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { getTodayKST } from "../utils/date";
import { fetchHistoricalCloses } from "../yahooFinanceApi";
import {
  STANDARD_BENCHMARKS,
  benchmarksNeedingRefresh,
  upsertBenchmarkCloses,
} from "../utils/portfolioPerformance";
import { STORAGE_KEYS } from "../constants/config";

/** 자동 fetch 최소 간격 — 이 시간 안에 시도했으면 다시 호출하지 않는다 (실패 반복 hammering 방지) */
const REFETCH_THROTTLE_MS = 12 * 60 * 60 * 1000; // 12시간

/**
 * 시장 지수(KOSPI·S&P500·QQQ) 일별 종가를 하루 1회 자동으로 받아 benchmarkDailyCloses에 적립한다.
 * → 사용자가 "지수 불러오기"를 매번 누를 필요 없이 성과 비교 곡선이 항상 준비된다.
 *
 * - 이미 최신(최근 3일 내 종가 보유)인 지수는 건너뜀 → 불필요한 야후 호출 없음.
 * - 12시간 throttle(localStorage) — 매 새로고침마다 호출하지 않음.
 * - best-effort: 실패해도 조용히 넘어감(수동 "지수 불러오기"로 강제 가능). setData(비-undo)로 적립.
 */
export function useBenchmarkRecorder(): void {
  const setData = useAppStore((s) => s.setData);
  const benchmarkDailyCloses = useAppStore((s) => s.data.benchmarkDailyCloses);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;

    const today = getTodayKST();
    const tickers = STANDARD_BENCHMARKS.map((b) => b.ticker);
    const needed = benchmarksNeedingRefresh(benchmarkDailyCloses, tickers, today);
    if (needed.length === 0) {
      ranRef.current = true; // 전부 최신 — 이번 마운트에선 더 볼 것 없음
      return;
    }

    let last = 0;
    try {
      last = Number(localStorage.getItem(STORAGE_KEYS.BENCHMARK_LAST_FETCH_AT) ?? 0);
    } catch {
      /* localStorage 불가 환경 — throttle 없이 진행 */
    }
    if (Date.now() - last < REFETCH_THROTTLE_MS) return; // 최근에 시도함 → 대기 (ranRef는 유지 안 해 다음 마운트에서 재평가)

    ranRef.current = true;
    try {
      localStorage.setItem(STORAGE_KEYS.BENCHMARK_LAST_FETCH_AT, String(Date.now()));
    } catch {
      /* 무시 */
    }

    void (async () => {
      for (const ticker of needed) {
        try {
          const fetched = await fetchHistoricalCloses(ticker, "2y");
          if (fetched.length > 0) {
            setData((prev) => ({
              ...prev,
              benchmarkDailyCloses: upsertBenchmarkCloses(prev.benchmarkDailyCloses, ticker, fetched),
            }));
          }
        } catch {
          /* best-effort — 다음 지수 계속 */
        }
        await new Promise((r) => setTimeout(r, 400)); // 야후 rate-limit 회피
      }
    })();
  }, [benchmarkDailyCloses, setData]);
}
