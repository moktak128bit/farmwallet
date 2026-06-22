/**
 * 일별 포트폴리오 평가액 시계열 (A0 키스톤) — 순수 모듈 (React 의존 없음).
 *
 * "그 날짜까지의 거래 + 그 날짜의 종가(historicalDailyCloses) + 그 날짜의 환율"로
 * computePositions를 재실행해 과거 포트폴리오 가치를 일별로 복원한다.
 * 벤치마크 비교(A1)·TWR(A2)·MDD/변동성(A3)이 모두 이 시계열에 의존하는 키스톤.
 *
 * 정합성: 월별 자산추이(accountTimeline)와 같은 프리미티브(computePositions/positionMarketValueKRW)를
 * 써서 숫자가 어긋나지 않게 한다. 차이는 "현재가 근사" 대신 "그날의 실제 종가"를 쓰는 정밀도뿐.
 *
 * 환율: fxHistory가 일별/반월 환율 이력(marketEnvSnapshots + historicalDailyFx 합본). 해당 날짜
 * 이전 이력이 없으면 fallbackFxRate(보통 현재 라이브 환율)로 보수적 환산 — 이력이 쌓이기 전 초기
 * 구간의 USD 평가가 0으로 떨어지는 것을 막는다.
 */
import type {
  Account,
  HistoricalDailyClose,
  HistoricalDailyFx,
  MarketEnvSnapshot,
  StockPrice,
  StockTrade,
} from "../types";
import { computePositions, positionMarketValueKRW } from "../calculations";
import { canonicalTickerForMatch } from "./finance";
import { addDaysToIso } from "./date";

export interface DailyPortfolioPoint {
  /** YYYY-MM-DD (KST) */
  date: string;
  /** 보유 종목 평가액 (원화 환산) */
  valueKRW: number;
  /** 보유 종목 매입원가 (원화) */
  costKRW: number;
  /** valueKRW - costKRW (미실현 손익 근사) */
  pnlKRW: number;
}

export interface FxPoint {
  date: string;
  rate: number;
}

interface PortfolioHistoryParams {
  trades: StockTrade[];
  accounts: Account[];
  historicalDailyCloses: HistoricalDailyClose[];
  /** 환율 이력 (정렬 불문) — marketEnvSnapshots + historicalDailyFx 합쳐 전달 */
  fxHistory: FxPoint[];
  /** 해당 날짜 이전 환율 이력이 없을 때 쓸 환율 (보통 현재 라이브 환율) */
  fallbackFxRate?: number | null;
  /** 시작일 (기본: 첫 거래일) */
  startDate?: string;
  /** 종료일 (KST today를 호출부가 주입 — 순수성/결정성 유지) */
  endDate: string;
  /** 샘플링 간격 — daily(기본) | weekly */
  step?: "daily" | "weekly";
}

/** computePositions의 FIFO 정렬과 동일 기준 — 정렬된 배열의 'date ≤ d' 접두는 그대로 정렬 상태 유지 */
function tradeCmp(a: StockTrade, b: StockTrade): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.side === "buy" && b.side === "sell") return -1;
  if (a.side === "sell" && b.side === "buy") return 1;
  return a.id.localeCompare(b.id);
}

/**
 * 환율 이력 단일 소스 — 일별(historicalDailyFx, 정밀) + 반월(marketEnvSnapshots, 백본)을 합본.
 * 같은 날짜는 일별 값을 우선한다. portfolioHistory·환율밴드(G2) 등 모든 과거 환율 조회의 진입점.
 */
