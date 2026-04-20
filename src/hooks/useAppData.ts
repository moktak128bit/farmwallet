import { useEffect, useState, useCallback, useRef } from "react";
import { loadData, preloadKrNames, applyKoreanStockNames, saveData } from "../storage";
import { useAppStore } from "../store/appStore";
import { loadCacheFromDB, mergeCacheIntoAppData } from "../services/cacheStore";

export function useAppData() {
  const data = useAppStore((s) => s.data);
  const setData = useAppStore((s) => s.setData);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // 초기 데이터 로드 (한 번만) → Zustand store에 반영
  // setTimeout(0): 로딩 화면이 먼저 페인트된 뒤 무거운 JSON 파싱·마이그레이션 실행
  // krNames는 idle 시간에 비동기 로드하여 초기 렌더를 차단하지 않음
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const loaded = loadData();
        useAppStore.setState({ data: loaded });
        setLoadFailed(false);
      } catch (e) {
        console.error("[FarmWallet] 초기 데이터 로드 실패", e);
        setLoadFailed(true);
      }
      setIsLoading(false);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // localStorage가 비어 있으면 최신 백업 파일에서 전체 데이터 복원
  const dataRecoveryDone = useRef(false);
  useEffect(() => {
    if (isLoading || dataRecoveryDone.current) return;
    const currentData = useAppStore.getState().data;
    // ledger가 있으면 데이터 정상 — 복원 불필요
    if (currentData?.ledger && currentData.ledger.length > 0) return;
    dataRecoveryDone.current = true;
    fetch("/api/restore-latest-backup")
      .then((r) => r.json())
      .then((backup: Record<string, unknown> | null) => {
        if (!backup || typeof backup !== "object") return;
        const ledger = backup.ledger;
        if (!Array.isArray(ledger) || ledger.length === 0) return;
        // 백업 데이터를 localStorage에 저장 후 loadData로 재로드
        try {
          saveData(backup as unknown as Parameters<typeof saveData>[0]);
          const reloaded = loadData();
          useAppStore.setState({ data: reloaded });
          setLoadFailed(false);
        } catch (e) {
          console.error("[FarmWallet] 백업 복원 실패", e);
        }
      })
      .catch(() => { /* 백업 복원 실패 시 무시 */ });
  }, [isLoading]);

  // 초기 로드 후 IndexedDB에서 캐시 하이드레이션.
  // localStorage 캐시가 비어 있어도 IndexedDB에 저장된 prices/tickerDatabase/
  // historicalDailyCloses를 병합해 API 재수집 없이 즉시 사용 가능.
  const cacheHydrationDone = useRef(false);
  useEffect(() => {
    if (isLoading || loadFailed || cacheHydrationDone.current) return;
    cacheHydrationDone.current = true;
    (async () => {
      const cache = await loadCacheFromDB();
      const current = useAppStore.getState().data;
      if (!current) return;
      const merged = mergeCacheIntoAppData(current, cache);
      // 실제 변경 있을 때만 store 업데이트 (불필요한 리렌더 방지)
      const changed =
        (cache.prices.length > 0 && current.prices !== merged.prices) ||
        (cache.tickerDatabase.length > 0 && current.tickerDatabase !== merged.tickerDatabase) ||
        (cache.historicalDailyCloses.length > 0 &&
          current.historicalDailyCloses !== merged.historicalDailyCloses);
      if (changed) {
        useAppStore.setState({ data: merged });
      }
    })().catch(() => {
      /* IndexedDB 실패 시 무시 — API에서 재수집 */
    });
  }, [isLoading, loadFailed]);

  // krNames.json 로드 → 완료 후 한글 종목명 적용 (초기 로딩 직후 즉시 실행)
  useEffect(() => {
    if (isLoading || loadFailed) return;
    let cancelled = false;

    // 초기 렌더 후 바로 실행 (idle까지 기다리지 않음 — 한글명 깜빡임 방지)
    const timerId = setTimeout(() => {
      if (cancelled) return;
      preloadKrNames()
        .then(() => {
          if (cancelled) return;
          const currentData = useAppStore.getState().data;
          if (!currentData) return;
          const { data: updated, changed } = applyKoreanStockNames(currentData);
          if (changed) {
            useAppStore.setState({ data: updated });
            try { saveData(updated); } catch { /* quota 등 무시 */ }
          }
        })
        .catch(() => { /* 실패 시 한글명 없이 진행 */ });
    }, 0);

    return () => { cancelled = true; clearTimeout(timerId); };
  }, [isLoading, loadFailed]);

  /** 로드 실패 후 백업 복원했을 때 저장 허용용 */
  const clearLoadFailed = useCallback(() => {
    setLoadFailed(false);
  }, []);

  return {
    data,
    setData,
    isLoading,
    loadFailed,
    clearLoadFailed
  };
}
