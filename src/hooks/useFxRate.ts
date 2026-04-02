import { useEffect, useState } from "react";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { FX_UPDATE_INTERVAL, STORAGE_KEYS } from "../constants/config";

const FX_RETRY_DELAY_MS = 5_000;
const FX_MAX_RETRIES = 3;

function loadCachedFxRate(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_FX_RATE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveFxRate(rate: number) {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_FX_RATE, JSON.stringify(rate));
  } catch {
    // 스토리지 용량 초과 등 무시
  }
}

export function useFxRate() {
  const [fxRate, setFxRate] = useState<number | null>(loadCachedFxRate);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const attemptFetch = async (attemptsLeft: number) => {
      if (cancelled) return;
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        const r = res[0];
        if (r?.price) {
          saveFxRate(r.price);
          if (!cancelled) setFxRate(r.price);
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

  return fxRate;
}
