import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllBackupList,
  getLatestLocalBackupIntegrity,
  saveBackupSnapshot,
  saveDataSerialized,
  toUserDataJson,
  clearOldBackups,
  isBackupOnSaveEnabled
} from "../storage";
import type { AppData } from "../types";
import { toast } from "react-hot-toast";
import {
  AUTO_BACKUP_INTERVAL_MS,
  AUTO_SAVE_DELAY,
  BACKUP_CONFIG,
  BACKUP_WARNING_HOURS,
  DATA_SCHEMA_VERSION,
  STORAGE_KEYS
} from "../constants/config";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { notifyDataChanged } from "../services/tabSync";
import { isBackupStoreLocalStorage } from "../services/backupService";
import { useUIStore } from "../store/uiStore";

interface BackupIntegrity {
  createdAt: string | null;
  status: "valid" | "missing-hash" | "mismatch" | "none";
}

const AUTO_SAVE_ERROR_TOAST_ID = "auto-save-error";

/** localStorage quota 초과 판정 — 브라우저별 name/code 차이 + 메시지 폴백 */
function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  // saveDataSerialized는 한국어 문구로 감싸 던지고 원래 오류는 cause에 둔다
  if (error instanceof Error && error.cause !== undefined && isQuotaExceededError(error.cause)) return true;
  const msg = error instanceof Error ? error.message.toLowerCase() : "";
  return msg.includes("quota") || msg.includes("exceeded the storage");
}

/** 마지막 DATA 본 저장 시각을 기록 — 새로고침 뒤에도 '백업 이후 쓴 내용' 판정이 이어지게 (quota·access 실패는 무시) */
function persistLastWriteAt(ms: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.LAST_DATA_WRITE_AT, String(ms));
  } catch { /* best-effort */ }
}

function readLastWriteAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(window.localStorage.getItem(STORAGE_KEYS.LAST_DATA_WRITE_AT));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

