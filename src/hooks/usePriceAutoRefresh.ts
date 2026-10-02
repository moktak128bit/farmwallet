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
    if (enabled === false) return;
    // 옵트인 플래그는 실행 시점마다 읽는다 — 앱 전역(App)에 한 번 마운트되므로, 마운트 때 한 번만 읽으면
    // 설정에서 켜고 끈 것이 새로고침 전까지 반영되지 않는다.
    const isOn = () =>
      enabled ?? (() => {
        try {
          return localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true";
        } catch {
          return false;
        }
      })();

    const safeInterval = Math.max(MIN_INTERVAL_MS, intervalMs);
    let cancelled = false;
    let timer: number | null = null;
    let lastRunAt = 0;
    let isRunning = false;

    const run = async () => {
      if (cancelled || isRunning || document.hidden || !isOn()) return;
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
