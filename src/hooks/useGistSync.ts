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
  setGistLastPullAt
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

  // Effect 1: 시작 시 자동 불러오기 — 비활성화 (수동 저장/불러오기만 사용)
  // 자동 불러오기가 로컬 수정을 덮어쓰는 문제로 제거됨

  // Effect 2: 데이터 변경 시 자동 저장 — 비활성화 (수동 저장만 사용)

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
