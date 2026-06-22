/**
 * 포트폴리오 성과 — A0~A3을 한 번에 조합하는 UI 진입점.
 * 평가액 시계열(A0) → 현금흐름 제거 TWR(A2) → 벤치마크 비교(A1) → 리스크 지표(A3) → 베타.
 */
import type { AppData, HistoricalDailyClose } from "../types";
import { getTodayKST, addDaysToIso } from "./date";
import {
  buildDailyPortfolioValueSeries,
  buildFxHistory,
  firstTradeDate,
  type DailyPortfolioPoint,
} from "./portfolioHistory";
import { buildDailyNetFlowKRW, buildTwrReturnSeries, summarizeTwr, type TwrPoint } from "./twr";
import { buildBenchmarkComparison, type BenchmarkComparison } from "./portfolioBenchmark";
import { computeBeta, computeRiskMetrics, type RiskMetrics } from "./riskMetrics";

export type PerformancePeriod = "3M" | "6M" | "1Y" | "ALL";

interface PortfolioPerformance {
  valueSeries: DailyPortfolioPoint[];
  twr: TwrPoint[];
  /** 비교 구간 TWR 수익률 (소수) */
  twrReturnPct: number;
  annualizedPct: number | null;
  benchmark: BenchmarkComparison | null;
  risk: RiskMetrics;
  beta: number | null;
  startDate: string;
  endDate: string;
}

const PERIOD_DAYS: Record<Exclude<PerformancePeriod, "ALL">, number> = { "3M": 90, "6M": 180, "1Y": 365 };
/** 달력일 일별 그리드 기준 연율화 */
const PERIODS_PER_YEAR = 365;

/** 벤치마크 티커 정규화 — 지수 심볼(^KS11 등)은 단순 대문자 트림 (stock canonical 매칭 미사용) */
const normBench = (t: string): string => (t ?? "").trim().toUpperCase();

export function performanceStartDate(
  period: PerformancePeriod,
  today: string,
  firstTrade: string | null
): string {
  if (period === "ALL" || !firstTrade) return firstTrade ?? today;
  const cutoff = addDaysToIso(today, -PERIOD_DAYS[period]);
  return cutoff > firstTrade ? cutoff : firstTrade;
}

export function buildPortfolioPerformance(params: {
  data: Pick<
    AppData,
    "trades" | "accounts" | "historicalDailyCloses" | "historicalDailyFx" | "marketEnvSnapshots" | "benchmarkDailyCloses"
  >;
  fxRate: number | null;
  benchmarkTicker?: string;
  benchmarkLabel?: string;
  period?: PerformancePeriod;
  /** 종료일 (기본 오늘 KST) — 테스트 결정성용 */
  endDate?: string;
}): PortfolioPerformance | null {
  const { data, fxRate } = params;
  const trades = data.trades ?? [];
  if (trades.length === 0) return null;

  const endDate = params.endDate ?? getTodayKST();
  const first = firstTradeDate(trades);
  const startDate = performanceStartDate(params.period ?? "ALL", endDate, first);
  const fxHistory = buildFxHistory(data.historicalDailyFx, data.marketEnvSnapshots);

  const valueSeries = buildDailyPortfolioValueSeries({
    trades,
    accounts: data.accounts ?? [],
    historicalDailyCloses: data.historicalDailyCloses ?? [],
    fxHistory,
    fallbackFxRate: fxRate,
    startDate,
    endDate,
  });
  if (valueSeries.length === 0) return null;

  const flows = buildDailyNetFlowKRW(trades, fxHistory, fxRate);
  const twr = buildTwrReturnSeries(valueSeries, flows);
  const summary = summarizeTwr(twr);
  const risk = computeRiskMetrics(twr, { periodsPerYear: PERIODS_PER_YEAR });

  let benchmark: BenchmarkComparison | null = null;
  let beta: number | null = null;
  if (params.benchmarkTicker) {
    const key = normBench(params.benchmarkTicker);
    const benchmarkCloses = (data.benchmarkDailyCloses ?? [])
      .filter((c) => normBench(c.ticker) === key)
      .map((c) => ({ date: c.date, close: c.close }));
    benchmark = buildBenchmarkComparison({
      twr,
      benchmarkCloses,
      benchmarkLabel: params.benchmarkLabel ?? params.benchmarkTicker,
    });
    if (benchmark) {
      const portReturns: number[] = [];
      const benchReturns: number[] = [];
      for (let i = 1; i < benchmark.series.length; i += 1) {
        const p0 = benchmark.series[i - 1].portfolio;
        const p1 = benchmark.series[i].portfolio;
        const b0 = benchmark.series[i - 1].benchmark;
        const b1 = benchmark.series[i].benchmark;
        if (p0 > 0 && b0 > 0) {
          portReturns.push(p1 / p0 - 1);
          benchReturns.push(b1 / b0 - 1);
        }
      }
      beta = computeBeta(portReturns, benchReturns);
    }
  }

  return {
    valueSeries,
    twr,
    twrReturnPct: summary.returnPct,
    annualizedPct: summary.annualizedPct,
    benchmark,
    risk,
    beta,
    startDate: valueSeries[0].date,
    endDate,
  };
}

/** 새로 fetch한 벤치마크 종가로 해당 티커 분을 통째 교체 (refetch 시 무한 증가 방지) */
export function upsertBenchmarkCloses(
  existing: HistoricalDailyClose[] | undefined,
  ticker: string,
  fetched: Array<{ date: string; close: number }>
): HistoricalDailyClose[] {
  const key = normBench(ticker);
  const kept = (existing ?? []).filter((c) => normBench(c.ticker) !== key);
  const add: HistoricalDailyClose[] = fetched
    .filter((f) => f?.date && Number(f.close) > 0)
    .map((f) => ({ ticker: key, date: f.date, close: f.close }));
  return [...kept, ...add].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)
  );
}
