import type { TickerInfo } from "../types";

export async function loadTickerDatabaseFromBackup(): Promise<TickerInfo[] | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/ticker-backup");
    if (!res.ok) return null;
    const contentType = res.headers.get("Content-Type") ?? "";
    const text = await res.text();
    if (!text.trim()) return null;
    if (!contentType.includes("application/json") || text.trimStart().startsWith("<")) {
      return null;
    }
    const json = JSON.parse(text) as unknown;
    if (Array.isArray(json)) return json as TickerInfo[];
    if (Array.isArray((json as { tickers?: unknown }).tickers)) {
      return (json as { tickers: TickerInfo[] }).tickers;
    }
    return null;
  } catch (e) {
    console.warn("[tickerService] 티커 백업 로드 실패", e);
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
