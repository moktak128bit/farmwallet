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

    const integrity = await getLatestLocalBackupIntegrity();
    setBackupIntegrity(integrity);
    setBackupVersion(Date.now());
  }, []);

  useEffect(() => {
    void refreshLatestBackup();
  }, [refreshLatestBackup]);

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
