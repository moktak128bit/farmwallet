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

export type UseBackupOptions = {
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
  /**
   * true면 자동저장·unload flush·수동 백업을 모두 차단.
   * 데이터 로드 실패(loadFailed) 상태에서 빈/불완전 데이터가
   * 손상됐지만 복구 가능한 원본 localStorage를 덮어쓰는 것을 방지.
   */
  disabled?: boolean;
};

export function useBackup(data: AppData, options?: UseBackupOptions) {
  const onLog = options?.onLog;
  const disabledRef = useRef(options?.disabled === true);
  disabledRef.current = options?.disabled === true;
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
  // beforeunload는 동기적이므로 retry 루프 없이 단발 setItem만 시도.
  // pagehide는 모바일 (특히 iOS Safari)에서 더 안정적인 종료 시그널.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => {
      // 로드 실패 상태에서는 flush 금지 — 손상됐지만 복구 가능한 원본을 덮어쓰지 않는다
      if (disabledRef.current) return;
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      try {
        const payload = JSON.stringify(dataRef.current);
        if (!payload || payload === lastSavedPayloadRef.current) return;
        // 분리 저장 정책 준수: DATA 키에는 캐시(prices/tickerDatabase/historicalDailyCloses)를
        // 제외한 사용자 데이터만 기록 (full payload를 넣으면 다음 정상 저장까지 키 용량이 부풀음).
        const { prices: _p, tickerDatabase: _t, historicalDailyCloses: _h, ...userFields } = dataRef.current;
        const userDataStr = JSON.stringify(userFields);
        try {
          // 동기 저장만 — async retry 루프는 unload 도중 잘릴 수 있음.
          window.localStorage.setItem(STORAGE_KEYS.DATA, userDataStr);
        } catch (writeErr) {
          // 본 저장 실패(quota 등) — 드래프트 슬롯에라도 기록을 시도해 다음 부팅에서 복구 가능하게
          try {
            window.localStorage.setItem(STORAGE_KEYS.DRAFT, payload);
            window.localStorage.setItem(STORAGE_KEYS.DRAFT_AT, Date.now().toString());
          } catch { /* quota — 더 이상 손쓸 수 없음 */ }
          console.warn("[useBackup] unload flush 저장 실패 — 드래프트 기록 시도", writeErr);
          return;
        }
        lastSavedPayloadRef.current = payload;
        // unload flush가 성공했다면 드래프트 슬롯도 정리 — 다음 boot에서 거짓 복구 방지
        try {
          window.localStorage.removeItem(STORAGE_KEYS.DRAFT);
          window.localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
        } catch { /* */ }
        notifyDataChanged(userDataStr);
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
  }, []);

  /**
   * 디바운스/즉시 flush 양쪽이 호출하는 실제 저장 루틴.
   * 최신 dataRef를 직렬화 → dedup → saveStatus("saving") → setItem → 드래프트 클리어 →
   * saveStatus("saved") → broadcast + (옵션) 백업.
   */
  const runAutoSave = useCallback((knownPayload?: string) => {
    if (typeof window === "undefined") return;
    // 로드 실패 상태에서는 저장 금지 — 복구 가능한 원본 localStorage 보호
    if (disabledRef.current) return;
    const ui = useUIStore.getState();
    // 디바운스 경로는 effect에서 직렬화한 payload를 재사용해 중복 stringify를 피한다.
    const payload = knownPayload ?? JSON.stringify(dataRef.current);
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
    if (disabledRef.current) return; // 로드 실패 상태 — 자동저장 예약 금지
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    // 디스크 마지막 값과 다르면 dirty 윈도우 진입 — 탭 충돌 감지의 신호.
    const pendingPayload = JSON.stringify(data);
    const isDirty = Boolean(pendingPayload) && pendingPayload !== lastSavedPayloadRef.current;
    if (isDirty) {
      useUIStore.getState().setHasDirtyChanges(true);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      // 드래프트 슬롯은 저장 직전 1회만 기록 — 매 변경마다 대용량 write-through 하지 않는다.
      // (크래시 보호 윈도우가 디바운스 길이만큼 늘어나는 대신 localStorage 쓰기 횟수가 줄어듦.
      //  저장 실패(quota 등) 시에는 드래프트가 남아 다음 boot에서 복구 가능.)
      if (isDirty) {
        try {
          window.localStorage.setItem(STORAGE_KEYS.DRAFT, pendingPayload);
          window.localStorage.setItem(STORAGE_KEYS.DRAFT_AT, Date.now().toString());
        } catch { /* quota·access 무시 — 드래프트는 best-effort */ }
      }
      runAutoSave(pendingPayload);
    }, AUTO_SAVE_DELAY);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [data, runAutoSave]);

  const handleManualBackup = useCallback(async () => {
    if (disabledRef.current) {
      toast.error("데이터 로드 실패 상태에서는 백업할 수 없습니다. 먼저 복구를 진행하세요.");
      return;
    }
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

      // 프로덕션에서는 파일 저장 단계가 의도적으로 생략됨(fileSkipped) — 로컬 저장만으로 완전 성공
      const fileOk = result.fileSaved || result.fileSkipped === true;
      if (fileOk && result.localSaved) {
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
