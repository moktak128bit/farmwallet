import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData } from "../types";
import {
  saveToGist,
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
  detectConflict
} from "../services/gistSync";
import { toUserDataJson } from "../services/dataService";
import { GIST_AUTO_PUSH_DEBOUNCE_MS } from "../constants/config";
import { useUIStore } from "../store/uiStore";

export interface UseGistSyncOptions {
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
}

export type GistConflictResolution = "apply-remote" | "force-push-local" | "cancel";

export interface UseGistSyncReturn {
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  lastPushAt: string | null;
  lastPullAt: string | null;
  isSyncing: boolean;
  /** Gist 충돌 모달에서 사용자가 액션을 선택했을 때 호출 */
  resolveGistConflict: (resolution: GistConflictResolution) => Promise<void>;
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

  // Effect 1: 시작 시 자동 불러오기 (자동 동기화 ON 일 때만)
  // - Gist의 마지막 commit 시각이 로컬 lastPullAt 보다 최신이면 자동으로 불러옴
  // - 첫 활성화 시 강제로 풀 백업이 만들어진 뒤 동기화 (loadFromGist 응답을 그대로 적용 콜백에 전달)
  useEffect(() => {
    if (!autoSyncEnabled) return;
    if (!getGistToken() || !getGistId()) return;
    if (hasMountedRef.current) return;
    hasMountedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        setIsSyncing(true);
        const versions = await getGistVersions(1).catch(() => []);
        const latest = versions[0];
        knownRemoteCommitRef.current = latest?.committedAt ?? "";
        const localPull = getGistLastPullAt();
        const remoteIsNewer =
          !!latest && (!localPull || new Date(latest.committedAt) > new Date(localPull));
        if (!remoteIsNewer) {
          onLog?.("Gist 자동 동기화: 원격이 더 새롭지 않아 건너뜀", "info");
          return;
        }
        const { dataJson, updatedAt } = await loadFromGist();
        if (cancelled) return;
        onApplyPulledData(dataJson, updatedAt);
        setGistLastPullAt(updatedAt);
        setLastPullAt(updatedAt);
        knownRemoteCommitRef.current = updatedAt;
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

  // Effect 2: 데이터 변경 시 자동 저장 (debounced)
  // - 마지막 변경 후 GIST_AUTO_PUSH_DEBOUNCE_MS 경과 시 push
  // - push 직전에 원격 commit 시각을 확인. 우리가 알고 있는 시점보다 새로우면 충돌로 간주하고 사용자에게 알림 (덮어쓰지 않음)
  useEffect(() => {
    if (!autoSyncEnabled) return;
    if (!getGistToken() || !getGistId()) return;
    if (!hasMountedRef.current) return;

    const dataJson = toUserDataJson(data);
    if (dataJson === lastPushedPayloadRef.current) return;

    if (autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
    }

    autoPushTimerRef.current = window.setTimeout(async () => {
      if (isPushingRef.current) return;
      // 충돌 모달이 열려 있는 동안에는 push 보류 (사용자가 결정할 때까지 대기)
      if (useUIStore.getState().gistConflict) {
        onLog?.("Gist 충돌 모달이 열려 있어 자동 저장 보류", "info");
        return;
      }
      isPushingRef.current = true;
      try {
        setIsSyncing(true);
        const versions = await getGistVersions(1).catch(() => []);
        const latest = versions[0];
        const known = knownRemoteCommitRef.current || getGistLastPullAt();
        if (detectConflict(latest?.committedAt, known)) {
          // 자동 pull 후 사용자에게 머지/덮어쓰기/취소 모달 노출
          onLog?.("Gist 충돌 감지 — 원격 데이터 fetch 후 모달 표시", "info");
          try {
            const remote = await loadFromGist();
            useUIStore.getState().setGistConflict({
              remoteDataJson: remote.dataJson,
              remoteUpdatedAt: remote.updatedAt,
              pendingLocalDataJson: dataJson,
            });
          } catch (pullErr) {
            const message = pullErr instanceof Error ? pullErr.message : String(pullErr);
            onLog?.(`Gist 충돌 후 원격 fetch 실패: ${message}`, "error");
          }
          return;
        }
        const result = await saveToGist(dataJson);
        lastPushedPayloadRef.current = dataJson;
        setGistLastPushAt(result.updatedAt);
        setLastPushAt(result.updatedAt);
        knownRemoteCommitRef.current = result.updatedAt;
        onLog?.("Gist 자동 저장 성공", "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.(`Gist 자동 저장 실패: ${message}`, "error");
      } finally {
        isPushingRef.current = false;
        setIsSyncing(false);
      }
    }, GIST_AUTO_PUSH_DEBOUNCE_MS);

    return () => {
      if (autoPushTimerRef.current) {
        window.clearTimeout(autoPushTimerRef.current);
        autoPushTimerRef.current = null;
      }
    };
  }, [autoSyncEnabled, data, onLog]);

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
        onApplyPulledData(conflict.remoteDataJson, conflict.remoteUpdatedAt);
        setGistLastPullAt(conflict.remoteUpdatedAt);
        setLastPullAt(conflict.remoteUpdatedAt);
        knownRemoteCommitRef.current = conflict.remoteUpdatedAt;
        // pendingLocalDataJson이 곧 원격으로 덮여 다음 effect에서 lastPushedPayloadRef와 같아질 가능성 높음.
        // 즉시 lastPushedPayloadRef를 원격 payload로 맞춰 불필요한 push 방지.
        lastPushedPayloadRef.current = conflict.remoteDataJson;
        onLog?.("Gist 충돌: 원격 데이터를 적용했습니다", "success");
      } else if (resolution === "force-push-local") {
        // 로컬 데이터를 원격에 강제 push. 원격 변경은 폐기.
        const result = await saveToGist(conflict.pendingLocalDataJson);
        lastPushedPayloadRef.current = conflict.pendingLocalDataJson;
        setGistLastPushAt(result.updatedAt);
        setLastPushAt(result.updatedAt);
        knownRemoteCommitRef.current = result.updatedAt;
        onLog?.("Gist 충돌: 로컬 데이터를 강제 push 했습니다", "success");
      } else {
        // cancel: 모달 닫기만. 다음 변경 시 다시 충돌 가능.
        onLog?.("Gist 충돌 모달: 취소", "info");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog?.(`Gist 충돌 해결 실패: ${message}`, "error");
    } finally {
      setConflict(null);
    }
  }, [onApplyPulledData, onLog]);

  return { autoSyncEnabled, setAutoSyncEnabled, lastPushAt, lastPullAt, isSyncing, resolveGistConflict };
}
