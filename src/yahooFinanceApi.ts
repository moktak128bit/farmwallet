import { canonicalTickerForMatch, isKRWStock } from "./utils/finance";
import { getKrNames } from "./storage";

export interface YahooQuoteResult {
  ticker: string;
  name?: string;
  price: number;
  currency?: string;
  change?: number;
  changePercent?: number;
  updatedAt?: string;
  sector?: string;
  industry?: string;
}


interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
  }>;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        longName?: string;
        shortName?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
}

interface YahooQuoteApiResponse {
  quoteResponse?: {
    result?: Array<{
      symbol?: string;
      longName?: string;
      shortName?: string;
      regularMarketPrice?: number;
      currency?: string;
      regularMarketPreviousClose?: number;
      regularMarketTime?: number;
      sector?: string;
      industry?: string;
    }>;
  };
}

/**
 * 한국 코스피/코스닥 주요 종목 목록 가져오기
 * 야후 파이낸스 검색 API를 사용하여 주요 종목들 검색
 */
export async function fetchKoreaTopStocks(): Promise<Array<{ ticker: string; name?: string; exchange?: string }>> {
  const results: Array<{ ticker: string; name?: string; exchange?: string }> = [];
  const seen = new Set<string>();
  
  // 코스피 주요 종목 티커 코드 목록 (시가총액 상위)
  const kospiTickers: Array<{ ticker: string; name: string }> = [
    { ticker: '005930', name: '삼성전자' },
    { ticker: '000660', name: 'SK하이닉스' },
    { ticker: '035420', name: 'NAVER' },
    { ticker: '035720', name: '카카오' },
    { ticker: '373220', name: 'LG에너지솔루션' },
    { ticker: '005380', name: '현대차' },
    { ticker: '000270', name: '기아' },
    { ticker: '005490', name: 'POSCO홀딩스' },
    { ticker: '105560', name: 'KB금융' },
    { ticker: '055550', name: '신한지주' },
    { ticker: '086790', name: '하나금융지주' },
    { ticker: '051910', name: 'LG화학' },
    { ticker: '068270', name: '셀트리온' },
    { ticker: '090430', name: '아모레퍼시픽' },
    { ticker: '066570', name: 'LG전자' },
    { ticker: '017670', name: 'SK텔레콤' },
    { ticker: '030200', name: 'KT' },
    { ticker: '006400', name: '삼성SDI' },
    { ticker: '009830', name: '한화솔루션' },
    { ticker: '011170', name: '롯데케미칼' },
    { ticker: '028260', name: '삼성물산' },
    { ticker: '015760', name: '한국전력' },
    { ticker: '096770', name: 'SK이노베이션' },
    { ticker: '051900', name: 'LG생활건강' },
    { ticker: '097950', name: 'CJ제일제당' },
    { ticker: '271560', name: '오리온' },
    { ticker: '002790', name: '아모레G' },
    { ticker: '002320', name: '한진' },
    { ticker: '003490', name: '대한항공' },
    { ticker: '012450', name: '한화에어로스페이스' }
  ];
  
  // 코스닥 주요 종목 티커 코드 목록
  const kosdaqTickers: Array<{ ticker: string; name: string }> = [
    { ticker: '091990', name: '셀트리온헬스케어' },
    { ticker: '036570', name: '엔씨소프트' },
    { ticker: '263750', name: '펄어비스' },
    { ticker: '078340', name: '컴투스' },
    { ticker: '217920', name: '넥슨' },
    { ticker: '237690', name: '에스티팜' },
    { ticker: '096530', name: '씨젠' },
    { ticker: '214420', name: '파마리서치' },
    { ticker: '000100', name: '유한양행' },
    { ticker: '128940', name: '한미약품' },
    { ticker: '069620', name: '대웅제약' },
    { ticker: '006280', name: '녹십자' },
    { ticker: '207940', name: '삼성바이오로직스' },
    { ticker: '302440', name: 'SK바이오팜' },
    { ticker: '086900', name: '메디톡스' },
    { ticker: '323410', name: '카카오뱅크' },
    { ticker: '277810', name: '토스뱅크' },
    { ticker: '204210', name: 'KB스타리츠' },
    { ticker: '005940', name: 'NH투자증권' },
    { ticker: '006800', name: '미래에셋증권' }
  ];
  
  const allTickers = [...kospiTickers, ...kosdaqTickers];
  
  for (const { ticker, name } of allTickers) {
    try {
      // 직접 티커 코드로 검색 (.KS, .KQ 포함)
      const tickerWithSuffix = ticker.startsWith('00') || ticker.startsWith('01') || ticker.startsWith('02') || ticker.startsWith('03') 
        ? `${ticker}.KS` 
        : `${ticker}.KQ`;
      const matches = await searchYahooSymbol(tickerWithSuffix);
      
      // 결과가 없으면 티커 코드 자체로도 시도
      let match = matches.find(m => {
        const mTicker = m.ticker.toUpperCase();
        return mTicker.includes(ticker) || mTicker.includes(tickerWithSuffix);
      });
      
      if (!match && matches.length > 0) {
        match = matches[0]; // 첫 번째 결과 사용
      }
      
      if (match && !seen.has(ticker)) {
        seen.add(ticker);
        const isKospi = tickerWithSuffix.includes('.KS') || /^00[0-9]{4}$/.test(ticker);
        results.push({
          ticker: ticker,
          name: match.name || name,
          exchange: isKospi ? 'KOSPI' : 'KOSDAQ'
        });
      } else if (!match) {
        // 검색 결과가 없어도 기본 티커와 이름으로 추가
        if (!seen.has(ticker)) {
          seen.add(ticker);
          const isKospi = tickerWithSuffix.includes('.KS') || /^00[0-9]{4}$/.test(ticker);
          results.push({
            ticker: ticker,
            name: name,
            exchange: isKospi ? 'KOSPI' : 'KOSDAQ'
          });
        }
      }
      // API 부담 완화를 위한 딜레이 (rate limit 방지)
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.warn(`한국 종목 검색 실패: ${ticker} (${name})`, err);
      // 에러가 발생해도 기본 티커와 이름으로 추가
      if (!seen.has(ticker)) {
        seen.add(ticker);
        const isKospi = /^00[0-9]{4}$/.test(ticker) || /^01[0-9]{4}$/.test(ticker) || /^02[0-9]{4}$/.test(ticker) || /^03[0-9]{4}$/.test(ticker);
        results.push({
          ticker: ticker,
          name: name,
          exchange: isKospi ? 'KOSPI' : 'KOSDAQ'
        });
      }
    }
  }
  
  return results;
}

