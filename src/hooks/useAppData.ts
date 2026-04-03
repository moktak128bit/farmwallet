import { useEffect, useState, useCallback } from "react";
import { loadData, preloadKrNames, applyKoreanStockNames, saveData } from "../storage";
import { useAppStore } from "../store/appStore";

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
