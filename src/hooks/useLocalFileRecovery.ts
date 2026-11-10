import { useCallback, useEffect, useState } from "react";
import type { AppData } from "../types";
import { normalizeImportedData } from "../storage";
import { hasUserRecords } from "../utils/userDataPresence";

interface LocalFileCandidate {
  data: AppData;
  source: string;
  exportedAt?: string;
}

type RecoveryState =
  | { status: "idle" | "checking" }
  | { status: "ready"; candidate: LocalFileCandidate }
  | { status: "error" };

/** 파일은 먼저 제시하고, 사용자가 확인하기 전에는 브라우저·파일 어느 쪽도 쓰지 않는다. */
export function useLocalFileRecovery(data: AppData, isLoading: boolean, loadFailed: boolean, cloudConnected = false) {
  const [state, setState] = useState<RecoveryState>({ status: import.meta.env.DEV ? "checking" : "idle" });
  const [attempt, setAttempt] = useState(0);
  const populated = hasUserRecords(data);
  const retry = useCallback(() => { setState({ status: "checking" }); setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || isLoading) return;
    // 연결된 기기는 Gist에서 최신 장부를 받는다. PC 파일 복구 제안으로 클라우드를 막지 않는다.
    if (cloudConnected && !loadFailed) {
      setState({ status: "idle" });
      return;
    }
    if (populated && !loadFailed) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setState({ status: "checking" });
    void (async () => {
      let failed = false;
      // 현재 사용 중인 통합 파일이 우선. 날짜별 백업은 파일이 없거나 읽지 못할 때만 확인한다.
      for (const [url, source] of [
        ["/api/farmwallet-data", "저장된 가계부 파일"],
        ["/api/restore-latest-backup", "최근 파일 백업"],
      ]) {
        try {
          const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error(`파일 응답 오류 (${response.status})`);
          const raw: unknown = await response.json();
          if (raw === null) continue;
          const normalized = normalizeImportedData(raw);
          if (!hasUserRecords(normalized)) continue;
          if (!cancelled) {
            const exportedAt = (raw as { _exportedAt?: unknown })._exportedAt;
            setState({ status: "ready", candidate: {
              data: normalized, source,
              exportedAt: typeof exportedAt === "string" ? exportedAt : undefined,
            } });
          }
          return;
        } catch {
          failed = true;
        }
      }
      if (!cancelled) setState({ status: failed ? "error" : "idle" });
    })().finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [isLoading, loadFailed, populated, attempt, cloudConnected]);

  return { state, retry, blocksSaving: state.status !== "idle" && (!populated || loadFailed) && (!cloudConnected || loadFailed) };
}