/**
 * 미국 주요 종목 목록 가져오기
 * S&P 500, NASDAQ 100 주요 종목들
 */
export async function fetchUSTopStocks(): Promise<Array<{ ticker: string; name?: string; exchange?: string }>> {
  const results: Array<{ ticker: string; name?: string; exchange?: string }> = [];
  const seen = new Set<string>();
  
  // S&P 500 및 NASDAQ 100 주요 종목 티커 목록
  const usTickers = [
    // Tech
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'ADBE', 'CRM',
    'INTC', 'AMD', 'QCOM', 'AVGO', 'TXN', 'ORCL', 'NOW', 'SNOW', 'PLTR', 'COIN',
    // Finance
    'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'BLK', 'AXP', 'MA', 'V',
    // Healthcare
    'UNH', 'JNJ', 'PFE', 'ABT', 'TMO', 'DHR', 'ABBV', 'BMY', 'LLY', 'MRK',
    // Consumer
    'WMT', 'HD', 'MCD', 'SBUX', 'NKE', 'TGT', 'COST', 'LOW', 'TJX', 'ROST',
    // Industrial
    'BA', 'CAT', 'GE', 'HON', 'UPS', 'FDX', 'RTX', 'LMT', 'NOC', 'GD',
    // Energy
    'XOM', 'CVX', 'SLB', 'COP', 'EOG', 'MPC', 'VLO', 'PSX', 'HAL', 'OXY',
    // ETFs
    'SPY', 'QQQ', 'VOO', 'IVV', 'SCHD', 'VTI', 'DIA', 'IWM', 'VEA', 'VWO',
    'VUG', 'VTV', 'VXF', 'VB', 'VO', 'VTHR', 'VONE', 'VONG', 'VONV', 'VTEB'
  ];
  
  // 각 티커의 이름 조회
  for (const ticker of usTickers) {
    try {
      const matches = await searchYahooSymbol(ticker);
      if (matches.length > 0) {
        const match = matches.find(m => {
          const mTicker = m.ticker.toUpperCase().replace(/\.(US|)$/i, '');
          return mTicker === ticker.toUpperCase();
        });
        if (match && !seen.has(ticker)) {
          seen.add(ticker);
          const isNasdaq = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'ADBE', 'CRM', 'INTC', 'AMD', 'QCOM'].includes(ticker);
          results.push({
            ticker: ticker.toUpperCase(),
            name: match.name,
            exchange: isNasdaq ? 'NASDAQ' : 'NYSE'
          });
        }
      }
      // API 부담 완화를 위한 딜레이 (rate limit 방지) - 1초로 증가
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.warn(`미국 종목 검색 실패: ${ticker}`, err);
    }
  }
  
  return results;
}

