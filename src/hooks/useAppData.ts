import { useEffect, useState, useCallback } from "react";
import { loadData } from "../storage";
import { useAppStore } from "../store/appStore";

export function useAppData() {
  const data = useAppStore((s) => s.data);
  const setData = useAppStore((s) => s.setData);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // 초기 데이터 로드 (한 번만) → Zustand store에 반영
  useEffect(() => {
    try {
      const loaded = loadData();
      useAppStore.setState({ data: loaded });
      setLoadFailed(false);
    } catch (e) {
      console.error("[FarmWallet] 초기 데이터 로드 실패", e);
      setLoadFailed(true);
    }
    setIsLoading(false);
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
