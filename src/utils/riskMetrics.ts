/**
 * 리스크 지표 (A3) — TWR 수익률 시계열(A2)에서 변동성·최대낙폭·샤프·베타를 계산.
 * "수익 대비 얼마나 출렁였나"를 본다. 모두 순수 함수.
 *
 * periodsPerYear: 연율화 기준. 일별(영업일) 시계열이면 252, 주별이면 52, 달력일 기준이면 365.
 * 호출부가 시계열 표본 간격에 맞춰 전달한다 (기본 252).
 */
import type { TwrPoint } from "./twr";

export interface RiskMetrics {
  /** 연율화 변동성 (소수, 예 0.18 = 18%) */
  volatilityPct: number;
  /** 최대낙폭 — 양수 (예 0.25 = 고점 대비 −25%) */
  maxDrawdownPct: number;
  /** 샤프지수 (연율화 초과수익/변동성). 변동성 0이면 null */
  sharpe: number | null;
  /** 연율화 수익률 (소수) */
  annualizedReturnPct: number;
  /** 수익률 관측치 수 */
  observations: number;
}

/** 누적 지수 시계열의 최대낙폭 (고점 대비 최대 하락폭, 양수) */
export function maxDrawdown(indexSeries: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of indexSeries) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > mdd) mdd = dd;
    }
  }
  return mdd;
}

export function computeRiskMetrics(
  twr: TwrPoint[],
  opts?: { periodsPerYear?: number; riskFreeRatePct?: number }
): RiskMetrics {
  const periodsPerYear = opts?.periodsPerYear ?? 252;
  const rf = opts?.riskFreeRatePct ?? 0;
  const indexSeries = twr.map((p) => p.returnIndex).filter((v) => Number.isFinite(v));
  // 첫 점은 baseline(=100, dailyReturn 0)이라 수익률 관측에서 제외
  const returns = twr.slice(1).map((p) => p.dailyReturn).filter((r) => Number.isFinite(r));
  const mdd = maxDrawdown(indexSeries);
  const n = returns.length;
  if (n === 0) {
    return { volatilityPct: 0, maxDrawdownPct: mdd, sharpe: null, annualizedReturnPct: 0, observations: 0 };
  }
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const volatilityPct = Math.sqrt(variance) * Math.sqrt(periodsPerYear);

  const first = indexSeries[0] || 100;
  const last = indexSeries[indexSeries.length - 1] ?? first;
  const totalReturn = first > 0 ? last / first - 1 : 0;
  const annualizedReturnPct = Math.pow(1 + totalReturn, periodsPerYear / n) - 1;
  const sharpe = volatilityPct > 0 ? (annualizedReturnPct - rf) / volatilityPct : null;

  return { volatilityPct, maxDrawdownPct: mdd, sharpe, annualizedReturnPct, observations: n };
}

/**
 * 베타 — 포트폴리오 수익률의 시장(벤치마크) 수익률에 대한 민감도.
 * cov(p,b)/var(b). 1이면 시장과 동일, >1 더 출렁, <1 덜 출렁. 정렬된 동일 길이 수익률 배열 필요.
 */
export function computeBeta(portfolioReturns: number[], benchmarkReturns: number[]): number | null {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return null;
  const p = portfolioReturns.slice(0, n);
  const b = benchmarkReturns.slice(0, n);
  const mp = p.reduce((a, c) => a + c, 0) / n;
  const mb = b.reduce((a, c) => a + c, 0) / n;
  let cov = 0;
  let varb = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (p[i] - mp) * (b[i] - mb);
    varb += (b[i] - mb) ** 2;
  }
  if (varb === 0) return null;
  return cov / varb;
}
