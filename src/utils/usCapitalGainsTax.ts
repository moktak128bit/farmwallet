/**
 * 해외(미국)주식 양도소득세 (B3) — 연 250만 기본공제, 22%(양도세 20%+지방세 2%).
 *
 * 한국 세법: 해외주식 양도차익은 손익통산 후 연 250만 공제, 초과분 22% 분류과세(다음해 5월 신고).
 * 정확한 과세표준은 KRW 기준 — 매입가(매입 시점 환율)와 매도가(매도 시점 환율)를 각각 환산해야
 * 환율 변동까지 반영된다. 그래서 lot별 매입 환율을 추적하는 전용 FIFO를 쓴다
 * (computeRealizedPnlByTradeId의 단일 환율 converter로는 부정확).
 *
 * 손실수확(tax-loss harvesting): 보유 중 평가손실을 연내 실현하면 실현 양도차익과 통산돼 세금이 준다.
 */
import type { PositionRow, StockTrade } from "../types";
import { isUSDStock, canonicalTickerForMatch } from "./finance";
import { positionMarketValueKRW } from "../calculations";
import { fxAsOf, type FxPoint } from "./portfolioHistory";

/** 해외주식 양도소득 연 기본공제 (원) */
export const FOREIGN_CG_BASIC_DEDUCTION = 2_500_000;
/** 양도소득세 20% + 지방소득세 2% */
const FOREIGN_CG_TAX_RATE = 0.22;

interface HarvestCandidate {
  ticker: string;
  name: string;
  accountName: string;
  /** 평가손실 규모 (양수, 원) */
  unrealizedLossKRW: number;
}

interface ForeignCapitalGainsTax {
  year: number;
  /** 올해 USD종목 실현 양도차익 (손익통산, KRW, 매입·매도 각 시점 환율) */
  realizedGainKRW: number;
  deduction: number;
  /** max(0, realized − 공제) */
  taxableGain: number;
  estimatedTax: number;
  /** 비과세로 더 실현 가능한 이익 (공제 여유) */
  deductionRemaining: number;
  harvestCandidates: HarvestCandidate[];
  /** 손실 후보 합 (양수) */
  harvestableLossKRW: number;
  /** 평가손실을 전부 실현하면 줄어드는 세금 */
  taxSavingIfHarvestAll: number;
}

function tradeCmp(a: StockTrade, b: StockTrade): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.side === "buy" && b.side === "sell") return -1;
  if (a.side === "sell" && b.side === "buy") return 1;
  return a.id.localeCompare(b.id);
}

/**
 * USD 종목의 해당 연도 실현 양도차익(KRW, 손익통산). 매입 lot의 환율과 매도 시점 환율로 각각 환산.
 * FIFO는 전체 거래로 큐를 유지하되, 합산은 해당 연도 매도분만.
 */
export function realizedForeignGainKRW(
  trades: StockTrade[],
  year: number,
  fxHistory: FxPoint[],
  fallbackFxRate?: number | null
): number {
  const yearStr = String(year);
  const byKey = new Map<string, StockTrade[]>();
  for (const t of trades) {
    if (!t.date || !isUSDStock(t.ticker)) continue;
    const key = `${t.accountId}::${canonicalTickerForMatch(t.ticker)}`;
    const arr = byKey.get(key);
    if (arr) arr.push(t);
    else byKey.set(key, [t]);
  }

  let total = 0;
  for (const ts of byKey.values()) {
    const sorted = [...ts].sort(tradeCmp);
    type Lot = { qty: number; usd: number; fx: number };
    const queue: Lot[] = [];
    for (const t of sorted) {
      const fx = t.fxRateAtTrade ?? fxAsOf(fxHistory, t.date, fallbackFxRate) ?? 0;
      if (t.side === "buy") {
        queue.push({ qty: t.quantity, usd: t.totalAmount, fx });
        continue;
      }
      let remaining = t.quantity;
      let costKRW = 0;
      while (remaining > 0 && queue.length > 0) {
        const lot = queue[0];
        const use = Math.min(remaining, lot.qty);
        const unitUsd = lot.qty > 0 ? lot.usd / lot.qty : 0;
        costKRW += unitUsd * use * lot.fx;
        lot.qty -= use;
        lot.usd = unitUsd * lot.qty;
        remaining -= use;
        if (lot.qty <= 0) queue.shift();
      }
      const proceedsKRW = t.totalAmount * fx;
      if (t.date.startsWith(yearStr)) total += proceedsKRW - costKRW;
    }
  }
  return total;
}

export function buildForeignCapitalGainsTax(params: {
  trades: StockTrade[];
  /** 현재 보유 포지션 (computePositions 결과) — 손실수확 후보 판정용 */
  positions: PositionRow[];
  year: number;
  fxHistory: FxPoint[];
  fxRate: number | null;
}): ForeignCapitalGainsTax {
  const { trades, positions, year, fxHistory, fxRate } = params;

  const realizedGainKRW = realizedForeignGainKRW(trades, year, fxHistory, fxRate);
  const deduction = FOREIGN_CG_BASIC_DEDUCTION;
  const taxableGain = Math.max(0, realizedGainKRW - deduction);
  const estimatedTax = taxableGain * FOREIGN_CG_TAX_RATE;
  const deductionRemaining = Math.max(0, deduction - realizedGainKRW);

  const harvestCandidates: HarvestCandidate[] = [];
  for (const p of positions) {
    const isUsd =
      p.marketCurrency === "USD" || (p.marketCurrency !== "KRW" && isUSDStock(p.ticker));
    if (!isUsd) continue;
    const marketKRW = positionMarketValueKRW(p, fxRate);
    const costKRW = p.totalBuyAmountKRW ?? (fxRate ? p.totalBuyAmount * fxRate : p.totalBuyAmount);
    const loss = costKRW - marketKRW;
    if (loss > 0 && marketKRW > 0) {
      harvestCandidates.push({
        ticker: p.ticker,
        name: p.name,
        accountName: p.accountName,
        unrealizedLossKRW: loss,
      });
    }
  }
  harvestCandidates.sort((a, b) => b.unrealizedLossKRW - a.unrealizedLossKRW);

  const harvestableLossKRW = harvestCandidates.reduce((s, c) => s + c.unrealizedLossKRW, 0);
  const newTaxable = Math.max(0, realizedGainKRW - harvestableLossKRW - deduction);
  const taxSavingIfHarvestAll = Math.max(0, estimatedTax - newTaxable * FOREIGN_CG_TAX_RATE);

  return {
    year,
    realizedGainKRW,
    deduction,
    taxableGain,
    estimatedTax,
    deductionRemaining,
    harvestCandidates,
    harvestableLossKRW,
    taxSavingIfHarvestAll,
  };
}
