import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { loadData, saveData, getEmptyData, saveBackupSnapshot } from "../storage";
import { STORAGE_KEYS } from "../constants/config";
import type { AppData } from "../types";
import { AUTO_SAVE_DELAY } from "../constants/config";

export function useAppData() {
  const [data, setData] = useState<AppData>(() => getEmptyData());
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadFailedRef = useRef(false);
  loadFailedRef.current = loadFailed;
  const saveTimerRef = useRef<number | null>(null);
  const manualBackupRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  // 초기 데이터 로드 (한 번만)
  useEffect(() => {
    try {
      setData(loadData());
      setLoadFailed(false);
    } catch (e) {
      console.error("[FarmWallet] 초기 데이터 로드 실패", e);
      setLoadFailed(true);
    }
    setIsLoading(false);
  }, []);

  // 데이터 변경 시 자동 저장 (로드 실패 시 덮어쓰지 않음)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loadFailedRef.current) return;
    if (manualBackupRef.current) return; // 수동 백업 중에는 자동 저장 스킵
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      if (manualBackupRef.current) return;
      try {
        saveData(data);
        if (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true") {
          void saveBackupSnapshot(data, { skipHash: false });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "저장 실패");
      }
      saveTimerRef.current = null;
    }, AUTO_SAVE_DELAY);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [data]);

  // 탭/창 닫기 전 저장 대기 중이면 즉시 저장
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flushSave = () => {
      if (loadFailedRef.current) return;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        try {
          saveData(dataRef.current);
          if (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true") {
            void saveBackupSnapshot(dataRef.current, { skipHash: false });
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "저장 실패");
        }
      }
    };
    const handleBeforeUnload = () => {
      flushSave();
    };
    const handlePageHide = () => {
      flushSave();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  const setManualBackupFlag = useCallback((flag: boolean) => {
    manualBackupRef.current = flag;
  }, []);

  const saveNow = useCallback(() => {
    if (loadFailedRef.current) return;
    try {
      saveData(dataRef.current);
      if (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true") {
        void saveBackupSnapshot(dataRef.current, { skipHash: false });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    }
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
    clearLoadFailed,
    setManualBackupFlag,
    saveNow
  };
}