export function buildFxHistory(
  historicalDailyFx: HistoricalDailyFx[] | undefined,
  marketEnvSnapshots: MarketEnvSnapshot[] | undefined
): FxPoint[] {
  const byDate = new Map<string, number>();
  for (const s of marketEnvSnapshots ?? []) {
    if (s?.date && Number(s.fxRate) > 0) byDate.set(s.date, s.fxRate);
  }
  // 일별이 반월보다 우선 (나중에 set)
  for (const f of historicalDailyFx ?? []) {
    if (f?.date && Number(f.rate) > 0) byDate.set(f.date, f.rate);
  }
  return Array.from(byDate.entries())
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 첫 거래일 (YYYY-MM-DD) — 없으면 null */
export function firstTradeDate(trades: StockTrade[]): string | null {
  let min: string | null = null;
  for (const t of trades) {
    if (!t.date) continue;
    if (min === null || t.date < min) min = t.date;
  }
  return min;
}

/** date 시점에 유효한 환율 — date 이전(포함) 가장 최근 이력, 없으면 fallback. 단발 조회용(O(n)). */
export function fxAsOf(fxHistory: FxPoint[], date: string, fallback?: number | null): number | null {
  let best: number | null = fallback ?? null;
  let bestDate = "";
  for (const f of fxHistory) {
    if (!f?.date || !(Number(f.rate) > 0)) continue;
    if (f.date <= date && f.date >= bestDate) {
      best = f.rate;
      bestDate = f.date;
    }
  }
  return best;
}

export function buildDailyPortfolioValueSeries(params: PortfolioHistoryParams): DailyPortfolioPoint[] {
  const { trades, accounts, historicalDailyCloses, fxHistory, fallbackFxRate, endDate, step = "daily" } = params;
  if (!endDate) return [];

  const sortedTrades = trades.filter((t) => t.date).sort(tradeCmp);
  if (sortedTrades.length === 0) return [];

  const startDate = params.startDate ?? sortedTrades[0].date;
  if (startDate > endDate) return [];

  // 종가 인덱스: canonical ticker → 날짜 오름차순 배열
  const closesByTicker = new Map<string, HistoricalDailyClose[]>();
  for (const c of historicalDailyCloses) {
    const t = canonicalTickerForMatch(c.ticker);
    if (!t || !c.date || !(Number(c.close) > 0)) continue;
    const arr = closesByTicker.get(t);
    if (arr) arr.push(c);
    else closesByTicker.set(t, [c]);
  }
  for (const arr of closesByTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  // 환율 이력 오름차순 — 날들을 오름차순 순회하므로 포인터로 전진
  const fxSorted = fxHistory
    .filter((f) => f?.date && Number(f.rate) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const stepDays = step === "weekly" ? 7 : 1;
  const closePtr = new Map<string, number>(); // ticker → date ≤ d 인 최신 종가의 인덱스
  let fxIdx = -1; // date ≤ d 인 최신 환율의 인덱스
  let tradePtr = 0; // date ≤ d 인 거래 개수
  const out: DailyPortfolioPoint[] = [];

  for (let d = startDate; d <= endDate; d = addDaysToIso(d, stepDays)) {
    while (tradePtr < sortedTrades.length && sortedTrades[tradePtr].date <= d) tradePtr += 1;
    if (tradePtr === 0) {
      out.push({ date: d, valueKRW: 0, costKRW: 0, pnlKRW: 0 });
      continue;
    }
    const tradesUpTo = sortedTrades.slice(0, tradePtr);

    while (fxIdx + 1 < fxSorted.length && fxSorted[fxIdx + 1].date <= d) fxIdx += 1;
    const fx = fxIdx >= 0 ? fxSorted[fxIdx].rate : (fallbackFxRate ?? null);

    // 보유 가능 종목들의 'd 시점 종가'로 prices 구성 (없는 종목은 priceFallback="cost"로 중립 처리)
    const pricesAsOf: StockPrice[] = [];
    for (const [ticker, arr] of closesByTicker) {
      let i = closePtr.get(ticker) ?? -1;
      while (i + 1 < arr.length && arr[i + 1].date <= d) i += 1;
      closePtr.set(ticker, i);
      if (i < 0) continue;
      const c = arr[i];
      pricesAsOf.push({ ticker, price: c.close, currency: c.currency, updatedAt: c.date });
    }

    const positions = computePositions(tradesUpTo, pricesAsOf, accounts, {
      fxRate: fx ?? undefined,
      priceFallback: "cost"
    });
    let valueKRW = 0;
    let costKRW = 0;
    for (const p of positions) {
      valueKRW += positionMarketValueKRW(p, fx);
      costKRW += p.totalBuyAmountKRW ?? p.totalBuyAmount;
    }
    out.push({ date: d, valueKRW, costKRW, pnlKRW: valueKRW - costKRW });
  }

  return out;
}
