import { useCallback, useRef, useState } from "react";
import type { AppData } from "../types";
import {
  getRepoAutoSync,
  setRepoAutoSync,
  getRepoLastPushAt,
  getRepoLastPullAt
} from "../services/repoSync";

export interface UseRepoSyncOptions {
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
}

export interface UseRepoSyncReturn {
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  lastPushAt: string | null;
  lastPullAt: string | null;
  isSyncing: boolean;
}

/**
 * Repo 기반 자동 동기화 훅
 * 현재는 수동 저장/불러오기만 사용 (자동 동기화는 비활성).
 * 상태 표시용으로 마지막 push/pull 시각을 localStorage에서 읽어 반환.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useGistSync(
  _data: AppData,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _onApplyPulledData: (dataJson: string, remoteUpdatedAt: string) => void,
  options?: UseRepoSyncOptions
): UseRepoSyncReturn {
  // onLog는 향후 자동 동기화 시 사용 예정
  void options;

  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(() => getRepoAutoSync());
  const [lastPushAt] = useState<string | null>(() => getRepoLastPushAt() || null);
  const [lastPullAt] = useState<string | null>(() => getRepoLastPullAt() || null);
  const [isSyncing] = useState(false);

  const autoPushTimerRef = useRef<number | null>(null);

  const setAutoSyncEnabled = useCallback((enabled: boolean) => {
    setRepoAutoSync(enabled);
    setAutoSyncEnabledState(enabled);
    if (!enabled && autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
      autoPushTimerRef.current = null;
    }
  }, []);

  return { autoSyncEnabled, setAutoSyncEnabled, lastPushAt, lastPullAt, isSyncing };
}
