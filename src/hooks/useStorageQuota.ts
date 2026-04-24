import { useEffect, useState } from "react";

export interface StorageQuotaInfo {
  /** Bytes used (approx, reported by browser) */
  usage: number | null;
  /** Max bytes allocated to this origin */
  quota: number | null;
  /** 0~1 사용률 */
  ratio: number | null;
  /** 85% 초과 시 true. null이면 아직 측정 전 */
  isNearLimit: boolean | null;
}

/**
 * navigator.storage.estimate()로 localStorage+IndexedDB 등 origin 총 사용량 모니터링.
 * 측정은 모든 저장소 합산 근사치 — 완벽하진 않지만 85% 기준 조기 경고에 충분.
 * 주기적으로 체크하지 않고, 앱 시작 시 1회 + refresh()로 수동 재조회.
 */
export function useStorageQuota(pollIntervalMs = 10 * 60_000): StorageQuotaInfo & { refresh: () => void } {
  const [info, setInfo] = useState<StorageQuotaInfo>({
    usage: null,
    quota: null,
    ratio: null,
    isNearLimit: null,
  });

  const refresh = () => {
    if (typeof navigator === "undefined" || !navigator.storage || typeof navigator.storage.estimate !== "function") {
      return;
    }
    navigator.storage
      .estimate()
      .then((est) => {
        const usage = typeof est.usage === "number" ? est.usage : null;
        const quota = typeof est.quota === "number" && est.quota > 0 ? est.quota : null;
        const ratio = usage != null && quota != null ? usage / quota : null;
        setInfo({
          usage,
          quota,
          ratio,
          isNearLimit: ratio != null ? ratio >= 0.85 : null,
        });
      })
      .catch(() => {
        // 일부 브라우저·모드에서 거절 — 측정 불가로 표시
      });
  };

  useEffect(() => {
    refresh();
    if (pollIntervalMs <= 0) return;
    const id = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs]);

  return { ...info, refresh };
}
