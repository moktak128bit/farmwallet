/**
 * 벤치마크 비교 (A1) — 내 포트폴리오 수익률(TWR)을 시장 지수(KOSPI/S&P500 등)와 같은 기간으로 비교.
 *
 * 정합성 핵심: 평가액이 아니라 **TWR 지수**(현금흐름 제거, A2)와 비교한다 — 적립식 입금을 수익으로
 * 착각하지 않기 위해. 또 포트와 지수를 **둘 다 데이터가 있는 공통 시작일**에 100으로 리베이스해야
 * 공정한 같은-기간 비교가 된다 (지수 데이터가 늦게 시작하면 그 날부터 정렬).
 *
 * 초과수익(alpha) = 포트 수익률 − 지수 수익률. 양수면 시장을 이긴 것.
 */
import type { TwrPoint } from "./twr";

interface BenchmarkClose {
  date: string;
  close: number;
}

export interface BenchmarkPoint {
  date: string;
  /** 공통 시작일=100 기준 포트폴리오 TWR 지수 */
  portfolio: number;
  /** 공통 시작일=100 기준 벤치마크 지수 */
  benchmark: number;
}

export interface BenchmarkComparison {
  series: BenchmarkPoint[];
  /** 비교 구간 포트폴리오 수익률 (소수) */
  portfolioReturnPct: number;
  /** 비교 구간 벤치마크 수익률 (소수) */
  benchmarkReturnPct: number;
  /** 초과수익 alpha = portfolio − benchmark (소수) */
  excessReturnPct: number;
  /** 실제 비교 시작일 (포트·지수 둘 다 데이터가 있는 첫날) */
  startDate: string;
  benchmarkLabel: string;
}

/** date 이전(포함) 가장 최근 종가 — 휴장일 보정 */
function closeAsOf(sorted: BenchmarkClose[], date: string): number | null {
  let best: number | null = null;
  for (const c of sorted) {
    if (c.date <= date) best = c.close;
    else break;
  }
  return best;
}

/**
 * TWR 지수 시계열(A2) + 벤치마크 일별 종가 → 같은 기간 정규화 비교.
 * 벤치마크 데이터가 부족하면(공통 구간 없음) null 반환.
 */
export function buildBenchmarkComparison(params: {
  twr: TwrPoint[];
  benchmarkCloses: BenchmarkClose[];
  benchmarkLabel: string;
}): BenchmarkComparison | null {
  const { twr, benchmarkLabel } = params;
  if (twr.length === 0) return null;

  const benchSorted = params.benchmarkCloses
    .filter((c) => c?.date && Number(c.close) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (benchSorted.length === 0) return null;

  // 공통 시작일: 포트와 지수 둘 다 데이터가 있는 첫 TWR 날짜
  let startIdx = -1;
  let benchBase = 0;
  for (let i = 0; i < twr.length; i += 1) {
    const b = closeAsOf(benchSorted, twr[i].date);
    if (b != null && b > 0) {
      startIdx = i;
      benchBase = b;
      break;
    }
  }
  if (startIdx < 0) return null;

  const portBase = twr[startIdx].returnIndex || 100;
  const series: BenchmarkPoint[] = [];
  for (let i = startIdx; i < twr.length; i += 1) {
    const b = closeAsOf(benchSorted, twr[i].date);
    if (b == null || b <= 0) continue;
    series.push({
      date: twr[i].date,
      portfolio: (twr[i].returnIndex / portBase) * 100,
      benchmark: (b / benchBase) * 100,
    });
  }
  if (series.length === 0) return null;

  const last = series[series.length - 1];
  const portfolioReturnPct = last.portfolio / 100 - 1;
  const benchmarkReturnPct = last.benchmark / 100 - 1;
  return {
    series,
    portfolioReturnPct,
    benchmarkReturnPct,
    excessReturnPct: portfolioReturnPct - benchmarkReturnPct,
    startDate: series[0].date,
    benchmarkLabel,
  };
}
