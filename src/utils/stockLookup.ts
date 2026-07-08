/**
 * 종목 조회(미보유 종목 포함) — Yahoo v8 chart(events=div) 응답 파싱 + 요약 통계 (순수, 네트워크/env 의존 없음).
 * 네트워크 호출은 yahooFinanceApi.fetchStockLookup에서 수행하고 이 모듈로 파싱을 위임한다.
 */
import { parseHistoricalCloses } from "./yahooChartParse";
import { addDaysToIso } from "./date";

/** Yahoo v8 chart + events=div 응답 (필요 필드만) */
interface YahooChartWithEventsLike {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        longName?: string;
        shortName?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      events?: {
        dividends?: Record<string, { amount?: number; date?: number }>;
      };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

export interface DailyClose {
  date: string;
  close: number;
}

/** 주당 배당 이벤트 — date는 배당락일(KST 환산) */
export interface DividendEvent {
  date: string;
  amount: number;
}

export interface StockLookupData {
  closes: DailyClose[];
  dividends: DividendEvent[];
  meta: {
    symbol?: string;
    currency?: string;
    name?: string;
    price?: number;
    /** 마지막 거래 시각(unix초) — 유령(상장폐지 잔재) 판정용 */
    marketTime?: number;
    /** fetch 계층에서 설정 — 마지막 거래가 30일 초과 과거(거래정지/상장폐지 추정) */
    stale?: boolean;
  };
}

/**
 * chart 응답 → 일별 종가 + 배당 이벤트 + 메타.
 * 종가는 yahooChartParse.parseHistoricalCloses와 동일 규칙(KST 환산, close>0만, 날짜 오름차순).
 * 배당은 amount>0만, 날짜 오름차순. 같은 날짜 중복 이벤트는 마지막 값.
 */
export function parseChartWithDividends(data: YahooChartWithEventsLike): StockLookupData {
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const byDate = new Map<string, number>();
  for (const ev of Object.values(result?.events?.dividends ?? {})) {
    const amount = ev?.amount;
    const ts = ev?.date;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) continue;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    // yahooChartParse와 동일한 KST 환산 패턴 (unix초 + 9h → 날짜)
    const date = new Date((ts + 9 * 60 * 60) * 1000).toISOString().slice(0, 10);
    byDate.set(date, amount);
  }
  const dividends = Array.from(byDate.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const price =
    typeof meta?.regularMarketPrice === "number" && meta.regularMarketPrice > 0
      ? meta.regularMarketPrice
      : undefined;
  const marketTime =
    typeof meta?.regularMarketTime === "number" && meta.regularMarketTime > 0
      ? meta.regularMarketTime
      : undefined;
  return {
    closes: parseHistoricalCloses(data),
    dividends,
    meta: {
      symbol: meta?.symbol,
      currency: meta?.currency,
      name: meta?.longName || meta?.shortName || undefined,
      price,
      marketTime
    }
  };
}

interface StockLookupSummary {
  /** 조회 구간 마지막 종가 */
  lastClose: number | null;
  /** 조회 구간 첫 종가 대비 변동률(%) */
  rangeChangePct: number | null;
  /** 기준일로부터 365일 내 최고/최저 종가 (구간이 짧으면 있는 범위 내) */
  high52w: number | null;
  low52w: number | null;
  /** 기준일로부터 365일 내 주당 배당 합계(TTM) */
  ttmDividend: number;
  /** TTM 배당 횟수 */
  ttmDividendCount: number;
  /** TTM 주당 배당 ÷ 현재가(또는 마지막 종가) × 100 */
  ttmYieldPct: number | null;
  /** 조회 구간이 1년(360일 이상)을 덮는지 — false면 TTM 값이 실제 연간보다 적을 수 있음 */
  ttmCoversFullYear: boolean;
  /** 연도별 주당 배당 합계 (최근 연도 먼저). partial=조회 구간이 연도 일부만 덮는 부분합 */
  dividendsByYear: Array<{ year: string; total: number; count: number; partial: boolean }>;
}

/**
 * 조회 결과 요약 통계. referenceDate(YYYY-MM-DD, KST 오늘)를 기준으로 TTM/52주 구간을 자른다.
 * @param currentPrice 실시간 시세가 있으면 우선 사용 (없으면 마지막 종가로 수익률 계산)
 */
export function buildLookupSummary(
  data: StockLookupData,
  referenceDate: string,
  currentPrice?: number | null
): StockLookupSummary {
  const { closes, dividends } = data;
  const lastClose = closes.length > 0 ? closes[closes.length - 1].close : null;
  const firstClose = closes.length > 0 ? closes[0].close : null;
  const priceForCalc =
    currentPrice != null && currentPrice > 0 ? currentPrice : lastClose;

  const rangeChangePct =
    firstClose != null && firstClose > 0 && priceForCalc != null
      ? ((priceForCalc - firstClose) / firstClose) * 100
      : null;

  const yearAgo = addDaysToIso(referenceDate, -365);
  const closes52w = closes.filter((c) => c.date >= yearAgo && c.date <= referenceDate);
  const high52w = closes52w.length > 0 ? Math.max(...closes52w.map((c) => c.close)) : null;
  const low52w = closes52w.length > 0 ? Math.min(...closes52w.map((c) => c.close)) : null;

  const ttmDividends = dividends.filter((d) => d.date > yearAgo && d.date <= referenceDate);
  const ttmDividend = ttmDividends.reduce((sum, d) => sum + d.amount, 0);
  const ttmYieldPct =
    priceForCalc != null && priceForCalc > 0 && ttmDividend > 0
      ? (ttmDividend / priceForCalc) * 100
      : null;

  const byYear = new Map<string, { total: number; count: number }>();
  for (const d of dividends) {
    const year = d.date.slice(0, 4);
    const prev = byYear.get(year) ?? { total: 0, count: 0 };
    byYear.set(year, { total: prev.total + d.amount, count: prev.count + 1 });
  }
  // 조회 구간 시작일 — 시작 연도는 연초를 못 덮어 부분합, 기준 연도는 진행 중이라 부분합
  const windowStart =
    [closes[0]?.date, dividends[0]?.date].filter((d): d is string => Boolean(d)).sort()[0] ??
    referenceDate;
  const dividendsByYear = Array.from(byYear.entries())
    .map(([year, v]) => ({
      year,
      total: v.total,
      count: v.count,
      partial: `${year}-01-01` < windowStart || year === referenceDate.slice(0, 4)
    }))
    .sort((a, b) => b.year.localeCompare(a.year));

  const ttmCoversFullYear =
    closes.length > 0 && closes[0].date <= addDaysToIso(referenceDate, -360);

  return {
    lastClose,
    rangeChangePct,
    high52w,
    low52w,
    ttmDividend,
    ttmDividendCount: ttmDividends.length,
    ttmYieldPct,
    ttmCoversFullYear,
    dividendsByYear
  };
}