/**
 * ticker.json 파일에서 티커 목록 읽기
 */
async function loadTickersFromFile(): Promise<{
  koreanTickers: Array<{ ticker: string; name: string }>;
  usTickers: Array<{ ticker: string; name: string }>;
}> {
  try {
    const response = await fetch('/api/ticker-json');
    if (!response.ok) {
      throw new Error(`Failed to fetch ticker.json: ${response.status}`);
    }
    const data = await response.json() as {
      KR?: Array<{ ticker: string; name: string }>;
      US?: Array<{ ticker: string; name: string }>;
    };
    
    return {
      koreanTickers: data.KR || [],
      usTickers: data.US || []
    };
  } catch (err) {
    console.error('Failed to load ticker.json:', err);
    return { koreanTickers: [], usTickers: [] };
  }
}

/**
 * ticker.json 파일에서 티커 목록 읽기 (API 호출 없음, 파일에서 직접 읽음)
 * 개발 서버 `/api/ticker-json` 필요. 정적 배포만 쓰는 환경에서는 빈 배열에 가깝게 실패할 수 있음.
 */
export async function fetchTickersFromFile(): Promise<Array<{
  ticker: string;
  name: string;
  market: 'KR' | 'US';
  exchange?: string;
}>> {
  const { koreanTickers, usTickers } = await loadTickersFromFile();
  const results: Array<{ ticker: string; name: string; market: 'KR' | 'US'; exchange?: string }> = [];
  koreanTickers.forEach(({ ticker, name }) => {
    results.push({ ticker, name, market: 'KR', exchange: undefined });
  });
  usTickers.forEach(({ ticker, name }) => {
    results.push({ ticker, name: name || ticker, market: 'US', exchange: 'NYSE' });
  });
  return results;
}

/**
 * 초기 티커 데이터베이스 생성
 * ticker.txt 파일에서 읽어서 이름 조회
 */
export async function buildInitialTickerDatabase(): Promise<Array<{
  ticker: string;
  name: string;
  market: 'KR' | 'US';
  exchange?: string;
}>> {
  try {
    return await fetchTickersFromFile();
  } catch (err) {
    console.error('ticker.json 파일에서 티커 목록 읽기 실패, 기본 목록 사용:', err);
    const results: Array<{ ticker: string; name: string; market: 'KR' | 'US'; exchange?: string }> = [];
    const koreaStocks = await fetchKoreaTopStocks();
    koreaStocks.forEach((s) => {
      results.push({ ticker: s.ticker, name: s.name || s.ticker, market: 'KR', exchange: s.exchange });
    });
    const usStocks = await fetchUSTopStocks();
    usStocks.forEach((s) => {
      results.push({ ticker: s.ticker, name: s.name || s.ticker, market: 'US', exchange: s.exchange });
    });
    return results;
  }
}

/**
 * 최신 상장 종목 목록 가져오기 (매일 새로고침용)
 * 야후 파이낸스에서 최신 상장 종목들을 검색하여 추가
 */
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const STOOQ_BASE = "https://stooq.pl/q/l/";

const getEnv = (): Record<string, string | boolean | undefined> =>
  (typeof import.meta !== "undefined"
    ? (import.meta as { env?: Record<string, string | boolean | undefined> }).env
    : undefined) ?? {};
const useCorsProxy = (): boolean => getEnv().DEV === true || getEnv().MODE === "development";
const getAllOriginsUrl = (path: "get" | "raw", encodedInnerUrl: string): string =>
  useCorsProxy()
    ? `/api/external/${path}?url=${encodedInnerUrl}`
    : `https://api.allorigins.win/${path}?url=${encodedInnerUrl}`;


