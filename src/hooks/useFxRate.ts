import { useEffect, useState } from "react";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { FX_UPDATE_INTERVAL, STORAGE_KEYS } from "../constants/config";

const FX_RETRY_DELAY_MS = 5_000;
const FX_MAX_RETRIES = 3;
/** 캐시된 환율이 이 시간보다 오래되면 stale로 간주 (사용은 가능하지만 UI에 경고) */
export const FX_STALE_THRESHOLD_MS = 24 * 60 * 60_000;

interface CachedFxRate {
  rate: number;
  fetchedAt: string; // ISO
}

function loadCachedFxRate(): CachedFxRate | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_FX_RATE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 새 형식: { rate, fetchedAt }
    if (parsed && typeof parsed === "object" && typeof parsed.rate === "number" && Number.isFinite(parsed.rate)) {
      const fetchedAt = typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : new Date(0).toISOString();
      return { rate: parsed.rate, fetchedAt };
    }
    // 구 형식: 숫자만 저장돼 있던 경우 — fetchedAt 없음으로 epoch 0 (즉시 stale)
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      return { rate: parsed, fetchedAt: new Date(0).toISOString() };
    }
    return null;
  } catch {
    return null;
  }
}

function saveFxRate(rate: number) {
  try {
    const payload: CachedFxRate = { rate, fetchedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEYS.LAST_FX_RATE, JSON.stringify(payload));
  } catch {
    // 스토리지 용량 초과 등 무시
  }
}

export interface FxRateInfo {
  rate: number | null;
  /** 마지막 성공 시점 ISO. 캐시 only이고 시간이 너무 오래됐으면 isStale=true */
  fetchedAt: string | null;
  isStale: boolean;
}

/** 기존 호환: 숫자 환율만 반환 */
export function useFxRate(): number | null {
  return useFxRateInfo().rate;
}

/** 신규: 환율 + 신선도 정보 반환 */
export function useFxRateInfo(): FxRateInfo {
  const [info, setInfo] = useState<FxRateInfo>(() => {
    const cached = loadCachedFxRate();
    if (!cached) return { rate: null, fetchedAt: null, isStale: false };
    const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
    return {
      rate: cached.rate,
      fetchedAt: cached.fetchedAt,
      isStale: !Number.isFinite(ageMs) || ageMs > FX_STALE_THRESHOLD_MS,
    };
  });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const attemptFetch = async (attemptsLeft: number) => {
      if (cancelled) return;
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        const r = res[0];
        if (r?.price) {
          const nowIso = new Date().toISOString();
          saveFxRate(r.price);
          if (!cancelled) setInfo({ rate: r.price, fetchedAt: nowIso, isStale: false });
        } else if (attemptsLeft > 0) {
          retryTimer = setTimeout(() => attemptFetch(attemptsLeft - 1), FX_RETRY_DELAY_MS);
        }
      } catch {
        if (attemptsLeft > 0 && !cancelled) {
          retryTimer = setTimeout(() => attemptFetch(attemptsLeft - 1), FX_RETRY_DELAY_MS);
        }
      }
    };

    attemptFetch(FX_MAX_RETRIES);
    const interval = setInterval(() => attemptFetch(0), FX_UPDATE_INTERVAL);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(interval);
    };
  }, []);

  return info;
}
