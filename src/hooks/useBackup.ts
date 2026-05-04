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
import { useUIStore } from "../store/uiStore";

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
  /**
   * 마지막으로 디스크에 commit된 payload. boot 시 localStorage의 현재 값으로 초기화 →
   * loadData() 후 round-trip된 동일 data가 들어와도 "이미 저장됨"으로 인식해
   * 거짓 saveStatus·dirty·draft write를 막는다 (마이그레이션이 있었다면 정상적으로 한 번 save).
   */
  const lastSavedPayloadRef = useRef<string>(
    typeof window !== "undefined"
      ? (() => { try { return window.localStorage.getItem(STORAGE_KEYS.DATA) ?? ""; } catch { return ""; } })()
      : ""
  );
  const isAutoBackupRunningRef = useRef(false);
  const lastAutoBackupAtRef = useRef(0);
  /** 디바운스 타이머/즉시 flush 양쪽이 같은 최신 data를 참조하도록 */
  const dataRef = useRef(data);
  dataRef.current = data;

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
        // unload flush가 성공했다면 드래프트 슬롯도 정리 — 다음 boot에서 거짓 복구 방지
        try {
          window.localStorage.removeItem(STORAGE_KEYS.DRAFT);
          window.localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
        } catch { /* */ }
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

  /**
   * 디바운스/즉시 flush 양쪽이 호출하는 실제 저장 루틴.
   * 최신 dataRef를 직렬화 → dedup → saveStatus("saving") → setItem → 드래프트 클리어 →
   * saveStatus("saved") → broadcast + (옵션) 백업.
   */
  const runAutoSave = useCallback(() => {
    if (typeof window === "undefined") return;
    const ui = useUIStore.getState();
    const payload = JSON.stringify(dataRef.current);
    if (!payload || payload === lastSavedPayloadRef.current) {
      // dedup: 저장할 게 없음 → 상태 깜빡임 없이 종료. dirty 신호만 정리.
      ui.setHasDirtyChanges(false);
      return;
    }

    ui.setSaveStatus("saving");
    try {
      saveDataSerialized(payload);
      lastSavedPayloadRef.current = payload;
      // 정상 저장 → 드래프트 슬롯 정리
      try {
        window.localStorage.removeItem(STORAGE_KEYS.DRAFT);
        window.localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
      } catch { /* quota·access 무시 */ }
      ui.setHasDirtyChanges(false);
      ui.setSaveStatus("saved");
      notifyDataChanged(payload);
    } catch (error) {
      console.warn("[useBackup] auto save failed", error);
      const message = error instanceof Error ? error.message : "자동 저장에 실패했습니다.";
      ui.setSaveStatus("error", message);
      toast.error(message, { id: AUTO_SAVE_ERROR_TOAST_ID });
      return;
    }

    const backupOnSave = window.localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true";
    if (!backupOnSave) return;

    const now = Date.now();
    if (isAutoBackupRunningRef.current) return;
    if (now - lastAutoBackupAtRef.current < AUTO_BACKUP_INTERVAL_MS) return;

    isAutoBackupRunningRef.current = true;
    void saveBackupSnapshot(dataRef.current, {
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

    // 디스크 마지막 값과 다르면 dirty 윈도우 진입 — 탭 충돌 감지의 신호.
    // 또한 크래시 윈도우 축소를 위해 드래프트 슬롯을 즉시 write-through.
    const pendingPayload = JSON.stringify(data);
    if (pendingPayload && pendingPayload !== lastSavedPayloadRef.current) {
      useUIStore.getState().setHasDirtyChanges(true);
      try {
        window.localStorage.setItem(STORAGE_KEYS.DRAFT, pendingPayload);
        window.localStorage.setItem(STORAGE_KEYS.DRAFT_AT, Date.now().toString());
      } catch { /* quota·access 무시 — 드래프트는 best-effort */ }
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      runAutoSave();
    }, AUTO_SAVE_DELAY);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [data, runAutoSave]);

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

  /**
   * 대기 중인 디바운스 타이머를 즉시 실행.
   * 탭 충돌 모달의 "내 변경 유지" 액션이나 외부에서 강제 저장이 필요한 경우 사용.
   */
  const flushPendingSave = useCallback(() => {
    if (typeof window === "undefined") return;
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    runAutoSave();
  }, [runAutoSave]);

  /**
   * 대기 중인 변경을 폐기하고 외부에서 들어온 payload를 "이미 저장된 것"으로 인식시킴.
   * 탭 충돌 모달의 "다른 탭 변경 적용" 액션에서 호출 — 호출 측에서 store도 함께 갱신해야 함.
   * 이 함수는 dirty/draft만 정리하고 broadcast나 setItem은 하지 않는다 (이미 다른 탭이 했음).
   */
  const discardPendingSaveAndApply = useCallback((appliedPayload: string) => {
    if (typeof window === "undefined") return;
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    lastSavedPayloadRef.current = appliedPayload;
    try {
      window.localStorage.removeItem(STORAGE_KEYS.DRAFT);
      window.localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
    } catch { /* */ }
    const ui = useUIStore.getState();
    ui.setHasDirtyChanges(false);
    ui.setSaveStatus("saved");
  }, []);

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
    backupWarning: getBackupWarning(),
    flushPendingSave,
    discardPendingSaveAndApply
  };
}
