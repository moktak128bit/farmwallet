import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../types";
import {
  saveToGist,
  saveToGistWithRetry,
  loadFromGist,
  getGistToken,
  getGistId,
  getGistAutoSync,
  setGistAutoSync,
  getGistLastPushAt,
  setGistLastPushAt,
  getGistLastPullAt,
  setGistLastPullAt,
  getGistVersions,
  detectConflict,
  hashGistPayload,
  getGistLastPushedHash,
  setGistLastPushedHash
} from "../services/gistSync";
import { toUserDataJson } from "../services/dataService";
import { GIST_AUTO_PUSH_DEBOUNCE_MS, GIST_STALE_WARNING_HOURS } from "../constants/config";
import { useUIStore } from "../store/uiStore";

const GIST_AUTO_SAVE_ERROR_TOAST_ID = "gist-auto-save-error";

interface UseGistSyncOptions {
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
}

export type GistConflictResolution = "apply-remote" | "force-push-local" | "cancel";

interface GistStaleWarning {
  type: "warning" | "critical";
  message: string;
  hoursSince: number;
}

interface UseGistSyncReturn {
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  lastPushAt: string | null;
  lastPullAt: string | null;
  isSyncing: boolean;
  /** Gist 충돌 모달에서 사용자가 액션을 선택했을 때 호출 */
  resolveGistConflict: (resolution: GistConflictResolution) => Promise<void>;
  /** N시간 이상 푸시 안 됐을 때 노출되는 경고 (자동 동기화 켜져 있을 때만) */
  gistStaleWarning: GistStaleWarning | null;
  /**
   * 수동 저장 — 디바운스·dirty 체크 건너뛰고 즉시 푸시.
   * React state(`lastPushAt`)와 localStorage 둘 다 갱신해서 헤더 "N시간 전" 표시가 즉시 반영됨.
   * 자동 동기화 OFF 상태에서도 사용 가능 (사용자 의도 우선).
   */
  manualPush: () => Promise<void>;
  /**
   * 수동 불러오기 — Gist 최신 데이터를 onApplyPulledData로 적용하고
   * lastPullAt·knownRemoteCommit·lastPushedPayload를 정식 경로와 동일하게 갱신.
   * (설정 카드의 "Gist에서 불러오기"가 상태 갱신을 우회하던 문제 해소)
   */
  manualPull: () => Promise<void>;
  /** Gist 과거 버전 복원 직후 동기화 상태 갱신 — 자동 push로 인한 조용한 롤백 방지 */
  syncStateAfterRestore: (dataJson: string, committedAt: string) => void;
}

/**
 * 자동 Gist 동기화 훅
 * - 앱 시작 시 Gist가 더 최신이면 자동 불러오기
 * - 데이터 변경 후 5분 뒤 자동 Gist 저장
 */
