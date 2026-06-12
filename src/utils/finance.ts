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
const isLikelyKoreanSixCharCode = (ticker: string): boolean => {
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

/**
 * 현재 실제로 보유 중인(매수 수량 - 매도 수량 > 0) 종목 티커만 반환.
 *
 * 청산 완료(보유 0) 종목은 갱신 대상에서 제외 — Yahoo API 호출 줄여 429 회피 + 갱신 속도 ↑.
 * "전체 갱신" 버튼(ticker.json 기반)은 별도 — 청산 종목까지 보고 싶을 때 사용.
 *
 * 부동소수점 잔량 안전망: |buy − sell| < 1e-8 이면 0으로 간주 (코인 미세 잔량 의도치 않은 포함 방지).
 */
/**
 * CoinGecko ID(풀네임) → 업비트/CCXT 표준 short symbol 매핑.
 *
 * 시스템 내부 ticker는 CoinGecko ID로 유지 (시세 매칭 키). 사용자에게 보여줄 때만
 * "solana" → "SOL" 같이 깔끔한 short symbol로 변환.
 *
 * 거래소 UI(업비트 등)와 표기 일치 — 사용자 멘탈모델: "ticker=SOL, name=솔라나"
 */
const CRYPTO_DISPLAY_SYMBOL: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  ripple: "XRP",
  "usd-coin": "USDC",
  tether: "USDT",
  binancecoin: "BNB",
  cardano: "ADA",
  dogecoin: "DOGE",
  "avalanche-2": "AVAX",
  "matic-network": "MATIC",
  polkadot: "DOT",
  chainlink: "LINK",
  litecoin: "LTC",
  uniswap: "UNI",
  stellar: "XLM",
  monero: "XMR",
  cosmos: "ATOM",
  "ethereum-classic": "ETC",
};

/**
 * CoinGecko ID 형태(소문자 풀네임)면 깔끔한 short symbol 반환, 그 외엔 입력 그대로.
 * 예: "solana" → "SOL", "MSFT" → "MSFT", "005930" → "005930"
 */
export function cryptoDisplaySymbol(ticker: string): string {
  if (!ticker) return ticker;
  const key = ticker.toLowerCase().trim();
  return CRYPTO_DISPLAY_SYMBOL[key] ?? ticker;
}

export function getCurrentHoldingsTickers(trades: Array<{ ticker: string; quantity: number; side: "buy" | "sell" }>): string[] {
  const net = new Map<string, number>();
  for (const t of trades) {
    const symbol = canonicalTickerForMatch(t.ticker);
    if (!symbol) continue;
    const qty = Number(t.quantity);
    if (!Number.isFinite(qty)) continue;
    const delta = t.side === "buy" ? qty : -qty;
    net.set(symbol, (net.get(symbol) ?? 0) + delta);
  }
  const out: string[] = [];
  for (const [symbol, qty] of net) {
    if (qty > 1e-8) out.push(symbol);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export const isUSDStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  if (isCryptoStock(ticker)) return false;
  // 위 isCryptoStock 주석과 동일 규칙: 접미사 제거 후 1~5자 순영문이면 미국 주식/ETF.
  // (GOOGL 등 5자 티커, F·T 등 1자 티커 포함. BRK.B 같은 클래스 접미사도 허용)
  const c = cleanTicker(ticker.trim());
  return /^[A-Z]{1,5}([.-][A-Z])?$/.test(c);
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

/**
 * 거래(StockTrade) 1건의 totalAmount를 KRW로 환산.
 *
 * 규칙:
 *  - KRW 종목: totalAmount 그대로 (이미 원화)
 *  - USD 종목: t.fxRateAtTrade 우선 사용, 없으면 fallbackFx (현재 환율) 적용
 *  - USD 종목인데 둘 다 없으면 0 반환 — 단위 섞임 방지 ("USD 금액을 KRW 합계에 그대로 더하기" 방지)
 *
 * 인사이트·대시보드 어디서든 동일 규칙을 쓰도록 통합. 기존 인라인 `t.fxRateAtTrade ? ... : t.totalAmount`
 * 패턴은 fxRateAtTrade 누락 USD 거래에서 USD↔KRW 단위 혼합 버그가 있었음.
 */
export function tradeAmountKRW(
  t: { ticker: string; totalAmount: number; fxRateAtTrade?: number | null },
  fallbackFx?: number | null
): number {
  if (!isUSDStock(t.ticker)) return t.totalAmount;
  const tradeFx = t.fxRateAtTrade ?? 0;
  if (tradeFx > 0) return t.totalAmount * tradeFx;
  if (fallbackFx && fallbackFx > 0) return t.totalAmount * fallbackFx;
  return 0;
}

export function extractTickerFromText(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const sixDigit = text.match(/([0-9]{6})/);
  if (sixDigit) return sixDigit[1];
  // 숫자-only 토큰("2024", "3" 등 연도·수치)은 티커가 아님 — 영문이 하나 이상 포함된 토큰만 인정
  const tokens = text.match(/[0-9A-Za-z]{1,10}/g) ?? [];
  for (const token of tokens) {
    if (/[A-Za-z]/.test(token)) return token;
  }
  return null;
}

