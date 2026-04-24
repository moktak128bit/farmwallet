import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllBackupList,
  getLatestLocalBackupIntegrity,
  saveBackupSnapshot,
  saveDataSerialized
} from "../storage";
import type { AppData } from "../types";
import { toast } from "react-hot-toast";
import {
  AUTO_BACKUP_INTERVAL_MS,
  AUTO_SAVE_DELAY,
  BACKUP_CONFIG,
  BACKUP_WARNING_HOURS,
  STORAGE_KEYS
} from "../constants/config";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { notifyDataChanged } from "../services/tabSync";

export interface BackupIntegrity {
  createdAt: string | null;
  status: "valid" | "missing-hash" | "mismatch" | "none";
}

const AUTO_SAVE_ERROR_TOAST_ID = "auto-save-error";

export type UseBackupOptions = { onLog?: (message: string, type?: "success" | "error" | "info") => void };

export function useBackup(data: AppData, options?: UseBackupOptions) {
  const onLog = options?.onLog;
  const [latestBackupAt, setLatestBackupAt] = useState<string | null>(null);
  const [backupVersion, setBackupVersion] = useState<number>(0);
  const [backupIntegrity, setBackupIntegrity] = useState<BackupIntegrity>({
    createdAt: null,
    status: "none"
  });

  const autoSaveTimerRef = useRef<number | null>(null);
  const hasMountedRef = useRef(false);
  const lastSavedPayloadRef = useRef<string>("");
  const isAutoBackupRunningRef = useRef(false);
  const lastAutoBackupAtRef = useRef(0);

  const refreshLatestBackup = useCallback(async () => {
    const list = await getAllBackupList();
    const latest = list[0];
    setLatestBackupAt(latest?.createdAt ?? null);

    const latestMs = latest?.createdAt ? Date.parse(latest.createdAt) : NaN;
    if (Number.isFinite(latestMs) && latestMs > 0) {
      lastAutoBackupAtRef.current = latestMs;
    }

    /** JSON.stringify+해시는 메인 스레드 부담 → idle 시점으로 미룸 */
    const runIntegrity = () => {
      void getLatestLocalBackupIntegrity()
        .then((integrity) => {
          setBackupIntegrity(integrity);
          setBackupVersion(Date.now());
        })
        .catch(() => {
          setBackupIntegrity({ createdAt: null, status: "none" });
          setBackupVersion(Date.now());
        });
    };

    if (typeof window === "undefined") {
      runIntegrity();
      return;
    }

    const win = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(() => runIntegrity(), { timeout: 4000 });
    } else {
      window.setTimeout(runIntegrity, 0);
    }
  }, []);

  useEffect(() => {
    void refreshLatestBackup();
  }, [refreshLatestBackup]);

  // 탭 닫힘/새로고침 직전 pending 자동저장을 flush — 500ms 디바운스 중 F5 → 유실 방지
  // beforeunload는 동기적이므로 retry 루프 없이 단발 setItem만 시도. 실패 시 콘솔 로깅만.
  // pagehide는 모바일 (특히 iOS Safari)에서 더 안정적인 종료 시그널.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      try {
        const payload = JSON.stringify(data);
        if (!payload || payload === lastSavedPayloadRef.current) return;
        // 동기 저장만 — async retry 루프는 unload 도중 잘릴 수 있음.
        window.localStorage.setItem(STORAGE_KEYS.DATA, payload);
        lastSavedPayloadRef.current = payload;
        notifyDataChanged(payload);
      } catch (err) {
        console.warn("[useBackup] beforeunload flush failed", err);
      }
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      const payload = JSON.stringify(data);
      if (!payload || payload === lastSavedPayloadRef.current) return;

      try {
        saveDataSerialized(payload);
        lastSavedPayloadRef.current = payload;
        notifyDataChanged(payload);
      } catch (error) {
        console.warn("[useBackup] auto save failed", error);
        const message = error instanceof Error ? error.message : "자동 저장에 실패했습니다.";
        toast.error(message, { id: AUTO_SAVE_ERROR_TOAST_ID });
        return;
      }

      const backupOnSave = window.localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true";
      if (!backupOnSave) return;

      const now = Date.now();
      if (isAutoBackupRunningRef.current) return;
      if (now - lastAutoBackupAtRef.current < AUTO_BACKUP_INTERVAL_MS) return;

      isAutoBackupRunningRef.current = true;
      void saveBackupSnapshot(data, {
        skipHash: true,
        dataJson: payload,
        timeoutMs: BACKUP_CONFIG.API_TIMEOUT_MS
      })
        .then(async (result) => {
          if (result.fileSaved || result.localSaved) {
            lastAutoBackupAtRef.current = Date.now();
            await refreshLatestBackup();
            if (result.localError) {
              console.warn("[useBackup] auto backup local warning:", result.localError);
            }
            return;
          }
          console.warn("[useBackup] auto backup failed", {
            fileError: result.fileError,
            localError: result.localError
          });
        })
        .catch((error) => {
          console.warn("[useBackup] auto backup exception", error);
        })
        .finally(() => {
          isAutoBackupRunningRef.current = false;
        });
    }, AUTO_SAVE_DELAY);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [data, refreshLatestBackup]);

  const handleManualBackup = useCallback(async () => {
    const toastId = "manual-backup";
    onLog?.("백업 시작...", "info");
    toast.loading("백업 저장 중...", { id: toastId });

    try {
      const payload = JSON.stringify(data);
      saveDataSerialized(payload);

      const result = await saveBackupSnapshot(data, {
        skipHash: false,
        dataJson: payload,
        timeoutMs: BACKUP_CONFIG.API_TIMEOUT_MS
      });

      if (!result.fileSaved && !result.localSaved) {
        const reason = [result.fileError, result.localError].filter(Boolean).join(" / ");
        throw new Error(reason || ERROR_MESSAGES.BACKUP_SAVE_FAILED);
      }

      await refreshLatestBackup();

      if (result.fileSaved && result.localSaved) {
        onLog?.("백업 완료.", "success");
        toast.success("백업 저장 완료", { id: toastId });
        return;
      }

      const partialReason = result.fileSaved
        ? `파일 저장 성공, 로컬 저장 실패 (${result.localError ?? "원인 미상"})`
        : `로컬 저장 성공, 파일 저장 실패 (${result.fileError ?? "원인 미상"})`;
      onLog?.(`부분 백업 완료: ${partialReason}`, "success");
      toast.success(`부분 백업 완료: ${partialReason}`, { id: toastId });
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : ERROR_MESSAGES.BACKUP_SAVE_FAILED;
      onLog?.(`백업 실패: ${message}`, "error");
      console.error("[useBackup] manual backup failed:", error);
      toast.error(message, { id: toastId });
    }
  }, [data, refreshLatestBackup, onLog]);

  const getBackupWarning = () => {
    if (!latestBackupAt) return null;
    const diffHours = (Date.now() - new Date(latestBackupAt).getTime()) / 36e5;
    if (diffHours >= BACKUP_WARNING_HOURS.CRITICAL) {
      return { type: "critical" as const, message: "24시간 이상 백업이 없습니다. 지금 백업을 권장합니다." };
    }
    if (diffHours >= BACKUP_WARNING_HOURS.WARNING) {
      return { type: "warning" as const, message: "12시간 이상 경과했습니다. 백업이 필요합니다." };
    }
    return null;
  };

  return {
    latestBackupAt,
    backupVersion,
    backupIntegrity,
    handleManualBackup,
    refreshLatestBackup,
    backupWarning: getBackupWarning()
  };
}
