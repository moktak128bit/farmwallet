// Finance/ticker utility helpers.

/** CoinGecko ID로 쓰이는 암호화폐 (소문자). 시세 조회·canonical 매칭용 */
const KNOWN_CRYPTO_IDS = new Set([
  "bitcoin", "ethereum", "solana", "ripple", "usd-coin", "tether", "binancecoin",
  "cardano", "dogecoin", "avalanche-2", "matic-network", "polkadot", "chainlink",
  "litecoin", "uniswap", "stellar", "monero", "cosmos", "ethereum-classic"
]);

export const cleanTicker = (raw: string): string => {
  return raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
};

/**
 * 한국 종목: 접미사(.KS 등) 제거 후 **정확히 6글자**, **맨 앞은 반드시 숫자**, 나머지는 숫자·영문 무관.
 * (예: 005930, 0167Z0, 0167B0) — CoinGecko ID 휴리스틱과 겹치지 않게 암호화폐에서 제외할 때도 사용.
 */
export const isLikelyKoreanSixCharCode = (ticker: string): boolean => {
  const c = cleanTicker(ticker);
  if (c.length !== 6) return false;
  return /^[0-9][0-9A-Z]{5}$/.test(c);
};

export const isCryptoStock = (ticker?: string): boolean => {
  if (!ticker || typeof ticker !== "string") return false;
  const lower = ticker.trim().toLowerCase();
  if (KNOWN_CRYPTO_IDS.has(lower)) return true;
  // 2~5자 순영문은 미국 주식/ETF로 간주 (BITX, IBIT, COIN 등)
  if (/^[a-z]{2,5}$/.test(lower)) return false;
  // 한국 6자 종목코드(숫자+영문 혼합 등)는 암호화폐가 아님
  if (isLikelyKoreanSixCharCode(ticker)) return false;
  return (/^[a-z0-9-]+$/.test(lower) && lower.length >= 2 && lower.length <= 30 && !/^\d{6}$/.test(lower));
};

export const canonicalTickerForMatch = (raw: string): string => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return trimmed;
  if (isCryptoStock(trimmed)) return trimmed.toLowerCase();
  const c = cleanTicker(trimmed);
  // 한국 6자리 종목코드만 앞에 0 패딩 (숫자 4~5자). 미국 티커(BITX, AAPL 등)는 패딩 안 함
  if (c.length >= 4 && c.length <= 5 && /^\d+$/.test(c)) {
    return c.padStart(6, "0");
  }
  // 0167Z0 등 이미 6자 한국형 코드는 대문자 정규형만 유지
  return c;
};

/** 거래 내역에 실제로 등장한 티커만 중복 제거·정규화(시세 갱신 대상) */
export function getUniqueTickersFromTrades(trades: Array<{ ticker: string }>): string[] {
  const set = new Set<string>();
  for (const t of trades) {
    const symbol = canonicalTickerForMatch(t.ticker);
    if (symbol) set.add(symbol);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export const isUSDStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  if (isCryptoStock(ticker)) return false;
  return cleanTicker(ticker).length <= 4;
};

export const isKRWStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  if (isCryptoStock(ticker)) return false;
  const c = cleanTicker(ticker);
  // 위 규칙: 정확히 6자 + 첫 글자 숫자
  if (isLikelyKoreanSixCharCode(ticker)) return true;
  // 입력이 4~5자리 숫자만인 경우 → canonical에서 6자로 패딩되는 한국 코드
  if (c.length >= 4 && c.length <= 5 && /^\d+$/.test(c)) return true;
  return false;
};

export function extractTickerFromText(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const sixDigit = text.match(/([0-9]{6})/);
  if (sixDigit) return sixDigit[1];
  const m = text.match(/([0-9A-Z]{1,10})/i);
  return m ? m[1] : null;
}

export const TickerUtils = {
  cleanTicker,
  canonicalTickerForMatch,
  getUniqueTickersFromTrades,
  isLikelyKoreanSixCharCode,
  isUSDStock,
  isKRWStock,
  isCryptoStock,
  extractTickerFromText
};