type UseBackupOptions = {
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
  /** 첫 백업 목록 조회가 끝났는지 — 끝나기 전엔 latestBackupAt=null이 '백업 없음'인지 '아직 모름'인지 구분 못 해 경고하지 않는다 */
  const [backupListLoaded, setBackupListLoaded] = useState(false);
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
  /**
   * 마지막으로 실제 디스크 쓰기가 일어난 시각 — 그 뒤 백업이 있으면 '백업 권장' 경고를 끈다(조회만 한 날 거짓 경고 방지).
   * 부팅 시 LAST_DATA_WRITE_AT에서 복원 — 0으로 시작하면 지난 세션의 미백업 쓰기가 '안 썼음'으로 판정돼 경고가 사라진다.
   */
  const [bootLastWriteAt] = useState(readLastWriteAt); // 렌더마다 localStorage를 읽지 않게 최초 1회만
  const lastWriteAtRef = useRef(bootLastWriteAt);
  /** 디바운스 타이머/즉시 flush 양쪽이 같은 최신 data를 참조하도록 */
  const dataRef = useRef(data);
  dataRef.current = data;

  const refreshLatestBackup = useCallback(async () => {
    const list = await getAllBackupList();
    const latest = list[0];
    setLatestBackupAt(latest?.createdAt ?? null);
    setBackupListLoaded(true);

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
        // 분리 저장 정책 준수: DATA 키에는 캐시(prices/tickerDatabase/historicalDailyCloses)를
        // 제외한 사용자 데이터만 기록 (full payload를 넣으면 다음 정상 저장까지 키 용량이 부풀음).
        // dedup·broadcast·dirty 비교는 모두 이 user-only 문자열 기준으로 통일 — tabSync가 읽는
        // localStorage DATA 값과 동일 표현이라야 해시가 일치한다 (full payload면 항상 불일치).
        const userDataStr = toUserDataJson(dataRef.current);
        if (!userDataStr || userDataStr === lastSavedPayloadRef.current) return;
        try {
          // 동기 저장만 — async retry 루프는 unload 도중 잘릴 수 있음.
          window.localStorage.setItem(STORAGE_KEYS.DATA, userDataStr);
          // 스키마 버전도 함께 기록 — 신규 사용자가 첫 변경 직후 정상 저장 없이 종료하면
          // 다음 부팅에서 스키마 버전 키가 비어(=1) v3 등 마이그레이션이 현행 데이터에 재실행돼
          // 비-idempotent한 v3 할인 차감이 금액을 한 번 더 깎는 손상을 방지한다.
          window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, String(DATA_SCHEMA_VERSION));
        } catch (writeErr) {
          // 본 저장 실패(quota 등) — 드래프트 슬롯에라도 기록을 시도해 다음 부팅에서 복구 가능하게.
          // 캐시 제외한 user payload(userDataStr)로 — full payload는 더 커서 quota 상황에서 또 실패.
          try {
            window.localStorage.setItem(STORAGE_KEYS.DRAFT, userDataStr);
            window.localStorage.setItem(STORAGE_KEYS.DRAFT_AT, Date.now().toString());
          } catch { /* quota — 더 이상 손쓸 수 없음 */ }
          console.warn("[useBackup] unload flush 저장 실패 — 드래프트 기록 시도", writeErr);
          return;
        }
        lastSavedPayloadRef.current = userDataStr;
        // 디바운스 중 닫은 마지막 편집도 '백업 이후 쓴 내용'으로 남긴다
        const flushedAt = Date.now();
        lastWriteAtRef.current = flushedAt;
        persistLastWriteAt(flushedAt);
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
  const runAutoSave = useCallback((knownUserPayload?: string) => {
    if (typeof window === "undefined") return;
    // 로드 실패 상태에서는 저장 금지 — 복구 가능한 원본 localStorage 보호
    if (disabledRef.current) return;
    const ui = useUIStore.getState();
    // dedup·broadcast·dirty 비교는 user-only 문자열(캐시 3필드 제외) 기준으로 통일한다.
    // tabSync가 읽는 localStorage DATA 값과 동일 표현이라야 방송 해시가 일치하고,
    // full payload(prices 등 포함)를 넣으면 수신 탭이 영원히 불일치로 판정해 변경이 드롭된다.
    // 디바운스 경로는 effect에서 만든 user payload를 재사용해 중복 stringify를 피한다.
    const userPayload = knownUserPayload ?? toUserDataJson(dataRef.current);
    if (!userPayload || userPayload === lastSavedPayloadRef.current) {
      // dedup: 저장할 게 없음 → 상태 깜빡임 없이 종료. dirty 신호만 정리.
      ui.setHasDirtyChanges(false);
      // 실패 뒤 되돌리기로 디스크 내용과 같아졌다면 직전 '저장 실패' 표시도 정리한다
      if (userPayload && ui.saveStatus === "error") ui.setSaveStatus("saved");
      return;
    }
    // 실제 저장·백업에는 캐시 포함 full payload가 필요 (saveDataSerialized가 IDB 캐시 분리 저장).
    const fullPayload = JSON.stringify(dataRef.current);

    ui.setSaveStatus("saving");
    try {
      saveDataSerialized(fullPayload);
      lastSavedPayloadRef.current = userPayload;
      const writtenAt = Date.now();
      lastWriteAtRef.current = writtenAt;
      persistLastWriteAt(writtenAt);
      // 정상 저장 → 드래프트 슬롯 정리
      try {
        window.localStorage.removeItem(STORAGE_KEYS.DRAFT);
        window.localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
      } catch { /* quota·access 무시 */ }
      ui.setHasDirtyChanges(false);
      ui.setSaveStatus("saved");
      notifyDataChanged(userPayload);
    } catch (error) {
      console.warn("[useBackup] auto save failed", error);
      const message = error instanceof Error ? error.message : "자동 저장에 실패했습니다.";
      ui.setSaveStatus("error", message);
      // quota 초과: 오래된 백업을 자동 정리하고 1회 재시도 (저장 공간 막힘은 장기 사용자의 가장 현실적인 차단)
      // 정리는 백업이 localStorage 폴백에 있을 때만 — IndexedDB 백업은 별도 한도라 지워도 DATA 저장은 그대로
      // 실패하고 복원 지점(안전 스냅샷 포함)만 영구히 잃는다. 그때는 정리 없이 용량 안내만 띄운다.
      if (isQuotaExceededError(error)) {
        const dataAtFailure = dataRef.current;
        const showQuotaError = () =>
          toast.error(
            "저장 공간이 가득 찼습니다. 설정 > 고급 / 진단 > 저장 공간 사용량에서 큰 항목을 확인해 주세요.",
            { id: AUTO_SAVE_ERROR_TOAST_ID, duration: 8000 }
          );
        void isBackupStoreLocalStorage()
          .then((isLocal) => (isLocal ? clearOldBackups(3) : 0))
          .then((removed) => {
            // 정리 중에 더 새로운 변경이 들어왔으면 재시도하지 않는다 — 오래된 payload로 최신 저장을 덮지 않게.
            // (새 변경은 자체 디바운스 저장에서 다시 시도한다)
            if (dataRef.current !== dataAtFailure) return;
            if (removed > 0) {
              try {
                saveDataSerialized(fullPayload);
                lastSavedPayloadRef.current = userPayload;
                const retriedAt = Date.now();
                lastWriteAtRef.current = retriedAt;
                persistLastWriteAt(retriedAt);
                try {
                  window.localStorage.removeItem(STORAGE_KEYS.DRAFT);
                  window.localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
                } catch { /* */ }
                ui.setHasDirtyChanges(false);
                ui.setSaveStatus("saved");
                notifyDataChanged(userPayload);
                void refreshLatestBackup();
                toast.success(`저장 공간이 부족해 오래된 백업 ${removed}개를 정리하고 저장했습니다.`, {
                  id: AUTO_SAVE_ERROR_TOAST_ID
                });
                return;
              } catch (retryErr) {
                console.warn("[useBackup] quota 재시도 실패", retryErr);
              }
            }
            showQuotaError();
          })
          .catch((clearErr: unknown) => {
            console.warn("[useBackup] 오래된 백업 정리 실패", clearErr);
            showQuotaError();
          });
        return;
      }
      toast.error(message, { id: AUTO_SAVE_ERROR_TOAST_ID });
      return;
    }

    // 저장 시 스냅샷 — 설정이 없으면 기본 on (저장소가 IndexedDB라 용량 부담이 없다)
    if (!isBackupOnSaveEnabled()) return;

    const now = Date.now();
    if (isAutoBackupRunningRef.current) return;
    if (now - lastAutoBackupAtRef.current < AUTO_BACKUP_INTERVAL_MS) return;

    isAutoBackupRunningRef.current = true;
    void saveBackupSnapshot(dataRef.current, {
      skipHash: true,
      dataJson: fullPayload,
      // 로컬 백업 본문은 user-only — 이미 만들어 둔 userPayload를 넘겨 재직렬화 생략
      userDataJson: userPayload,
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
    // user-only 표현으로 비교 — lastSavedPayloadRef(부팅 시 localStorage DATA로 초기화)와 같은
    // 형태라야 한다. full payload로 비교하면 캐시 하이드레이션마다 항상 dirty로 오판해
    // 무변경 데이터를 재저장·방송하고 다른 탭에 가짜 충돌 모달을 띄운다.
    const pendingUserPayload = toUserDataJson(data);
    const isDirty = Boolean(pendingUserPayload) && pendingUserPayload !== lastSavedPayloadRef.current;
    if (isDirty) {
      useUIStore.getState().setHasDirtyChanges(true);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      // 드래프트 슬롯은 저장 직전 1회만 기록 — 매 변경마다 대용량 write-through 하지 않는다.
      // (크래시 보호 윈도우가 디바운스 길이만큼 늘어나는 대신 localStorage 쓰기 횟수가 줄어듦.
      //  저장 실패(quota 등) 시에는 드래프트가 남아 다음 boot에서 복구 가능.)
      // 대기 중 수동 백업 등이 같은 내용을 이미 썼으면 드래프트도 남기지 않는다(곧 dedup되어 정리되지 않음)
      if (isDirty && pendingUserPayload !== lastSavedPayloadRef.current) {
        try {
          // 드래프트에도 캐시(prices/tickerDatabase/historicalDailyCloses)는 제외 — full payload는
          // 메인 DATA보다 커서 quota 압박 시 드래프트 write까지 동반 실패한다. 캐시는 부팅 시
          // IndexedDB에서 하이드레이션되므로 복구에 불필요. (메인 DATA와 같은 형태라 stale 비교도 정상 동작)
          window.localStorage.setItem(STORAGE_KEYS.DRAFT, pendingUserPayload);
          window.localStorage.setItem(STORAGE_KEYS.DRAFT_AT, Date.now().toString());
        } catch { /* quota·access 무시 — 드래프트는 best-effort */ }
      }
      runAutoSave(pendingUserPayload);
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
      // 디바운스 타이머·자동저장과 같은 최신 dataRef 기준 — 쓴 본문과 '저장됨' 기록이 같은 객체에서 나오게
      const current = dataRef.current;
      const payload = JSON.stringify(current);
      const userPayload = toUserDataJson(current);
      saveDataSerialized(payload);
      // 자동저장 성공 경로와 같은 기록 — 안 하면 대기 중인 디바운스가 같은 내용을 백업 뒤에 다시 써서
      // LAST_DATA_WRITE_AT이 백업보다 새로워지고, 12/24시간 뒤 거짓 '백업 권장'이 뜬다.
      // 타이머는 취소하지 않는다(그 사이 또 바뀌면 정상 저장, 같으면 dedup).
      const wroteNew = userPayload !== lastSavedPayloadRef.current;
      lastSavedPayloadRef.current = userPayload;
      if (wroteNew) {
        // '새 내용을 쓴 시각'만 기록(자동저장과 같은 의미) — 내용이 같으면 백업 이후 쓴 것이 없으므로
        // 갱신하면 스냅샷이 실패했을 때 데이터=백업인데도 '백업 권장' 경고가 새로 켜진다.
        const writtenAt = Date.now();
        lastWriteAtRef.current = writtenAt;
        persistLastWriteAt(writtenAt);
      }
      try {
        window.localStorage.removeItem(STORAGE_KEYS.DRAFT);
        window.localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
      } catch { /* quota·access 무시 */ }
      const ui = useUIStore.getState();
      ui.setHasDirtyChanges(false);
      // 쓰기에 성공했으므로 직전 '저장 실패' 상태는 내용이 같아도 정리한다
      ui.setSaveStatus("saved");
      // 디바운스가 dedup되면 방송이 사라지므로 새 내용을 쓴 이 경로가 대신 알린다
      if (wroteNew) notifyDataChanged(userPayload);

      const result = await saveBackupSnapshot(current, {
        skipHash: false,
        dataJson: payload,
        userDataJson: userPayload,
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

      // 한쪽만 성공 — 초록 성공 토스트에 '실패'를 섞지 않고 중립 토스트로 무엇이 남았는지 앞세운다
      const partialMessage = result.fileSaved
        ? `파일 사본 저장, 브라우저 저장 실패: ${result.localError ?? "원인 미상"}`
        : `백업 저장 완료(브라우저) — 파일 사본 실패: ${result.fileError ?? "원인 미상"}`;
      // 브라우저 백업(복원에 쓰는 쪽)이 실패했으면 error, 파일 사본만 실패면 info
      onLog?.(partialMessage, result.localSaved ? "info" : "error");
      toast(partialMessage, { id: toastId });
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : ERROR_MESSAGES.BACKUP_SAVE_FAILED;
      onLog?.(`백업 실패: ${message}`, "error");
      console.error("[useBackup] manual backup failed:", error);
      toast.error(message, { id: toastId });
    }
  }, [refreshLatestBackup, onLog]);

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
    // 첫 목록 조회 전에는 판단 보류 — 부팅 직후 latestBackupAt=null로 거짓 경고가 깜빡이지 않게
    if (!backupListLoaded) return null;
    if (!latestBackupAt) {
      // 백업이 하나도 없는데 쓴 내용이 있으면 경고(새 설치·조회만 한 경우는 조용히).
      // 저장 직후 자동 스냅샷이 도는 동안은 곧 백업이 생기므로 보류.
      if (lastWriteAtRef.current > 0 && !isAutoBackupRunningRef.current) {
        return { type: "warning" as const, message: "아직 로컬 백업이 없습니다. [저장]을 눌러 주세요." };
      }
      return null;
    }
    // 백업 이후 실제로 쓴 내용이 없으면 데이터 = 백업 → 경과 시간과 무관하게 경고하지 않는다
    if (lastWriteAtRef.current <= Date.parse(latestBackupAt)) return null;
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
