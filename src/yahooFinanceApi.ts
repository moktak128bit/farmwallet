import { isKRWStock } from "./utils/finance";

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

export async function fetchYahooBatchQuotes(symbols: string[]): Promise<YahooQuoteResult[]> {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean)));
  if (!uniq.length) return [];

  const chunkSize = 30;
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += chunkSize) {
    chunks.push(uniq.slice(i, i + chunkSize));
  }

  const results: YahooQuoteResult[] = [];

  for (const chunk of chunks) {
    const qs = new URLSearchParams({ symbols: chunk.join(",") });
    try {
      const res = await fetch(`/api/yahoo-quote?${qs.toString()}`);
      if (!res.ok) continue;
      const data = (await res.json()) as YahooQuoteApiResponse;
      const list = data.quoteResponse?.result ?? [];
      list.forEach((item) => {
        if (!item.symbol || typeof item.regularMarketPrice !== "number") return;
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

        results.push({
          ticker: item.symbol.toUpperCase(),
          name: item.longName ?? item.shortName ?? item.symbol,
          price: item.regularMarketPrice,
          currency: item.currency,
          change,
          changePercent,
          updatedAt,
          sector: item.sector,
          industry: item.industry
        });
      });
    } catch (err) {
      console.warn("batch quote chunk failed", chunk.slice(0, 3), err);
    }
    // 가벼운 딜레이로 서버 부담 완화 (429 방지)
    await new Promise((r) => setTimeout(r, 400));
  }

  return results;
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
 */
async function fetchTickersFromFile(): Promise<Array<{
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
const ALL_ORIGINS_PROXY = "https://api.allorigins.win/get?url=";
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


/** exchange: 사용자가 지정한 거래소(KOSPI/KOSDAQ)가 있으면 그에 맞춰 .KS/.KQ 우선순위 결정 */
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
  
  // 한국 주식: 사용자 지정 exchange 우선, 없으면 티커 패턴으로 추정
  if (isKRWStock(cleaned)) {
    const ks = `${cleaned}.KS`;
    const kq = `${cleaned}.KQ`;
    if (exchange === "KOSPI") return [ks, kq, cleaned];
    if (exchange === "KOSDAQ") return [kq, ks, cleaned];
    const isKospi = /^0[0-3][0-9A-Z]{4}$/.test(cleaned);
    return isKospi ? [ks, kq, cleaned] : [kq, ks, cleaned];
  }

  return [cleaned];
};

/** 429 Too Many Requests */
class RateLimitError extends Error {
  readonly status = 429;
  constructor() {
    super("HTTP 429 Too Many Requests");
    this.name = "RateLimitError";
  }
}