/** exchange: 사용자가 지정한 거래소(KOSPI/KOSDAQ)가 있으면 그 suffix만 사용 */
const buildLookupCandidates = (symbol: string, exchange?: string) => {
  const cleaned = symbol.trim().toUpperCase();
  
  // BRK.A, BRK.B 같은 경우 점(.)을 하이픈(-)으로 변환
  // 야후 파이낸스에서는 BRK-A, BRK-B 형식으로 검색해야 함
  if (cleaned.includes(".") && /^[A-Z]+\.[A-Z]$/.test(cleaned)) {
    const hyphenated = cleaned.replace(/\./g, "-");
    return [hyphenated, cleaned]; // 하이픈 형식 우선, 원본도 시도
  }

  // Yahoo 특수 심볼(환율/지수 등)은 KR 접미사(.KS/.KQ) 붙이지 않음
  if (cleaned.includes("=X") || cleaned.startsWith("^")) {
    return [cleaned];
  }
  
  // 한국 주식:
  // - exchange가 확정(KOSPI/KOSDAQ)인 경우: 해당 suffix만 요청
  // - exchange가 없으면: 코스피·코스닥 둘 다 조회 (배치에서 최신 시세로 하나만 매칭)
  if (isKRWStock(cleaned)) {
    const ks = `${cleaned}.KS`;
    const kq = `${cleaned}.KQ`;
    if (exchange === "KOSPI") return [ks];
    if (exchange === "KOSDAQ") return [kq];
    return [ks, kq];
  }

  return [cleaned];
};

/** 유령(상장폐지/이전상장 잔재) 차단: 마지막 거래가 이 기간보다 오래됐으면 무시 */
const GHOST_CUTOFF_SEC = 30 * 24 * 60 * 60; // 30일

/** 429 Too Many Requests */
class RateLimitError extends Error {
  readonly status = 429;
  constructor() {
    super("HTTP 429 Too Many Requests");
    this.name = "RateLimitError";
  }
}

/** 최근 시세 캐시 TTL (ms). TTL 이내면 재요청하지 않음 */
const QUOTE_CACHE_TTL_MS = 2 * 60 * 1000; // 2분
const quoteCache = new Map<string, { result: YahooQuoteResult; fetchedAt: number }>();

function getCachedQuote(symbol: string): YahooQuoteResult | null {
  const entry = quoteCache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > QUOTE_CACHE_TTL_MS) {
    quoteCache.delete(symbol);
    return null;
  }
  return entry.result;
}

function setCachedQuote(symbol: string, result: YahooQuoteResult): void {
  quoteCache.set(symbol, { result, fetchedAt: Date.now() });
}

