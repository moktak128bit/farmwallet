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

  // Effect 1: 시작 시 자동 불러오기 (한 번만)
  useEffect(() => {
    if (!getGistAutoSync()) return;
    if (!getGistToken() || !getGistId()) return;

    let cancelled = false;

    const run = async () => {
      try {
        const remote = await loadFromGist();
        if (cancelled) return;

        const remoteMs = Date.parse(remote.updatedAt);
        const lastPushMs = Date.parse(getGistLastPushAt());

        if (!Number.isFinite(remoteMs)) return;
        // 원격이 이 기기의 마지막 저장보다 더 최신인 경우만 불러오기
        if (Number.isFinite(lastPushMs) && remoteMs <= lastPushMs) return;

        onApplyPulledData(remote.dataJson, remote.updatedAt);

        const nowIso = new Date().toISOString();
        setGistLastPullAt(nowIso);
        setLastPullAt(nowIso);
        onLog?.(`Gist 자동 불러오기 완료 (${new Date(remote.updatedAt).toLocaleString("ko-KR")})`, "success");
        toast.success("다른 기기의 최신 데이터를 자동으로 불러왔습니다.", { duration: 5000 });
      } catch {
        // 조용히 실패 (이미 localStorage 데이터 로드됨)
        onLog?.("Gist 자동 불러오기 실패 (로컬 데이터 사용 중)", "info");
      }
    };

    // useAppData의 setTimeout(0) 이후 실행되도록 100ms 지연
    const id = window.setTimeout(() => { void run(); }, 100);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: 데이터 변경 시 자동 저장 (5분 디바운스)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (autoPushTimerRef.current) window.clearTimeout(autoPushTimerRef.current);

    autoPushTimerRef.current = window.setTimeout(async () => {
      if (!getGistAutoSync()) return;
      if (!getGistToken() || !getGistId()) return;
      if (isPushingRef.current) return;

      // API 캐시(prices, tickerDatabase, historicalDailyCloses) 제외한 사용자 데이터만 Gist에 저장
      const payload = toUserDataJson(data);
      if (!payload || payload === lastPushedPayloadRef.current) return;

      isPushingRef.current = true;
      setIsSyncing(true);
      try {
        const result = await saveToGist(payload);
        lastPushedPayloadRef.current = payload;

        setGistLastPushAt(result.updatedAt);
        setLastPushAt(result.updatedAt);
        onLog?.(`Gist 자동 저장 완료 (${new Date(result.updatedAt).toLocaleString("ko-KR")})`, "success");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Gist 자동 저장 실패";
        onLog?.(msg, "error");
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
  }, [data, onLog]);

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