export function useGistSync(
  data: AppData,
  onApplyPulledData: (dataJson: string, remoteUpdatedAt: string) => void,
  options?: UseGistSyncOptions
): UseGistSyncReturn {
  const { onLog } = options ?? {};

  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(() => getGistAutoSync());
  const [lastPushAt, setLastPushAt] = useState<string | null>(() => getGistLastPushAt() || null);
  const [lastPullAt, setLastPullAt] = useState<string | null>(() => getGistLastPullAt() || null);
  const [isSyncing, setIsSyncing] = useState(false);

  const autoPushTimerRef = useRef<number | null>(null);
  const lastPushedPayloadRef = useRef<string>("");
  const hasMountedRef = useRef(false);
  const isPushingRef = useRef(false);
  const knownRemoteCommitRef = useRef<string>("");
  /** runAutoPush가 항상 최신 data를 직렬화하도록 — 디바운스 타이머 + visibility flush 양쪽이 공유 */
  const dataRef = useRef(data);
  dataRef.current = data;

  // Effect 1: 시작 시 자동 불러오기 (자동 동기화 ON 일 때만)
  // - Gist의 마지막 commit 시각이 로컬 lastPullAt 보다 최신이면 자동으로 불러옴
  // - 첫 활성화 시 강제로 풀 백업이 만들어진 뒤 동기화 (loadFromGist 응답을 그대로 적용 콜백에 전달)
  useEffect(() => {
    if (!autoSyncEnabled) return;
    if (hasMountedRef.current) return;
    // 토큰 검사보다 먼저 마운트 플래그를 세운다 — 부팅 시 토큰이 없었다가
    // 나중에 입력해도 Effect 2(자동 push)가 영구 비활성되지 않도록.
    hasMountedRef.current = true;
    if (!getGistToken() || !getGistId()) return;

    let cancelled = false;
    (async () => {
      try {
        setIsSyncing(true);
        const versions = await getGistVersions(1).catch(() => []);
        const latest = versions[0];
        knownRemoteCommitRef.current = latest?.committedAt ?? "";
        const localPull = getGistLastPullAt();
        const localPush = getGistLastPushAt();
        // 1) 원격이 마지막 pull보다 새로움 + 2) 원격이 우리의 마지막 push와 다름 (= 외부 기기가 변경)
        // 두 조건 모두 만족할 때만 pull. 하나라도 아니면 로컬에 미-push된 변경이 덮여 사라지는 것을 방지.
        const remoteIsNewerThanLastPull =
          !!latest && (!localPull || new Date(latest.committedAt) > new Date(localPull));
        const remoteIsFromExternalDevice =
          !!latest && (!localPush || new Date(latest.committedAt) > new Date(localPush));
        const remoteIsNewer = remoteIsNewerThanLastPull && remoteIsFromExternalDevice;
        if (!remoteIsNewer) {
          if (remoteIsNewerThanLastPull && !remoteIsFromExternalDevice) {
            // lastPushAt == remote.committedAt: 우리 푸시가 최신. lastPullAt을 맞춰 다음부터 불필요한 pull 방지
            setGistLastPullAt(latest!.committedAt);
            setLastPullAt(latest!.committedAt);
          }
          onLog?.("Gist 자동 동기화: 외부 변경 없음(건너뜀)", "info");
          return;
        }
        const { dataJson, updatedAt } = await loadFromGist();
        if (cancelled) return;
        // 로컬에 push되지 않은 변경이 있으면 무모달 덮어쓰기 금지 — 충돌 모달로 사용자 결정.
        // (마지막 push payload 해시와 현재 로컬 데이터 해시를 비교해 dirty 감지.
        //  해시 기록이 없는 구버전 상태에서는 기존 동작 유지 — 원격 적용.)
        const localJson = toUserDataJson(dataRef.current);
        const lastPushedHash = getGistLastPushedHash();
        const localDirty =
          !!lastPushedHash && hashGistPayload(localJson) !== lastPushedHash && localJson !== dataJson;
        if (localDirty) {
          useUIStore.getState().setGistConflict({
            remoteDataJson: dataJson,
            remoteUpdatedAt: updatedAt,
            pendingLocalDataJson: localJson,
          });
          onLog?.("Gist 자동 불러오기: 로컬에 push되지 않은 변경 감지 — 충돌 확인 필요", "info");
          return;
        }
        onApplyPulledData(dataJson, updatedAt);
        setGistLastPullAt(updatedAt);
        setLastPullAt(updatedAt);
        knownRemoteCommitRef.current = updatedAt;
        // pull 적용 후 로컬=원격 — 동일 payload 재push 방지 + 다음 부팅 dirty 기준 갱신
        lastPushedPayloadRef.current = dataJson;
        setGistLastPushedHash(hashGistPayload(dataJson));
        onLog?.("Gist 자동 불러오기 성공", "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.(`Gist 자동 불러오기 실패: ${message}`, "error");
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    })();

    return () => { cancelled = true; };
  }, [autoSyncEnabled, onApplyPulledData, onLog]);

  /**
   * 디바운스/즉시 flush 양쪽이 호출하는 실제 push 루틴.
   * 충돌 감지 → 충돌 모달 / 정상 → retry 래퍼로 push.
   * 일시적 오류는 saveToGistWithRetry가 내부 재시도, 영구 오류는 즉시 throw → toast.
   */
  const runAutoPush = useCallback(async () => {
    if (!autoSyncEnabled) return;
    if (!getGistToken() || !getGistId()) return;
    if (isPushingRef.current) return;
    if (useUIStore.getState().gistConflict) {
      onLog?.("Gist 충돌 모달이 열려 있어 자동 저장 보류", "info");
      return;
    }

    const dataJson = toUserDataJson(dataRef.current);
    if (dataJson === lastPushedPayloadRef.current) return;

    isPushingRef.current = true;
    try {
      setIsSyncing(true);
      const versions = await getGistVersions(1).catch(() => []);
      const latest = versions[0];
      const known = knownRemoteCommitRef.current || getGistLastPullAt();
      if (detectConflict(latest?.committedAt, known)) {
        // 시각상 원격이 새로 보여도, 내용이 우리가 마지막에 push한 것과 같으면 가짜 충돌
        // (gist updated_at vs commit committed_at 소스 차이). 내용 해시로 진짜 외부 변경만 모달 표시 →
        // "PC에서 수정했는데 자꾸 과거로 되돌리라"는 가짜 충돌 제거.
        try {
          const remote = await loadFromGist();
          const lastPushedHash = getGistLastPushedHash();
          if (lastPushedHash && hashGistPayload(remote.dataJson) === lastPushedHash) {
            knownRemoteCommitRef.current = latest?.committedAt || known;
            onLog?.("Gist: 시각만 다른 가짜 충돌(내용 동일) — 저장 진행", "info");
          } else {
            onLog?.("Gist 충돌 감지 — 외부 기기 변경 확인, 모달 표시", "info");
            useUIStore.getState().setGistConflict({
              remoteDataJson: remote.dataJson,
              remoteUpdatedAt: remote.updatedAt,
              pendingLocalDataJson: dataJson,
            });
            return;
          }
        } catch (pullErr) {
          const message = pullErr instanceof Error ? pullErr.message : String(pullErr);
          onLog?.(`Gist 충돌 후 원격 fetch 실패: ${message}`, "error");
          return;
        }
      }
      const result = await saveToGistWithRetry(dataJson, {
        onAttempt: (attempt, err) => {
          onLog?.(`Gist 푸시 ${attempt}회 실패 (${err.message}) — 재시도`, "info");
        }
      });
      lastPushedPayloadRef.current = dataJson;
      setGistLastPushedHash(hashGistPayload(dataJson));
      // 로컬 시각 사용 — GitHub updated_at이 약간 지연/stale일 수 있어 "방금 저장" 즉시 반영
      const nowIso = new Date().toISOString();
      setGistLastPushAt(nowIso);
      setLastPushAt(nowIso);
      // committed_at(getGistVersions와 동일 소스)을 known으로 — updated_at을 쓰면 다음 push에서
      // committed_at > updated_at 로 보여 매번 가짜 충돌이 떴음.
      knownRemoteCommitRef.current = result.committedAt || result.updatedAt || nowIso;
      onLog?.("Gist 자동 저장 성공", "success");
      // 이전 실패 토스트가 있다면 정리
      toast.dismiss(GIST_AUTO_SAVE_ERROR_TOAST_ID);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog?.(`Gist 자동 저장 실패: ${message}`, "error");
      // 토스트로 사용자에게 가시화 — 모바일에서 백그라운드 suspend 등 조용한 실패 방지
      toast.error(`Gist 저장 실패: ${message}`, { id: GIST_AUTO_SAVE_ERROR_TOAST_ID });
    } finally {
      isPushingRef.current = false;
      setIsSyncing(false);
    }
  }, [autoSyncEnabled, onLog]);

  /**
   * 수동 저장 — 사용자가 "저장" 버튼 클릭 시. 디바운스/dirty 체크 없이 즉시 푸시.
   * 자동 동기화 OFF 상태에서도 작동 (자동 동기화 가드 없음).
   * 동일 payload여도 푸시 — GitHub이 새 commit·새 updated_at 만들어 timestamp가 갱신됨.
   */
  const manualPush = useCallback(async () => {
    // gistId는 없어도 됨 — 첫 저장 시 saveToGist가 새 Gist를 생성하고 ID를 기록한다.
    if (!getGistToken()) {
      onLog?.("Gist 토큰 미설정", "error");
      toast.error("Gist 토큰을 먼저 설정하세요.");
      return;
    }
    if (isPushingRef.current) return;
    if (useUIStore.getState().gistConflict) {
      onLog?.("Gist 충돌 모달이 열려 있어 저장 보류", "info");
      return;
    }

    const dataJson = toUserDataJson(dataRef.current);

    // 진행 중인 디바운스 타이머가 있으면 취소 (수동 저장이 우선)
    if (autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
      autoPushTimerRef.current = null;
    }

    isPushingRef.current = true;
    try {
      setIsSyncing(true);
      // 충돌 감지 (자동 동기화 OFF여도 다른 기기에서 변경됐을 수 있으니 체크)
      const versions = await getGistVersions(1).catch(() => []);
      const latest = versions[0];
      const known = knownRemoteCommitRef.current || getGistLastPullAt();
      if (detectConflict(latest?.committedAt, known)) {
        // 시각상 원격이 새로 보여도, 내용이 우리가 마지막에 push한 것과 같으면 가짜 충돌
        // (gist updated_at vs commit committed_at 소스 차이). 내용 해시로 진짜 외부 변경만 모달 표시 →
        // "PC에서 수정했는데 자꾸 과거로 되돌리라"는 가짜 충돌 제거.
        try {
          const remote = await loadFromGist();
          const lastPushedHash = getGistLastPushedHash();
          if (lastPushedHash && hashGistPayload(remote.dataJson) === lastPushedHash) {
            knownRemoteCommitRef.current = latest?.committedAt || known;
            onLog?.("Gist: 시각만 다른 가짜 충돌(내용 동일) — 저장 진행", "info");
          } else {
            onLog?.("Gist 충돌 감지 — 외부 기기 변경 확인, 모달 표시", "info");
            useUIStore.getState().setGistConflict({
              remoteDataJson: remote.dataJson,
              remoteUpdatedAt: remote.updatedAt,
              pendingLocalDataJson: dataJson,
            });
            return;
          }
        } catch (pullErr) {
          const message = pullErr instanceof Error ? pullErr.message : String(pullErr);
          onLog?.(`Gist 충돌 후 원격 fetch 실패: ${message}`, "error");
          return;
        }
      }
      const result = await saveToGistWithRetry(dataJson, {
        onAttempt: (attempt, err) => {
          onLog?.(`Gist 푸시 ${attempt}회 실패 (${err.message}) — 재시도`, "info");
        }
      });
      lastPushedPayloadRef.current = dataJson;
      setGistLastPushedHash(hashGistPayload(dataJson));
      // 로컬 시각 사용 — GitHub 응답의 updated_at이 stale일 수 있어 사용자 체감과 어긋남 방지
      const nowIso = new Date().toISOString();
      setGistLastPushAt(nowIso);
      setLastPushAt(nowIso);
      // committed_at(getGistVersions와 동일 소스)을 known으로 — updated_at을 쓰면 다음 push에서
      // committed_at > updated_at 로 보여 매번 가짜 충돌이 떴음.
      knownRemoteCommitRef.current = result.committedAt || result.updatedAt || nowIso;
      onLog?.("Gist 저장 성공", "success");
      toast.dismiss(GIST_AUTO_SAVE_ERROR_TOAST_ID);
      toast.success("Gist 저장 완료");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog?.(`Gist 저장 실패: ${message}`, "error");
      toast.error(`Gist 저장 실패: ${message}`, { id: GIST_AUTO_SAVE_ERROR_TOAST_ID });
    } finally {
      isPushingRef.current = false;
      setIsSyncing(false);
    }
  }, [onLog]);

  /**
   * 수동 불러오기 — 설정 카드의 "Gist에서 불러오기"용 정식 pull 경로.
   * lastPullAt(localStorage+state)·knownRemoteCommitRef·lastPushedPayloadRef를 모두 갱신해
   * 다음 자동 push 때 가짜 충돌 모달이 뜨지 않게 한다.
   * 데이터 검증·안전 스냅샷은 onApplyPulledData(App.handleGistPulledData) 내부에서 수행.
   */
  const manualPull = useCallback(async () => {
    if (!getGistToken() || !getGistId()) {
      onLog?.("Gist 토큰·ID 미설정", "error");
      toast.error("Gist 토큰과 ID를 먼저 설정하세요.");
      return;
    }
    if (useUIStore.getState().gistConflict) {
      onLog?.("Gist 충돌 모달이 열려 있어 불러오기 보류", "info");
      return;
    }
    try {
      setIsSyncing(true);
      const { dataJson, updatedAt } = await loadFromGist();
      onApplyPulledData(dataJson, updatedAt);
      setGistLastPullAt(updatedAt);
      setLastPullAt(updatedAt);
      knownRemoteCommitRef.current = updatedAt;
      lastPushedPayloadRef.current = dataJson;
      setGistLastPushedHash(hashGistPayload(dataJson));
      onLog?.("Gist에서 불러오기 완료", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog?.(`Gist 불러오기 실패: ${message}`, "error");
      toast.error(`Gist 불러오기 실패: ${message}`);
    } finally {
      setIsSyncing(false);
    }
  }, [onApplyPulledData, onLog]);

  // Effect 2: 데이터 변경 시 자동 저장 (debounced)
  useEffect(() => {
    if (!autoSyncEnabled) return;
    if (!getGistToken() || !getGistId()) return;
    if (!hasMountedRef.current) return;

    const dataJson = toUserDataJson(data);
    if (dataJson === lastPushedPayloadRef.current) return;

    if (autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
    }

    autoPushTimerRef.current = window.setTimeout(() => {
      autoPushTimerRef.current = null;
      void runAutoPush();
    }, GIST_AUTO_PUSH_DEBOUNCE_MS);

    return () => {
      if (autoPushTimerRef.current) {
        window.clearTimeout(autoPushTimerRef.current);
        autoPushTimerRef.current = null;
      }
    };
  }, [autoSyncEnabled, data, runAutoPush]);

  // Effect 3: 모바일 백그라운드 suspend 방지용 즉시 flush + 오프라인 복귀 시 재개.
  // visibilitychange:hidden — 앱 전환·화면 잠금 시점. setTimeout이 정지·지연되기 전에 push.
  // pagehide — 페이지가 실제로 unload되는 시점 (iOS Safari에서 신뢰성 ↑).
  // online — 장시간 오프라인 후 복귀. dirty면 1회 push (다음 변경까지 기다리면 다른 기기 변경에 덮일 위험).
  // 모두 dirty가 있을 때만 작동(runAutoPush의 가드가 재진입 방지), 디바운스 타이머는 cancel 후 즉시 push.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!autoSyncEnabled) return;
    if (!hasMountedRef.current) return;

    const flush = () => {
      if (!getGistToken() || !getGistId()) return;
      const dataJson = toUserDataJson(dataRef.current);
      if (dataJson === lastPushedPayloadRef.current) return;
      if (autoPushTimerRef.current) {
        window.clearTimeout(autoPushTimerRef.current);
        autoPushTimerRef.current = null;
      }
      // 페이지가 곧 죽을 수 있어 await하지 않음 — 브라우저가 in-flight fetch를 잠시 살려둠 (보통 ~30s)
      void runAutoPush();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onOnline = () => {
      onLog?.("네트워크 복귀 — 미저장 변경이 있으면 Gist 푸시 재개", "info");
      flush();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", onOnline);
    };
  }, [autoSyncEnabled, runAutoPush, onLog]);

  const setAutoSyncEnabled = useCallback((enabled: boolean) => {
    setGistAutoSync(enabled);
    setAutoSyncEnabledState(enabled);
    if (!enabled && autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
      autoPushTimerRef.current = null;
    }
  }, []);

  const resolveGistConflict = useCallback(async (resolution: GistConflictResolution): Promise<void> => {
    const conflict = useUIStore.getState().gistConflict;
    if (!conflict) return;
    const setConflict = useUIStore.getState().setGistConflict;
    try {
      if (resolution === "apply-remote") {
        // 원격 데이터를 로컬에 반영. 로컬 변경은 폐기.
        // 모달이 열려있는 동안 원격이 또 갱신됐을 가능성을 보수적으로 처리:
        // 사용 직전에 commits API로 최신 commit 시각을 한 번 더 권위 확보.
        let authoritativeRemoteAt = conflict.remoteUpdatedAt;
        try {
          const versions = await getGistVersions(1);
          if (versions[0]?.committedAt) authoritativeRemoteAt = versions[0].committedAt;
        } catch { /* 무시 — 모달의 시각 유지 */ }

        onApplyPulledData(conflict.remoteDataJson, authoritativeRemoteAt);
        setGistLastPullAt(authoritativeRemoteAt);
        setLastPullAt(authoritativeRemoteAt);
        knownRemoteCommitRef.current = authoritativeRemoteAt;
        // pendingLocalDataJson이 곧 원격으로 덮여 다음 effect에서 lastPushedPayloadRef와 같아질 가능성 높음.
        // 즉시 lastPushedPayloadRef를 원격 payload로 맞춰 불필요한 push 방지.
        lastPushedPayloadRef.current = conflict.remoteDataJson;
        setGistLastPushedHash(hashGistPayload(conflict.remoteDataJson));
        onLog?.("Gist 충돌: 원격 데이터를 적용했습니다", "success");
      } else if (resolution === "force-push-local") {
        // 로컬 데이터를 원격에 강제 push. 원격 변경은 폐기.
        // push 직후 원격 commit 시각을 다시 조회해 knownRemoteCommitRef를 권위 있는 값으로 갱신.
        // (saveToGist의 updatedAt이 GitHub commits API와 다를 수 있는 엣지 보호)
        const result = await saveToGist(conflict.pendingLocalDataJson);
        lastPushedPayloadRef.current = conflict.pendingLocalDataJson;
        setGistLastPushedHash(hashGistPayload(conflict.pendingLocalDataJson));
        setGistLastPushAt(result.updatedAt);
        setLastPushAt(result.updatedAt);
        try {
          const versions = await getGistVersions(1);
          const authoritative = versions[0]?.committedAt ?? result.updatedAt;
          knownRemoteCommitRef.current = authoritative;
          setGistLastPullAt(authoritative);
          setLastPullAt(authoritative);
        } catch {
          // 재조회 실패 시 result.updatedAt으로 fallback (다음 push 사이클에서 재시도)
          knownRemoteCommitRef.current = result.updatedAt;
        }
        onLog?.("Gist 충돌: 로컬 데이터를 강제 push 했습니다", "success");
      } else {
        // cancel: 모달 닫기만. 다음 변경 시 다시 충돌 가능.
        onLog?.("Gist 충돌 모달: 취소", "info");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog?.(`Gist 충돌 해결 실패: ${message}`, "error");
      // force-push 등 실패가 조용히 모달만 닫히면 사용자가 "해결됐다"고 오해 — 토스트로 가시화
      toast.error(`Gist 충돌 해결 실패: ${message}`);
    } finally {
      setConflict(null);
    }
  }, [onApplyPulledData, onLog]);

  /**
   * Gist 과거 버전 복원(GistVersionModal) 직후 동기화 상태를 갱신한다.
   * 이걸 호출하지 않으면 복원된 (과거) 데이터를 runAutoPush가 '새 로컬 변경'으로 보고
   * 5분 뒤 조용히 push → 최신 원격이 과거로 롤백된다.
   * - lastPushedPayloadRef/hash = 복원 데이터: 즉시 자동 push 막음(데이터 동일 → no-op).
   * - knownRemoteCommitRef = 복원 버전의 commit 시각(과거): 이후 실제 변경 시 detectConflict가
   *   '원격이 더 최신'을 감지해 충돌 모달로 사용자에게 롤백 여부를 의식적으로 묻게 함.
   */
  const syncStateAfterRestore = useCallback((dataJson: string, committedAt: string) => {
    lastPushedPayloadRef.current = dataJson;
    setGistLastPushedHash(hashGistPayload(dataJson));
    knownRemoteCommitRef.current = committedAt;
  }, []);

  // 경고는 매 렌더에 재계산 — 사용자가 앱을 보고 있으면 어차피 자주 리렌더됨 (탭 전환·데이터 변경 등).
  // 별도 setInterval로 강제 갱신은 안 함 (불필요 + fake-timer 테스트와 충돌).
  let gistStaleWarning: GistStaleWarning | null = null;
  if (autoSyncEnabled && lastPushAt) {
    const ms = Date.now() - new Date(lastPushAt).getTime();
    if (Number.isFinite(ms) && ms > 0) {
      const hoursSince = ms / 36e5;
      if (hoursSince >= GIST_STALE_WARNING_HOURS.CRITICAL) {
        gistStaleWarning = {
          type: "critical",
          message: `${Math.floor(hoursSince)}시간 동안 Gist에 푸시되지 않았습니다. 지금 푸시하세요.`,
          hoursSince,
        };
      } else if (hoursSince >= GIST_STALE_WARNING_HOURS.WARNING) {
        gistStaleWarning = {
          type: "warning",
          message: `${Math.floor(hoursSince)}시간 경과 — Gist 푸시 권장`,
          hoursSince,
        };
      }
    }
  }

  return {
    autoSyncEnabled,
    setAutoSyncEnabled,
    lastPushAt,
    lastPullAt,
    isSyncing,
    resolveGistConflict,
    gistStaleWarning,
    manualPush,
    manualPull,
    syncStateAfterRestore,
  };
}