const fetchFromYahooQuoteBatch = async (
  requestedSymbols: string[],
  lookupSymbols: string[]
): Promise<Map<string, YahooQuoteResult>> => {
  if (lookupSymbols.length === 0) return new Map();

  // 개발 환경: /api/yahoo-quote 우선 사용(동일 서버에서 직접 Yahoo 호출, 429 캐시 없음)
  if (useCorsProxy()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const qs = new URLSearchParams({ symbols: lookupSymbols.join(",") });
      const res = await fetch(`/api/yahoo-quote?${qs.toString()}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = (await res.json()) as YahooQuoteApiResponse;
        const list = data.quoteResponse?.result ?? [];
        const byClean = new Map<string, (typeof list)[number]>();
        const nowSec = Math.floor(Date.now() / 1000);
        for (const item of list) {
          const symbol = String(item?.symbol ?? "").toUpperCase();
          if (!symbol) continue;
          const marketTime = item.regularMarketTime || 0;
          if (marketTime > 0 && nowSec - marketTime > GHOST_CUTOFF_SEC) continue; // 유령: 30일 초과 데이터 버림
          const key = symbol.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
          const existing = byClean.get(key);
          if (!existing || marketTime > (existing.regularMarketTime || 0)) byClean.set(key, item);
        }
        const results = new Map<string, YahooQuoteResult>();
        for (const requested of requestedSymbols) {
          const key = requested.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
          const item = byClean.get(key);
          if (!item || typeof item.regularMarketPrice !== "number") continue;
          // 한국 주식: 원화(KRW) 시세만 신뢰 (다른 통화 반환 시 스킵)
          if (isKRWStock(requested) && item.currency !== "KRW") continue;
          let change: number | undefined;
          let changePercent: number | undefined;
          if (typeof item.regularMarketPreviousClose === "number") {
            change = item.regularMarketPrice - item.regularMarketPreviousClose;
            if (item.regularMarketPreviousClose !== 0) {
              changePercent = (change / item.regularMarketPreviousClose) * 100;
            }
          }
          const updatedAt =
            typeof item.regularMarketTime === "number"
              ? new Date(item.regularMarketTime * 1000).toISOString()
              : undefined;
          results.set(requested, {
            ticker: requested,
            name: item.longName || item.shortName || requested,
            price: item.regularMarketPrice,
            currency: item.currency,
            change,
            changePercent,
            updatedAt,
            sector: item.sector,
            industry: item.industry
          });
        }
        return results;
      }
      // 429 또는 기타 비정상 시 아래 proxy 경로로 폴백
    } catch {
      // 네트워크 오류·timeout 등: 아래 proxy 경로로 폴백
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const params = new URLSearchParams({ symbols: lookupSymbols.join(",") });
  const innerUrl = `https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`;

  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(innerUrl)}`,
    `https://corsproxy.io/?${innerUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(innerUrl)}`
  ];

  let payloadStr = "";
  for (const proxyUrl of proxyUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(proxyUrl, { signal: controller.signal });
      if (res.ok) {
        payloadStr = await res.text();
        if (payloadStr && !payloadStr.includes("Not Found")) break;
      }
    } catch {
      // 조용히 다음 예비 프록시로
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!payloadStr) return new Map();

  let data: YahooQuoteApiResponse;
  try {
    data = JSON.parse(payloadStr);
  } catch {
    return new Map();
  }

  const list = data.quoteResponse?.result ?? [];
  const byClean = new Map<string, (typeof list)[number]>();
  const nowSec = Math.floor(Date.now() / 1000);
  for (const item of list) {
    const symbol = String(item?.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    const marketTime = item.regularMarketTime || 0;
    if (marketTime > 0 && nowSec - marketTime > GHOST_CUTOFF_SEC) continue; // 유령: 30일 초과 데이터 버림
    const key = symbol.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
    const existing = byClean.get(key);
    if (!existing || marketTime > (existing.regularMarketTime || 0)) byClean.set(key, item);
  }

  const results = new Map<string, YahooQuoteResult>();
  for (const requested of requestedSymbols) {
    const key = requested.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
    const item = byClean.get(key);
    if (!item) continue;
    if (typeof item.regularMarketPrice !== "number") continue;
    if (isKRWStock(requested) && item.currency !== "KRW") continue;

    let change: number | undefined;
    let changePercent: number | undefined;
    if (typeof item.regularMarketPreviousClose === "number") {
      change = item.regularMarketPrice - item.regularMarketPreviousClose;
      if (item.regularMarketPreviousClose !== 0) {
        changePercent = (change / item.regularMarketPreviousClose) * 100;
      }
    }

    const updatedAt =
      typeof item.regularMarketTime === "number"
        ? new Date(item.regularMarketTime * 1000).toISOString()
        : undefined;

    results.set(requested, {
      ticker: requested,
      name: item.longName || item.shortName || requested,
      price: item.regularMarketPrice,
      currency: item.currency,
      change,
      changePercent,
      updatedAt,
      sector: item.sector,
      industry: item.industry
    });
  }

  return results;
};

const fetchFromYahooChart = async (
  requestedSymbol: string,
  lookupSymbol: string
): Promise<YahooQuoteResult | null> => {
  const params = new URLSearchParams({
    interval: "1d",
    range: "1d",
    lang: "en-US",
    region: "US",
    includePrePost: "false"
  });
  const innerUrl = `${YAHOO_CHART_BASE}/${encodeURIComponent(lookupSymbol)}?${params.toString()}`;

  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(innerUrl)}`,
    `https://corsproxy.io/?${innerUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(innerUrl)}`
  ];

  let payloadStr = "";
  for (const proxyUrl of proxyUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(proxyUrl, { signal: controller.signal });
      if (res.ok) {
        payloadStr = await res.text();
        if (payloadStr && !payloadStr.includes("Not Found")) break;
      }
    } catch {
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!payloadStr) return null;

  let data: YahooChartResponse;
  try {
    data = JSON.parse(payloadStr);
  } catch {
    return null;
  }

  const meta = data.chart?.result?.[0]?.meta;
  const marketTime = meta?.regularMarketTime || 0;
  if (marketTime > 0 && Math.floor(Date.now() / 1000) - marketTime > GHOST_CUTOFF_SEC) return null; // 유령: 30일 초과 데이터 버림
  const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const lastClose = closes.filter((v): v is number => typeof v === "number").at(-1);
  const price = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : lastClose;
  if (price == null) return null;

  let change: number | undefined;
  let changePercent: number | undefined;
  if (typeof meta?.chartPreviousClose === "number") {
    change = price - meta.chartPreviousClose;
    if (meta.chartPreviousClose !== 0) {
      changePercent = (change / meta.chartPreviousClose) * 100;
    }
  }

  const updatedAt =
    typeof meta?.regularMarketTime === "number"
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : undefined;

  return {
    ticker: requestedSymbol,
    name: meta?.longName || meta?.shortName || requestedSymbol,
    price,
    currency: meta?.currency,
    change,
    changePercent,
    updatedAt
  };
};

