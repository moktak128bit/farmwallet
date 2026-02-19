import { useEffect, useRef, useState, useCallback } from "react";
import { loadData, saveData } from "../storage";
import type { AppData } from "../types";
import { AUTO_SAVE_DELAY } from "../constants/config";

export function useAppData() {
  const [data, setData] = useState<AppData>(() => loadData());
  const saveTimerRef = useRef<number | null>(null);
  const manualBackupRef = useRef(false);

  // 데이터 변경 시 자동 저장
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (manualBackupRef.current) return; // 수동 백업 중에는 자동 저장 스킵
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      if (manualBackupRef.current) return;
      saveData(data);
      saveTimerRef.current = null;
    }, AUTO_SAVE_DELAY);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [data]);

  const setManualBackupFlag = useCallback((flag: boolean) => {
    manualBackupRef.current = flag;
  }, []);

  return {
    data,
    setData,
    setManualBackupFlag
  };
}
