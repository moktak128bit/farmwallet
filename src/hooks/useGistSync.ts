import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
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
  getGistVersions
} from "../services/gistSync";
import { toUserDataJson } from "../services/dataService";
import { GIST_AUTO_PUSH_DEBOUNCE_MS } from "../constants/config";

export interface UseGistSyncOptions {
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
}

export interface UseGistSyncReturn {
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  lastPushAt: string | null;
  lastPullAt: string | null;
  isSyncing: boolean;
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
      isPushingRef.current = true;
      try {
        setIsSyncing(true);
        const versions = await getGistVersions(1).catch(() => []);
        const latest = versions[0];
        const known = knownRemoteCommitRef.current || getGistLastPullAt();
        const remoteChangedSinceKnown =
          !!latest && !!known && new Date(latest.committedAt) > new Date(known);
        if (remoteChangedSinceKnown) {
          toast.error("Gist 자동 저장: 원격이 더 새롭게 변경되었습니다. 수동으로 불러오기 후 다시 시도해주세요.");
          onLog?.("Gist 자동 저장 충돌 감지 — push 보류", "error");
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

  return { autoSyncEnabled, setAutoSyncEnabled, lastPushAt, lastPullAt, isSyncing };
}