/** 기간별 일별 종가 조회 (배당/수익률용). startDate/endDate는 yyyy-mm-dd */
export async function fetchYahooHistoricalCloses(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<Array<{ date: string; close: number }>> {
  const cleaned = ticker.trim().toUpperCase();
  const candidates = buildLookupCandidates(cleaned);
  const period1 = Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000);
  const period2 = Math.ceil(new Date(endDate + "T23:59:59Z").getTime() / 1000);

  for (const lookupSymbol of candidates) {
    try {
      const params = new URLSearchParams({
        interval: "1d",
        period1: String(period1),
        period2: String(period2),
        lang: "en-US",
        region: "US",
        includePrePost: "false"
      });
      const innerUrl = `${YAHOO_CHART_BASE}/${encodeURIComponent(lookupSymbol)}?${params.toString()}`;
      const proxyUrl = getAllOriginsUrl("get", encodeURIComponent(innerUrl));
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        if (res.status === 429) throw new RateLimitError();
        continue;
      }
      const payload = (await res.json()) as { contents?: string };
      const data = payload.contents
        ? (JSON.parse(payload.contents) as YahooChartResponse)
        : (payload as unknown as YahooChartResponse);
      const result = data.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const rows: Array<{ date: string; close: number }> = [];
      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        const c = closes[i];
        if (typeof ts !== "number" || typeof c !== "number") continue;
        const date = new Date(ts * 1000).toISOString().slice(0, 10);
        if (date < startDate || date > endDate) continue;
        rows.push({ date, close: c });
      }
      if (rows.length > 0) return rows;
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      continue;
    }
  }
  return [];
}

