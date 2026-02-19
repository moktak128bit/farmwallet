import type { TickerInfo } from "../types";
import { STORAGE_KEYS, BACKUP_CONFIG } from "../constants/config";

export async function loadTickerDatabaseFromBackup(): Promise<TickerInfo[] | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/ticker-backup");
    if (!res.ok) return null;
    const json = await res.json();
    if (Array.isArray(json)) return json as TickerInfo[];
    if (Array.isArray((json as { tickers?: unknown }).tickers)) {
      return (json as { tickers: TickerInfo[] }).tickers;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveTickerDatabaseBackup(tickers: TickerInfo[]): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/ticker-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers })
    });
  } catch {
    // 파일 백업 실패는 무시 (localStorage 저장은 상위 로직에서 처리)
  }
}

export async function saveTickerToJson(ticker: string, name: string, market: 'KR' | 'US'): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/ticker-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, name, market })
    });
  } catch (e) {
    console.error("Failed to save ticker to ticker.json", e);
  }
}
