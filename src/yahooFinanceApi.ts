import { canonicalTickerForMatch, cleanTicker, isKRWStock, isUSDStock } from "./utils/finance";
import { getKrNames } from "./storage";

interface YahooQuoteResult {
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

/** Naver 실시간 시세 polling API 응답 — 한국 종목 1차 소스 */
interface NaverPollingResponse {
  datas?: Array<{
    itemCode?: string;
    stockName?: string;
    closePrice?: string;
    compareToPreviousClosePrice?: string;
    fluctuationsRatio?: string;
    localTradedAt?: string;
  }>;
}

/**
 * 한국 코스피/코스닥 주요 종목 목록 가져오기
 * 야후 파이낸스 검색 API를 사용하여 주요 종목들 검색
 */
async function fetchKoreaTopStocks(): Promise<Array<{ ticker: string; name?: string; exchange?: string }>> {
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
async function fetchUSTopStocks(): Promise<Array<{ ticker: string; name?: string; exchange?: string }>> {
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
const NAVER_POLLING_BASE = "https://polling.finance.naver.com/api/realtime/domestic/stock";

const getEnv = (): Record<string, string | boolean | undefined> =>
  (typeof import.meta !== "undefined"
    ? (import.meta as { env?: Record<string, string | boolean | undefined> }).env
    : undefined) ?? {};
const useCorsProxy = (): boolean => getEnv().DEV === true || getEnv().MODE === "development";


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

/** Naver 시세 숫자 파싱 — "13,145" 같은 콤마 문자열 */
const parseNaverNumber = (raw?: string): number => Number(String(raw ?? "").replace(/,/g, ""));

/**
 * 한국 종목 시세 — Naver polling API (1차 소스).
 * Yahoo와 달리 실시간(지연 0)이고, 신형 영숫자 코드(0180V0 등)·한글 종목명·콤마 배치 조회를
 * 모두 지원한다. (Yahoo v7 quote는 2023년부터 cookie+crumb 인증을 요구해 무조건 401 → 제거됨)
 */
const fetchFromNaverPolling = async (
  requestedSymbols: string[]
): Promise<Map<string, YahooQuoteResult>> => {
  const results = new Map<string, YahooQuoteResult>();
  if (requestedSymbols.length === 0) return results;
  const codes = requestedSymbols.map((s) => cleanTicker(s)).join(",");

  let payloadStr = "";
  // 개발 환경: vite 프록시 (CORS 우회 + 10초 캐시)
  if (useCorsProxy()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`/api/naver-quote?codes=${encodeURIComponent(codes)}`, {
        signal: controller.signal
      });
      if (res.status === 429) throw new RateLimitError();
      if (res.ok) payloadStr = await res.text();
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      // 네트워크 오류·timeout 등: 아래 공개 프록시 경로로 폴백
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 프로덕션(정적 배포) 또는 dev 프록시 실패: 공개 CORS 프록시 경유
  // (Naver는 브라우저 외부 출처 직접 호출 시 'Invalid CORS request' 403)
  if (!payloadStr) {
    const innerUrl = `${NAVER_POLLING_BASE}/${codes}`;
    const proxyUrls = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(innerUrl)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(innerUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(innerUrl)}`
    ];
    let saw429 = false;
    for (const proxyUrl of proxyUrls) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(proxyUrl, { signal: controller.signal });
        if (res.status === 429) {
          saw429 = true; // 다음 예비 프록시 시도 — 전부 실패하면 RateLimitError
        } else if (res.ok) {
          payloadStr = await res.text();
          if (payloadStr) break;
        }
      } catch {
        // 조용히 다음 예비 프록시로
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (!payloadStr && saw429) throw new RateLimitError();
  }

  if (!payloadStr) return results;

  let data: NaverPollingResponse;
  try {
    const parsed: unknown = JSON.parse(payloadStr);
    data = (parsed && typeof parsed === "object" ? parsed : {}) as NaverPollingResponse;
  } catch {
    return results;
  }

  const byCode = new Map<string, NonNullable<NaverPollingResponse["datas"]>[number]>();
  for (const item of data.datas ?? []) {
    const code = String(item?.itemCode ?? "").toUpperCase();
    if (code) byCode.set(code, item);
  }

  for (const requested of requestedSymbols) {
    const item = byCode.get(cleanTicker(requested));
    if (!item) continue;
    const price = parseNaverNumber(item.closePrice);
    if (!Number.isFinite(price) || price <= 0) continue; // 0/NaN 시세는 결과에서 제외
    // fluctuationsRatio는 부호 포함("-0.61") — compareToPreviousClosePrice가 무부호인 응답에 대비해 부호를 비율에서 보정
    const changePercent = Number(item.fluctuationsRatio);
    let change = parseNaverNumber(item.compareToPreviousClosePrice);
    if (Number.isFinite(change) && Number.isFinite(changePercent) && changePercent < 0 && change > 0) {
      change = -change;
    }
    const tradedAtMs = item.localTradedAt ? Date.parse(item.localTradedAt) : NaN;
    results.set(requested, {
      ticker: requested,
      name: item.stockName || requested,
      price,
      currency: "KRW",
      change: Number.isFinite(change) ? change : undefined,
      changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
      updatedAt: Number.isFinite(tradedAtMs)
        ? new Date(tradedAtMs).toISOString()
        : new Date().toISOString()
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
    // 개발 환경: vite 서버 프록시 우선 (불안정한 공개 프록시 의존 제거 + 10초 캐시)
    ...(useCorsProxy() ? [`/api/external/raw?url=${encodeURIComponent(innerUrl)}`] : []),
    `https://api.allorigins.win/raw?url=${encodeURIComponent(innerUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(innerUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(innerUrl)}`
  ];

  let payloadStr = "";
  let saw429 = false;
  for (const proxyUrl of proxyUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(proxyUrl, { signal: controller.signal });
      if (res.status === 429) {
        saw429 = true; // 다음 예비 프록시 시도 — 전부 실패하면 RateLimitError
      } else if (res.ok) {
        payloadStr = await res.text();
        if (payloadStr && !payloadStr.includes("Not Found")) break;
      }
    } catch {
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!payloadStr) {
    // 모든 프록시 실패 + 429 발생 → 호출부 429 분기(해당 종목 스킵)가 동작하도록 throw
    if (saw429) throw new RateLimitError();
    return null;
  }

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
  if (price == null || !(price > 0)) return null; // 0/NaN 시세는 실패로 취급 (0원·-100% 오염 방지)

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

const fetchFromStooq = async (requestedSymbol: string): Promise<YahooQuoteResult | null> => {
  const sym = `${requestedSymbol.toLowerCase()}.us`;
  const query = `s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=json`;
  const url = useCorsProxy() ? `/api/stooq?${query}` : `${STOOQ_BASE}?${query}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    // 429면 throw — 호출부의 RateLimitError 분기(재throw·스킵)가 동작
    if (res.status === 429) throw new RateLimitError();
    if (!res.ok) return null;
    const json = (await res.json()) as {
      symbols?: Array<{ symbol: string; name?: string; close?: string }>;
    };
    const item = json.symbols?.[0];
    const price = item?.close ? Number(item.close) : NaN;
    if (!item?.symbol || !(price > 0)) return null; // 0/NaN 시세는 실패로 취급
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

type FetchYahooQuotesOptions = {
  /** 진행률 및 종목별 성공/실패 로그용 (done, total, ticker?, status?) */
  onProgress?: (done: number, total: number, ticker?: string, status?: string) => void;
  /** 티커별 거래소(KOSPI/KOSDAQ). 지정 시 해당 티커는 .KS/.KQ 우선순위에 사용 */
  exchangeMap?: Record<string, string>;
  /** 배치 단계별 상태 로그 (개별 fallback 들어가기 전 가시성용) */
  onBatchPhase?: (phase: string) => void;
  /** 배치(Naver) 성공분을 느린 종목별 폴백 완료 전에 먼저 반영하고 싶을 때 */
  onPartialResults?: (results: YahooQuoteResult[]) => void;
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
  const onPartialResults = options?.onPartialResults;
  const exchangeMap = options?.exchangeMap ?? {};
  const total = uniq.length;

  const requestPromise = (async () => {
    try {
      const results: YahooQuoteResult[] = [];

      // 1) 한국 종목: Naver polling 배치 — 실시간(지연 0)·한글명·신형 영숫자 코드(0180V0 등) 지원.
      //    미국/기타(USDKRW=X 포함)는 아래 종목별 Yahoo v8 chart 경로로 조회.
      const requestedSymbols = uniq.map((s) => s.trim().toUpperCase());
      const krTickers = requestedSymbols.filter((s) => isKRWStock(s));
      const batchResults = new Map<string, YahooQuoteResult>();
      const NAVER_CHUNK = 20;
      if (krTickers.length > 0) {
        onBatchPhase?.(`Naver 배치 요청: 한국 ${krTickers.length}개 (${Math.ceil(krTickers.length / NAVER_CHUNK)}개 청크)`);
        for (let i = 0; i < krTickers.length; i += NAVER_CHUNK) {
          const chunk = krTickers.slice(i, i + NAVER_CHUNK);
          try {
            const chunkMap = await fetchFromNaverPolling(chunk);
            for (const [ticker, quote] of chunkMap.entries()) {
              batchResults.set(ticker, quote);
              setCachedQuote(ticker, quote);
              results.push(quote);
            }
          } catch (err) {
            if (err instanceof RateLimitError) {
              console.warn("[시세] Naver 배치 429. 나머지 한국 종목은 chart 폴백.");
              onBatchPhase?.(`Naver 배치 실패 (429): 종목별 fallback`);
              break;
            }
            // 네트워크 등 기타 오류 시 해당 청크만 스킵 (종목별 chart 폴백이 처리)
          }
          if (i + NAVER_CHUNK < krTickers.length) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        onBatchPhase?.(`Naver 배치 응답: 한국 ${batchResults.size}/${krTickers.length} 성공`);
        // 배치 성공분 즉시 반영 — 느린 종목별 폴백을 기다리지 않고 화면 먼저 갱신
        if (batchResults.size > 0 && onPartialResults) {
          const krMap = getKrNames();
          onPartialResults(
            [...batchResults.values()].map((q) => {
              const krName = krMap[canonicalTickerForMatch(q.ticker)];
              return krName ? { ...q, name: krName } : q;
            })
          );
        }
      }

      const fallbackCount = uniq.filter((r) => !batchResults.has(r.trim().toUpperCase())).length;
      if (fallbackCount > 0) {
        onBatchPhase?.(`개별 조회 시작: ${fallbackCount}종목 (Yahoo chart, 종목당 200~300ms 지연)`);
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
          const chartDelayMs = isKRWStock(requestedSymbol) ? 300 : 200; // 개별 차트 지연 (429 발생 시 500/400 등으로 늘릴 수 있음)
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
          // Stooq는 심볼에 .us를 강제하므로 미국 티커에만 의미 있음 (한국/특수 심볼은 생략)
          if (!quote && isUSDStock(requestedSymbol)) {
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

async function searchYahooSymbol(
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
        `https://corsproxy.io/?url=${encodeURIComponent(innerUrl)}`,
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