const fetchFromStooq = async (requestedSymbol: string): Promise<YahooQuoteResult | null> => {
  const sym = `${requestedSymbol.toLowerCase()}.us`;
  const query = `s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=json`;
  const url = useCorsProxy() ? `/api/stooq?${query}` : `${STOOQ_BASE}?${query}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      symbols?: Array<{ symbol: string; name?: string; close?: string }>;
    };
    const item = json.symbols?.[0];
    const price = item?.close ? Number(item.close) : NaN;
    if (!item?.symbol || Number.isNaN(price)) return null;
    return {
      ticker: requestedSymbol,
      name: item.name ?? requestedSymbol,
      price,
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
};

// 전역 요청 추적을 위한 맵
const activeRequests = new Map<string, Promise<YahooQuoteResult[]>>();

export type FetchYahooQuotesOptions = {
  /** 진행률 및 종목별 성공/실패 로그용 (done, total, ticker?, status?) */
  onProgress?: (done: number, total: number, ticker?: string, status?: string) => void;
  /** 티커별 거래소(KOSPI/KOSDAQ). 지정 시 해당 티커는 .KS/.KQ 우선순위에 사용 */
  exchangeMap?: Record<string, string>;
  /** 배치 단계별 상태 로그 (개별 fallback 들어가기 전 가시성용) */
  onBatchPhase?: (phase: string) => void;
};

export async function fetchYahooQuotes(
  symbols: string[],
  options?: FetchYahooQuotesOptions
): Promise<YahooQuoteResult[]> {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean)));
  if (uniq.length === 0) return [];

  // 중복 요청 방지: 같은 심볼에 대한 요청이 이미 진행 중이면 기존 요청 재사용
  const requestKey = uniq.sort().join(',');
  if (activeRequests.has(requestKey)) {
    return activeRequests.get(requestKey)!;
  }

  const onProgress = options?.onProgress;
  const onBatchPhase = options?.onBatchPhase;
  const exchangeMap = options?.exchangeMap ?? {};
  const total = uniq.length;

  const requestPromise = (async () => {
    try {
      const results: YahooQuoteResult[] = [];
      // 429 쿨다운 제거(요청: 대기 없이 진행)

      // 1) 배치: 미국/기타 한 번에, 한국은 2종목씩 작은 청크로 요청(청크 간 1.5초 지연)해 429 회피.
      const requestedSymbols = uniq.map((s) => s.trim().toUpperCase());
      const krTickers = requestedSymbols.filter((s) => isKRWStock(s));
      const batchTickers = requestedSymbols.filter((s) => !isKRWStock(s));
      const batchResults = new Map<string, YahooQuoteResult>();
      if (batchTickers.length > 0) {
        onBatchPhase?.(`배치 요청: 미국/기타 ${batchTickers.length}개`);
        const lookupSymbols: string[] = [];
        const seen = new Set<string>();
        for (const s of batchTickers) {
          for (const c of buildLookupCandidates(s)) {
            if (!seen.has(c)) {
              seen.add(c);
              lookupSymbols.push(c);
            }
          }
        }
        try {
          const chunkMap = await fetchFromYahooQuoteBatch(batchTickers, lookupSymbols);
          for (const [ticker, quote] of chunkMap.entries()) {
            batchResults.set(ticker, quote);
            setCachedQuote(ticker, quote);
            results.push(quote);
          }
          onBatchPhase?.(`배치 응답: 미국/기타 ${chunkMap.size}/${batchTickers.length} 성공`);
        } catch (err) {
          if (err instanceof RateLimitError) {
            console.warn("[시세] 배치 429. 종목별 chart 폴백 진행.");
            onBatchPhase?.(`배치 실패 (429): 종목별 fallback`);
          } else throw err;
        }
      }
      const KR_BATCH_CHUNK = 15; // 429 회피하면서 속도 개선 (6→15, 지연 1.2s→0.5s)
      if (krTickers.length > 0) {
        await new Promise((r) => setTimeout(r, 500)); // 미국 배치 직후 429 회피
      }
      if (krTickers.length > 0) {
        onBatchPhase?.(`배치 요청: 한국 ${krTickers.length}개 (${Math.ceil(krTickers.length / KR_BATCH_CHUNK)}개 청크)`);
      }
      // 한국: exchange가 있으면 suffix 1개만 요청, 없으면 KS/KQ 둘 다 요청 후 최신 regularMarketTime 기준으로 유령 티커 제거
      let krSuccessCount = 0;
      for (let i = 0; i < krTickers.length; i += KR_BATCH_CHUNK) {
        const chunk = krTickers.slice(i, i + KR_BATCH_CHUNK);
        const chunkLookup = chunk.flatMap((s) => buildLookupCandidates(s, exchangeMap[s]));
        if (chunkLookup.length === 0) continue;
        try {
          const chunkMap = await fetchFromYahooQuoteBatch(chunk, chunkLookup);
          for (const [ticker, quote] of chunkMap.entries()) {
            batchResults.set(ticker, quote);
            setCachedQuote(ticker, quote);
            results.push(quote);
          }
          krSuccessCount += chunkMap.size;
        } catch (err) {
          if (err instanceof RateLimitError) {
            console.warn("[시세] 한국 배치 청크 429. 나머지 한국 종목은 chart 폴백.");
            onBatchPhase?.(`배치 실패 (429): 한국 청크, 종목별 fallback`);
            break;
          }
          // 네트워크 등 기타 오류 시 해당 청크만 스킵
        }
        if (i + KR_BATCH_CHUNK < krTickers.length) {
          await new Promise((r) => setTimeout(r, 500)); // 청크 간 0.5초 (429 발생 시 다시 늘릴 수 있음)
        }
      }
      if (krTickers.length > 0) {
        onBatchPhase?.(`배치 응답: 한국 ${krSuccessCount}/${krTickers.length} 성공`);
      }

      const fallbackCount = uniq.filter((r) => !batchResults.has(r.trim().toUpperCase())).length;
      if (fallbackCount > 0) {
        onBatchPhase?.(`개별 fallback 시작: ${fallbackCount}종목 (종목당 200~300ms 지연)`);
      }

      for (let i = 0; i < uniq.length; i++) {
        const raw = uniq[i];
        const requestedSymbol = raw.trim().toUpperCase();
        if (batchResults.has(requestedSymbol)) {
          onProgress?.(i + 1, total, requestedSymbol, "✅ 성공 (배치)");
          continue;
        }

        const cached = getCachedQuote(requestedSymbol);
        if (cached) {
          results.push(cached);
          onProgress?.(i + 1, total, requestedSymbol, "⚡ 완료 (캐시)");
          continue;
        }

        let quote: YahooQuoteResult | null = null;
        try {
          // 배치가 실패(429 등)했으면 Yahoo 대신 Stooq 먼저 시도(미국 종목 등)
          if (batchResults.size === 0) {
            try {
              quote = await fetchFromStooq(requestedSymbol);
            } catch (err) {
              if (err instanceof RateLimitError) throw err;
            }
          }
          if (!quote) {
            const chartDelayMs = isKRWStock(requestedSymbol) ? 300 : 200; // 개별 차트 폴백 지연 (429 발생 시 500/400 등으로 늘릴 수 있음)
            for (const lookupSymbol of buildLookupCandidates(requestedSymbol, exchangeMap[requestedSymbol])) {
              try {
                await new Promise((r) => setTimeout(r, chartDelayMs));
                quote = await fetchFromYahooChart(requestedSymbol, lookupSymbol);
                if (quote) break;
              } catch (err) {
                if (err instanceof RateLimitError) throw err;
                // 조용히 실패 처리 (프록시/서버 문제 가능)
              }
            }
          }
          if (!quote) {
            try {
              quote = await fetchFromStooq(requestedSymbol);
            } catch (err) {
              if (err instanceof RateLimitError) throw err;
            }
          }
        } catch (err) {
          if (err instanceof RateLimitError) {
            console.warn("[시세] 429 Too Many Requests. 해당 종목 스킵, 나머지 계속.");
            onProgress?.(i + 1, total, requestedSymbol, "⏭️ 스킵 (429)");
            continue;
          }
          throw err;
        }

        if (quote) {
          setCachedQuote(requestedSymbol, quote);
          results.push(quote);
          onProgress?.(i + 1, total, requestedSymbol, "✅ 성공");
        } else {
          onProgress?.(i + 1, total, requestedSymbol, "❌ 실패 (데이터 없음)");
        }
      }

      // 한국 주식: 야후 영문명 대신 로컬 한글명(krNames)으로 덮어쓰기
      const krMap = getKrNames();
      for (const quote of results) {
        if (isKRWStock(quote.ticker)) {
          const krKey = canonicalTickerForMatch(quote.ticker);
          const krName = krMap[krKey];
          if (krName) quote.name = krName;
        }
      }

      if (results.length) return results;
      return [];
    } finally {
      activeRequests.delete(requestKey);
    }
  })();

  activeRequests.set(requestKey, requestPromise);
  return requestPromise;
}

export async function searchYahooSymbol(
  query: string
): Promise<Array<{ ticker: string; name?: string }>> {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed) return [];

  const isKoreanTicker = isKRWStock(trimmed);
  const queries = isKoreanTicker
    ? [`${trimmed}.KS`, `${trimmed}.KQ`, trimmed]
    : [trimmed];

  const allResults: Array<{ ticker: string; name?: string }> = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const innerUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0`;
      const proxyUrls = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(innerUrl)}`,
        `https://corsproxy.io/?${innerUrl}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(innerUrl)}`
      ];

      let payloadStr = "";
      for (const proxyUrl of proxyUrls) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        try {
          const res = await fetch(proxyUrl, { signal: controller.signal });
          if (res.ok) {
            payloadStr = await res.text();
            if (payloadStr) break;
          }
        } catch {
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (!payloadStr) continue;

      let data: YahooSearchResponse;
      try {
        data = JSON.parse(payloadStr);
      } catch {
        continue;
      }

      const list = data.quotes ?? [];

      list.forEach((quote) => {
        if (!quote.symbol) return;
        const rawTicker = (quote.symbol as string).toUpperCase();
        const key = rawTicker.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
        if (seen.has(key)) return;
        seen.add(key);

        let finalTicker = key;
        let finalName = (quote.longname || quote.shortname || quote.symbol || key) as string;
        if (
          (finalName.includes("-USD") || finalName.includes("-KRW")) &&
          !finalTicker.includes("-")
        ) {
          const temp = finalTicker;
          finalTicker = finalName;
          finalName = temp;
        }
        allResults.push({ ticker: finalTicker, name: finalName });
      });
    } catch (err) {
      console.warn("yahoo search failed for", q, err);
    }
  }

  // 강제 추가: 6자리 한국 티커인데 검색 결과 0개면 사용자 입력을 그대로 결과로 추가 (우선주/ETN 등 야후 미지원 대비)
  if (allResults.length === 0 && isKoreanTicker && trimmed.length === 6) {
    allResults.push({ ticker: trimmed, name: trimmed });
  }

  return allResults;
}
