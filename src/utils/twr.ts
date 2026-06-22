/**
 * 시간가중수익률(TWR) — 입금/출금(현금흐름)의 영향을 제거한 "전략의 실력" 수익률. (A2)
 *
 * 왜 필요한가: 적립식(DCA)은 입금 때문에 평가액이 계속 오른다 → 평가액을 그대로 시장지수와 비교하면
 * 입금을 수익으로 착각한다. TWR은 입금 직전/직후를 끊어 일별 수익률을 연쇄곱해 자본 추가/회수 효과를
 * 상쇄한다. 벤치마크 비교(A1)·리스크 지표(A3)가 이 수익률 시계열을 공유한다.
 *
 * 일별 근사(기말 현금흐름 규약): r_d = (V_d − F_d) / V_(d-1) − 1
 *   V_d = d일 종가 기준 보유 평가액(원화), F_d = d일 순현금흐름(매수+, 매도−, 원화).
 * 매수일에 가격이 그대로면 V_d−V_(d-1) ≈ F_d → r_d ≈ 0 (입금은 수익이 아니다).
 */
import type { StockTrade } from "../types";
import { isUSDStock } from "./finance";
import { parseIsoLocal } from "./date";
import { fxAsOf, type DailyPortfolioPoint, type FxPoint } from "./portfolioHistory";

export interface TwrPoint {
  date: string;
  /** 시작=100 기준 누적 수익률 지수 */
  returnIndex: number;
  /** 그날의 일별 수익률 r_d (소수, 예 0.01 = +1%) */
  dailyReturn: number;
}

interface TwrSummary {
  series: TwrPoint[];
  /** 전체 기간 누적 수익률 (소수) */
  returnPct: number;
  /** 시계열 일수 (첫~마지막 점) */
  days: number;
  /** 연율화 수익률 (기간 < 7일이면 null) */
  annualizedPct: number | null;
}

/**
 * 거래에서 일자별 순현금흐름(원화) 집계 — 매수는 +(자본 투입), 매도는 −(자본 회수).
 * USD 매수는 매입 당시 환율(fxRateAtTrade), 매도는 그날 환율(fxAsOf)로 환산 (실제 오간 원화 현금에 근접).
 */
export function buildDailyNetFlowKRW(
  trades: StockTrade[],
  fxHistory: FxPoint[],
  fallbackFxRate?: number | null
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trades) {
    if (!t.date || !(Number(t.totalAmount) > 0)) continue;
    const usd = isUSDStock(t.ticker);
    if (t.side === "buy") {
      const rate = usd ? (t.fxRateAtTrade ?? fxAsOf(fxHistory, t.date, fallbackFxRate) ?? 0) : 1;
      m.set(t.date, (m.get(t.date) ?? 0) + t.totalAmount * rate);
    } else {
      const rate = usd ? (fxAsOf(fxHistory, t.date, fallbackFxRate) ?? t.fxRateAtTrade ?? 0) : 1;
      m.set(t.date, (m.get(t.date) ?? 0) - t.totalAmount * rate);
    }
  }
  return m;
}

/**
 * 일별 평가액 시계열(A0) + 일자별 순현금흐름 → TWR 수익률 지수 시계열.
 * valueSeries의 표본 간격(daily/weekly)을 그대로 따르며, 두 점 사이 구간의 현금흐름을 합산해 끊는다.
 */
export function buildTwrReturnSeries(
  valueSeries: DailyPortfolioPoint[],
  netFlowByDate: Map<string, number>
): TwrPoint[] {
  if (valueSeries.length === 0) return [];
  const flows = [...netFlowByDate.entries()]
    .filter(([d, f]) => d && Number.isFinite(f) && f !== 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const out: TwrPoint[] = [];
  let index = 100;
  for (let i = 0; i < valueSeries.length; i += 1) {
    const cur = valueSeries[i];
    if (i === 0) {
      out.push({ date: cur.date, returnIndex: 100, dailyReturn: 0 });
      continue;
    }
    const prev = valueSeries[i - 1];
    // (prev.date, cur.date] 구간의 순현금흐름 합산
    let flow = 0;
    for (const [d, f] of flows) {
      if (d > prev.date && d <= cur.date) flow += f;
    }
    let r = 0;
    if (prev.valueKRW > 0) {
      r = (cur.valueKRW - flow) / prev.valueKRW - 1;
    }
    // prev.valueKRW === 0 (시작/전량청산 후 재진입)이면 r=0 — 새 입금은 수익이 아니므로 지수 유지
    index *= 1 + r;
    out.push({ date: cur.date, returnIndex: index, dailyReturn: r });
  }
  return out;
}

export function summarizeTwr(series: TwrPoint[]): TwrSummary {
  if (series.length === 0) return { series, returnPct: 0, days: 0, annualizedPct: null };
  const returnPct = series[series.length - 1].returnIndex / 100 - 1;
  const start = parseIsoLocal(series[0].date);
  const end = parseIsoLocal(series[series.length - 1].date);
  const days =
    start && end ? Math.round((end.getTime() - start.getTime()) / 86_400_000) : 0;
  const annualizedPct =
    days >= 7 ? Math.pow(1 + returnPct, 365 / days) - 1 : null;
  return { series, returnPct, days, annualizedPct };
}
