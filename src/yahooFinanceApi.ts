export interface YahooQuoteResult {
  ticker: string;
  name?: string;
  price: number;
  currency?: string;
  change?: number;
  changePercent?: number;
  updatedAt?: string;
}

// API 호출 캐싱
const quoteCache = new Map<string, { data: YahooQuoteResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5분

function getCachedQuote(symbol: string): YahooQuoteResult | null {
  const cached = quoteCache.get(symbol);
  if (!cached) return null;
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    quoteCache.delete(symbol);
    return null;
  }
  return cached.data;
}

function setCachedQuote(symbol: string, data: YahooQuoteResult): void {
  quoteCache.set(symbol, { data, timestamp: Date.now() });
}

// 캐시 정리 (오래된 항목 제거)
function cleanCache(): void {
  const now = Date.now();
  for (const [key, value] of quoteCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      quoteCache.delete(key);
    }
  }
}

// 주기적으로 캐시 정리 (5분마다)
if (typeof window !== "undefined") {
  setInterval(cleanCache, 5 * 60 * 1000);
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
    }>;
  };
}

export async function fetchYahooBatchQuotes(symbols: string[]): Promise<YahooQuoteResult[]> {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean)));
  if (!uniq.length) return [];

  const results: YahooQuoteResult[] = [];
  const symbolsToFetch: string[] = [];

  // 캐시에서 먼저 확인
  for (const symbol of uniq) {
    const key = symbol.trim().toUpperCase();
    const cached = getCachedQuote(key);
    if (cached) {
      results.push(cached);
    } else {
      symbolsToFetch.push(key);
    }
  }

  if (symbolsToFetch.length === 0) return results;

  const chunkSize = 30;
  const chunks: string[][] = [];
  for (let i = 0; i < symbolsToFetch.length; i += chunkSize) {
    chunks.push(symbolsToFetch.slice(i, i + chunkSize));
  }

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

        const quote: YahooQuoteResult = {
          ticker: item.symbol.toUpperCase(),
          name: item.longName ?? item.shortName ?? item.symbol,
          price: item.regularMarketPrice,
          currency: item.currency,
          change,
          changePercent,
          updatedAt
        };
        
        // 캐시에 저장
        setCachedQuote(quote.ticker, quote);
        results.push(quote);
      });
    } catch (err) {
      console.warn("batch quote chunk failed", chunk.slice(0, 3), err);
    }
    // 가벼운 딜레이로 서버 부담 완화
    await new Promise((r) => setTimeout(r, 200));
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
  console.log('ticker.json 파일에서 티커 목록 읽는 중...');
  const { koreanTickers, usTickers } = await loadTickersFromFile();
  
  const results: Array<{
    ticker: string;
    name: string;
    market: 'KR' | 'US';
    exchange?: string;
  }> = [];
  
  console.log(`한국 티커 ${koreanTickers.length}개, 미국 티커 ${usTickers.length}개 발견`);
  
  // 한국 티커 처리 (파일에서 읽은 데이터 그대로 사용)
  koreanTickers.forEach(({ ticker, name }) => {
    results.push({
      ticker,
      name,
      market: 'KR',
      exchange: undefined
    });
  });
  console.log(`한국 종목 ${koreanTickers.length}개 처리 완료`);
  
  // 미국 티커 처리 (종목명이 없으면 티커를 종목명으로 사용)
  usTickers.forEach(({ ticker, name }) => {
    results.push({
      ticker,
      name: name || ticker, // 종목명이 없으면 티커 사용
      market: 'US',
      exchange: 'NYSE' // 기본값
    });
  });
  console.log(`미국 종목 ${usTickers.length}개 처리 완료`);
  console.log(`총 ${results.length}개 티커 목록 생성 완료`);
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
  console.log('초기 티커 목록 생성 시작 (ticker.txt 파일 사용)...');
  
  try {
    const results = await fetchTickersFromFile();
    return results;
  } catch (err) {
    console.error('ticker.json 파일에서 티커 목록 읽기 실패, 기본 목록 사용:', err);
    
    // 폴백: 기존 방식 사용
    const results: Array<{
      ticker: string;
      name: string;
      market: 'KR' | 'US';
      exchange?: string;
    }> = [];
    
    // 한국 종목 가져오기
    console.log('한국 코스피/코스닥 종목 가져오는 중...');
    const koreaStocks = await fetchKoreaTopStocks();
    koreaStocks.forEach(s => {
      results.push({
        ticker: s.ticker,
        name: s.name || s.ticker,
        market: 'KR',
        exchange: s.exchange
      });
    });
    console.log(`한국 종목 ${koreaStocks.length}개 추가됨`);
    
    // 미국 종목 가져오기
    console.log('미국 주요 종목 가져오는 중...');
    const usStocks = await fetchUSTopStocks();
    usStocks.forEach(s => {
      results.push({
        ticker: s.ticker,
        name: s.name || s.ticker,
        market: 'US',
        exchange: s.exchange
      });
    });
    console.log(`미국 종목 ${usStocks.length}개 추가됨`);
    
    console.log(`총 ${results.length}개 티커 목록 생성 완료`);
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


const buildLookupCandidates = (symbol: string) => {
  const cleaned = symbol.trim().toUpperCase();
  
  // BRK.A, BRK.B 같은 경우 점(.)을 하이픈(-)으로 변환
  // 야후 파이낸스에서는 BRK-A, BRK-B 형식으로 검색해야 함
  if (cleaned.includes(".") && /^[A-Z]+\.[A-Z]$/.test(cleaned)) {
    const hyphenated = cleaned.replace(/\./g, "-");
    return [hyphenated, cleaned]; // 하이픈 형식 우선, 원본도 시도
  }
  
  // 한국 주식 티커 패턴: 6자리 (숫자만 또는 숫자+알파벳 조합)
  // 예: 005930, 0053L0, 000660 등
  if (/^[0-9A-Z]{6}$/.test(cleaned) && /[0-9]/.test(cleaned)) {
    // 한국 6자리 티커: KOSPI(.KS) 우선, 안 되면 KOSDAQ(.KQ), 마지막으로 원문 시도
    return [`${cleaned}.KS`, `${cleaned}.KQ`, cleaned];
  }
  
  // 순수 숫자 6자리도 한국 주식일 가능성 높음
  if (/^[0-9]{6}$/.test(cleaned)) {
    return [`${cleaned}.KS`, `${cleaned}.KQ`, cleaned];
  }
  
  return [cleaned];
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
  const proxyUrl = `${ALL_ORIGINS_PROXY}${encodeURIComponent(innerUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
};

const fetchFromStooq = async (requestedSymbol: string): Promise<YahooQuoteResult | null> => {
  const url = `${STOOQ_BASE}?s=${encodeURIComponent(
    requestedSymbol.toLowerCase()
  )}.us&f=sd2t2ohlcv&h&e=json`;
  const res = await fetch(url);
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
};

export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuoteResult[]> {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean)));
  if (uniq.length === 0) return [];

  const results: YahooQuoteResult[] = [];
  const symbolsToFetch: string[] = [];

  // 캐시에서 먼저 확인
  for (const raw of uniq) {
    const requestedSymbol = raw.trim().toUpperCase();
    const cached = getCachedQuote(requestedSymbol);
    if (cached) {
      results.push(cached);
    } else {
      symbolsToFetch.push(requestedSymbol);
    }
  }

  // 캐시에 없는 것만 API 호출
  for (const raw of symbolsToFetch) {
    const requestedSymbol = raw.trim().toUpperCase();
    let quote: YahooQuoteResult | null = null;

    for (const lookupSymbol of buildLookupCandidates(requestedSymbol)) {
      try {
        quote = await fetchFromYahooChart(requestedSymbol, lookupSymbol);
        if (quote) break;
      } catch (err) {
        console.warn("yahoo chart fetch failed", lookupSymbol, err);
      }
    }

    if (!quote) {
      try {
        quote = await fetchFromStooq(requestedSymbol);
      } catch (err) {
        console.warn("stooq fetch failed", err);
      }
    }

    if (quote) {
      setCachedQuote(requestedSymbol, quote);
      results.push(quote);
    }
  }

  if (results.length) return results;

  throw new Error("야후에서 시세를 불러오지 못했습니다.");
}

export async function searchYahooSymbol(
  query: string
): Promise<Array<{ ticker: string; name?: string }>> {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed) return [];
  
  // 한국 주식 티커 패턴: 6자리 (숫자만 또는 숫자+알파벳 조합)
  // 예: 005930, 0053L0, 000660 등
  const isKoreanTicker = /^[0-9A-Z]{6}$/.test(trimmed) && /[0-9]/.test(trimmed);
  const queries = isKoreanTicker 
    ? [trimmed, `${trimmed}.KS`, `${trimmed}.KQ`]
    : [trimmed];
  
  const allResults: Array<{ ticker: string; name?: string }> = [];
  const seen = new Set<string>();
  
  for (const q of queries) {
    try {
  const innerUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
        q
      )}&quotesCount=15&newsCount=0`;
  // raw 응답으로 받아 contents 파싱 단계를 줄인다.
  const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(innerUrl)}`;
  const res = await fetch(url);
      if (!res.ok) continue;
  const data = (await res.json()) as YahooSearchResponse;
  const list = data.quotes ?? [];
      
      list.forEach((quote) => {
        if (!quote.symbol) return;
        const ticker = (quote.symbol as string).toUpperCase();
        const key = ticker.replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
        if (seen.has(key)) return;
        seen.add(key);
        allResults.push({
          ticker,
          name: quote.longname ?? quote.shortname ?? quote.symbol
        });
      });
    } catch (err) {
      console.warn("yahoo search failed for", q, err);
    }
  }
  
  return allResults;
}

