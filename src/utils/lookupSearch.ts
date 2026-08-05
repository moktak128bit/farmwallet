/**
 * 종목 로컬 검색 — 티커DB(이름·코드) + 전체 상장 한글명(krNames) + 티커 직접 입력.
 * StockLookupModal(종목 조회)·StockCompareSection(종목 비교) 공용.
 */
import type { TickerInfo } from "../types";
import { canonicalTickerForMatch, cleanTicker, isKRWStock, isUSDStock } from "./finance";
import { getKrNames } from "../storage";

export interface LookupTarget {
  ticker: string;
  /** 검색 결과의 종목명 ("" = 직접 입력이라 이름 미상) */
  name: string;
  market: "KR" | "US";
  exchange?: string;
}

export function searchLookupTargets(
  query: string,
  tickerDatabase: TickerInfo[],
  maxResults = 20
): LookupTarget[] {
  const q = query.trim();
  if (!q) return [];
  const Q = q.toUpperCase();
  const seen = new Set<string>();
  const out: LookupTarget[] = [];
  for (const t of tickerDatabase) {
    if (t.market === "CRYPTO") continue; // 코인은 CoinGecko 경로 — 야후 조회 대상 아님
    if (!(t.ticker.toUpperCase().includes(Q) || t.name.toUpperCase().includes(Q))) continue;
    const key = canonicalTickerForMatch(t.ticker);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ticker: cleanTicker(t.ticker),
      name: t.name,
      market: t.market === "KR" ? "KR" : "US",
      exchange: t.exchange
    });
    if (out.length >= maxResults) break;
  }
  if (out.length < maxResults) {
    for (const [code, name] of Object.entries(getKrNames())) {
      if (!(code.includes(Q) || name.toUpperCase().includes(Q))) continue;
      const key = canonicalTickerForMatch(code);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ticker: code, name, market: "KR" });
      if (out.length >= maxResults) break;
    }
  }
  if (!seen.has(canonicalTickerForMatch(Q)) && (isKRWStock(Q) || isUSDStock(Q))) {
    out.push({ ticker: cleanTicker(Q), name: "", market: isKRWStock(Q) ? "KR" : "US" });
  }
  return out;
}