// 글로벌 429 쿨다운 (여러 호출 간 공유)
let globalRateLimitUntil = 0;

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
    try {
      const qs = new URLSearchParams({ symbols: lookupSymbols.join(",") });
      const res = await fetch(`/api/yahoo-quote?${qs.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as YahooQuoteApiResponse;
        const list = data.quoteResponse?.result ?? [];
        const byClean = new Map<string, (typeof list)[number]>();
        for (const item of list) {
          const symbol = String(item?.symbol ?? "").toUpperCase();
          if (!symbol) continue;
          const key = symbol.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
          if (!byClean.has(key)) byClean.set(key, item);
        }
        const results = new Map<string, YahooQuoteResult>();
        for (const requested of requestedSymbols) {
          const key = requested.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
          const item = byClean.get(key);
          if (!item || typeof item.regularMarketPrice !== "number") continue;
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
            name: item.longName ?? item.shortName ?? requested,
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
      // 네트워크 오류 등: 아래 proxy 경로로 폴백
    }
  }

  const params = new URLSearchParams({ symbols: lookupSymbols.join(",") });
  const innerUrl = `https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`;
  const encodedUrl = encodeURIComponent(innerUrl);
  // 개발에서 429 폴백: 먼저 allorigins 직접 시도, 실패 시 /api/external (서버 경유)
  const proxyUrls = useCorsProxy()
    ? [
        `https://api.allorigins.win/get?url=${encodedUrl}`,
        `/api/external/get?url=${encodedUrl}`
      ]
    : [getAllOriginsUrl("get", encodedUrl)];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    let res: Response | null = null;
    let lastErr: unknown = null;
    for (const proxyUrl of proxyUrls) {
      try {
        res = await fetch(proxyUrl, { signal: controller.signal });
        if (res.ok) break;
        if (res.status === 429) throw new RateLimitError();
        lastErr = null;
      } catch (e) {
        lastErr = e;
        if (e instanceof RateLimitError) throw e;
      }
    }
    clearTimeout(timeoutId);
    if (!res || !res.ok) {
      if (lastErr instanceof RateLimitError) throw lastErr;
      return new Map();
    }
    const payload = (await res.json()) as {
      contents?: string;
      status?: { http_code?: number };
    };
    if (payload.status?.http_code === 429) return new Map();
    let data: YahooQuoteApiResponse;
    try {
      data = payload.contents
        ? (JSON.parse(payload.contents) as YahooQuoteApiResponse)
        : (payload as unknown as YahooQuoteApiResponse);
    } catch {
      return new Map();
    }
    const list = data.quoteResponse?.result ?? [];
    const byClean = new Map<string, (typeof list)[number]>();
    for (const item of list) {
      const symbol = String(item?.symbol ?? "").toUpperCase();
      if (!symbol) continue;
      const key = symbol.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
      if (!byClean.has(key)) byClean.set(key, item);
    }

    const results = new Map<string, YahooQuoteResult>();
    for (const requested of requestedSymbols) {
      const key = requested.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
      const item = byClean.get(key);
      if (!item) continue;
      if (typeof item.regularMarketPrice !== "number") continue;

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
        name: item.longName ?? item.shortName ?? requested,
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
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw err;
  }
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
  const proxyUrl = getAllOriginsUrl("get", encodeURIComponent(innerUrl));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      if (res.status === 429) throw new RateLimitError();
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = (await res.json()) as { contents?: string };
    const data = payload.contents
      ? (JSON.parse(payload.contents) as YahooChartResponse)
      : (payload as unknown as YahooChartResponse);

    const meta = data.chart?.result?.[0]?.meta;
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
      name: meta?.longName ?? meta?.shortName ?? requestedSymbol,
      price,
      currency: meta?.currency,
      change,
      changePercent,
      updatedAt
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
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
  onProgress?: (done: number, total: number) => void;
  /** 티커별 거래소(KOSPI/KOSDAQ). 지정 시 해당 티커는 .KS/.KQ 우선순위에 사용 */
  exchangeMap?: Record<string, string>;
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
  const exchangeMap = options?.exchangeMap ?? {};
  const total = uniq.length;

  const requestPromise = (async () => {
    try {
      const results: YahooQuoteResult[] = [];
      const now = Date.now();
      if (now < globalRateLimitUntil) {
        // 쿨다운 중이면 캐시만 반환 (추가 요청 방지). 캐시가 비어 있으면 쿨다운을 우회해 실제 요청 시도(시세 갱신이 영원히 안 되는 것 방지)
        for (const raw of uniq) {
          const requestedSymbol = raw.trim().toUpperCase();
          const cached = getCachedQuote(requestedSymbol);
          if (cached) results.push(cached);
        }
        if (results.length > 0) return results;
        // 캐시가 비었으면 쿨다운 무시하고 아래에서 실제 요청 수행
      }

      let rateLimitBackoffMs = 5000; // 429 시 지수 백오프 초기값

      // 1) 배치: 미국/기타 한 번에, 한국은 2종목씩 작은 청크로 요청(청크 간 1.5초 지연)해 429 회피.
      const requestedSymbols = uniq.map((s) => s.trim().toUpperCase());
      const krTickers = requestedSymbols.filter((s) => isKRWStock(s));
      const batchTickers = requestedSymbols.filter((s) => !isKRWStock(s));
      let batchResults = new Map<string, YahooQuoteResult>();
      if (batchTickers.length > 0) {
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
        } catch (err) {
          if (err instanceof RateLimitError) {
            globalRateLimitUntil = Date.now() + 30 * 1000;
            console.warn("[시세] 배치 429. 종목별 chart 폴백 진행.");
          } else throw err;
        }
      }
      const KR_BATCH_CHUNK = 6;
      if (krTickers.length > 0) {
        await new Promise((r) => setTimeout(r, 1200)); // 미국 배치 직후 429 회피
      }
      // 한국: 티커당 첫 번째 후보(.KQ 또는 .KS)만 배치에 넣어 요청. 한 번에 18개 보내면 Yahoo가 일부만 반환하는 경우가 있어 실패 종목이 생김.
        for (let i = 0; i < krTickers.length; i += KR_BATCH_CHUNK) {
        const chunk = krTickers.slice(i, i + KR_BATCH_CHUNK);
        const chunkLookup = chunk.map((s) => buildLookupCandidates(s, exchangeMap[s])[0]);
        if (chunkLookup.length === 0) continue;
        try {
          const chunkMap = await fetchFromYahooQuoteBatch(chunk, chunkLookup);
          for (const [ticker, quote] of chunkMap.entries()) {
            batchResults.set(ticker, quote);
            setCachedQuote(ticker, quote);
            results.push(quote);
          }
        } catch (err) {
          if (err instanceof RateLimitError) {
            globalRateLimitUntil = Date.now() + 30 * 1000;
            console.warn("[시세] 한국 배치 청크 429. 나머지 한국 종목은 chart 폴백.");
            break;
          }
          // 네트워크 등 기타 오류 시 해당 청크만 스킵
        }
        if (i + KR_BATCH_CHUNK < krTickers.length) {
          await new Promise((r) => setTimeout(r, 1200)); // 청크 간 1.2초
        }
      }

      for (let i = 0; i < uniq.length; i++) {
        const raw = uniq[i];
        const requestedSymbol = raw.trim().toUpperCase();
        if (batchResults.has(requestedSymbol)) {
          onProgress?.(i + 1, total);
          continue;
        }

        const cached = getCachedQuote(requestedSymbol);
        if (cached) {
          results.push(cached);
          onProgress?.(i + 1, total);
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
            const chartDelayMs = isKRWStock(requestedSymbol) ? 1000 : 400; // 한국 종목은 chart만 사용, 간격 넓혀 429·누락 완화
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
            console.warn("[시세] 429 Too Many Requests. 해당 종목 스킵, 나머지 계속.", rateLimitBackoffMs, "ms 쿨다운");
            globalRateLimitUntil = Date.now() + rateLimitBackoffMs;
            rateLimitBackoffMs = Math.min(rateLimitBackoffMs * 2, 60000);
            onProgress?.(i + 1, total);
            continue;
          }
          throw err;
        }

        if (quote) {
          setCachedQuote(requestedSymbol, quote);
          results.push(quote);
        }
        onProgress?.(i + 1, total);
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
  // 한국 종목: .KS/.KQ를 먼저 쿼리해 Yahoo 검색 결과가 잘 나오도록 함
  const queries = isKoreanTicker
    ? [`${trimmed}.KS`, `${trimmed}.KQ`, trimmed]
    : [trimmed];

  const allResults: Array<{ ticker: string; name?: string }> = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const innerUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
        q
      )}&quotesCount=15&newsCount=0`;
      const url = getAllOriginsUrl("raw", encodeURIComponent(innerUrl));
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as YahooSearchResponse;
      const list = data.quotes ?? [];

      list.forEach((quote) => {
        if (!quote.symbol) return;
        const rawTicker = (quote.symbol as string).toUpperCase();
        // 사용자에게는 종목 코드만 표시: .KS/.KQ 제거한 canonical 형태
        const key = rawTicker.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
        if (seen.has(key)) return;
        seen.add(key);
        allResults.push({
          ticker: key,
          name: quote.longname ?? quote.shortname ?? quote.symbol
        });
      });
    } catch (err) {
      console.warn("yahoo search failed for", q, err);
    }
  }
  
  return allResults;
}
