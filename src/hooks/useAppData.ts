import { useEffect, useState, useCallback } from "react";
import { loadData, preloadKrNames } from "../storage";
import { useAppStore } from "../store/appStore";

export function useAppData() {
  const data = useAppStore((s) => s.data);
  const setData = useAppStore((s) => s.setData);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // 초기 데이터 로드 (한 번만) → Zustand store에 반영
  // setTimeout(0): 로딩 화면이 먼저 페인트된 뒤 무거운 JSON 파싱·마이그레이션 실행
  useEffect(() => {
    const id = setTimeout(() => {
      preloadKrNames()
        .catch(() => { /* 실패 시 한글명 없이 진행 */ })
        .then(() => {
          try {
            const loaded = loadData();
            useAppStore.setState({ data: loaded });
            setLoadFailed(false);
          } catch (e) {
            console.error("[FarmWallet] 초기 데이터 로드 실패", e);
            setLoadFailed(true);
          }
          setIsLoading(false);
        });
    }, 0);
    return () => clearTimeout(id);
  }, []);

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
