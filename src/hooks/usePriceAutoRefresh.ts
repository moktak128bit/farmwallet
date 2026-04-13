import { useEffect, useRef } from "react";
import { STORAGE_KEYS } from "../constants/config";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

interface Options {
  enabled?: boolean;
  intervalMs?: number;
  onRefresh: () => Promise<void> | void;
}

export function usePriceAutoRefresh({ enabled, intervalMs = REFRESH_INTERVAL_MS, onRefresh }: Options) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isOn =
      enabled ?? localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true";
    if (!isOn) return;

    const safeInterval = Math.max(MIN_INTERVAL_MS, intervalMs);
    let cancelled = false;
    let timer: number | null = null;
    let lastRunAt = 0;
    let isRunning = false;

    const run = async () => {
      if (cancelled || isRunning || document.hidden) return;
      if (Date.now() - lastRunAt < MIN_INTERVAL_MS) return;
      isRunning = true;
      lastRunAt = Date.now();
      try {
        await onRefreshRef.current();
      } catch (err) {
        console.warn("[usePriceAutoRefresh] refresh failed", err);
      } finally {
        isRunning = false;
      }
    };

    timer = window.setInterval(run, safeInterval);

    const onVisibilityChange = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
