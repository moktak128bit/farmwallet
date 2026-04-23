/**
 * 종목별 매매 성과 집계.
 * 여러 계좌에 걸쳐 같은 ticker(canonical)는 합침.
 * 현재 보유 수량 > 0인 종목만 반환 (완전 청산 후 재진입 시 자동으로 다시 보임).
 * 정렬: totalReturnKRW 내림차순 (실현 + 미실현 + 배당).
 */
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import { buildClosedTradeRecords } from "./investmentRecord";
import { computePositions, positionMarketValueKRW } from "../calculations";
import { canonicalTickerForMatch, extractTickerFromText, isUSDStock } from "./finance";

export interface TickerPerformance {
  /** 표시용: 원래 티커 문자열 (뒤 .KS 같은 접미사 제거 전) */
  tickerDisplay: string;
  /** 매칭용: 정규화된 6자리/대문자 티커 */
  tickerCanonical: string;
  name: string;
  isUsd: boolean;
  /** 합산된 현재 보유 수량 (모든 계좌) */
  currentQuantity: number;
  /** 현재 보유 원가 (KRW, 로트별 매입 당시 환율 적용) */
  currentCostBasisKRW: number;
  /** 현재 보유 평가액 (KRW) */
  currentMarketValueKRW: number;
  /** 미실현손익 = marketValue - cost */
  unrealizedPnlKRW: number;
  /** 누적 실현손익 (모든 매도 FIFO 매칭 합, KRW) */
  realizedPnlKRW: number;
  /** 누적 배당 수령액 (KRW, ledger에서 ticker 추출 매칭) */
  dividendsKRW: number;
  /** 총 수익 = realized + unrealized + dividends */
  totalReturnKRW: number;
  /** 총 매매 건수 (buy + sell) */
  tradeCount: number;
  /** 완료된 라운드 수 (= ClosedTradeRecord 개수 = 매도 건수 중 매칭된 것) */
  closedCount: number;
  winCount: number;
  lossCount: number;
  /** 승률 %, 완료 0이면 null */
  winRate: number | null;
  /** 평균 보유기간 (일), 완료 0이면 null */
  avgHoldingDays: number | null;
  firstTradeDate: string;
  lastActionDate: string;
  lastActionSide: "buy" | "sell";
}

function isDividendIncomeEntry(entry: LedgerEntry): boolean {
  if (entry.kind !== "income") return false;
  return (
    (entry.category ?? "").includes("배당") ||
    (entry.subCategory ?? "").includes("배당") ||
    (entry.description ?? "").includes("배당")
  );
}

export function computeTickerPerformance(
  trades: StockTrade[],
  accounts: Account[],
  prices: StockPrice[],
  ledger: LedgerEntry[],
  fxRate: number | null,
): TickerPerformance[] {
  if (trades.length === 0) return [];

  // 1. 실현 손익 (매도별 FIFO 매칭) — 이미 KRW 환산
  const closedRecords = buildClosedTradeRecords(trades, accounts, fxRate ?? undefined);

  // 2. 현재 포지션 (계좌×티커별)
  const positions = computePositions(trades, prices, accounts, {
    fxRate: fxRate ?? undefined,
    priceFallback: "cost",
  });

  // 3. 트레이드를 canonical ticker별로 그룹화
  type Group = { ticker: string; name: string; trades: StockTrade[]; isUsd: boolean };
  const byTicker = new Map<string, Group>();
  for (const t of trades) {
    const canonical = canonicalTickerForMatch(t.ticker);
    if (!canonical) continue;
    const existing = byTicker.get(canonical);
    if (existing) {
      existing.trades.push(t);
      if (!existing.name && t.name) existing.name = t.name;
    } else {
      byTicker.set(canonical, {
        ticker: t.ticker,
        name: t.name || t.ticker,
        trades: [t],
        isUsd: isUSDStock(t.ticker),
      });
    }
  }

  // 4. 현재 포지션을 canonical ticker로 집계 (KRW)
  const curByCanonical = new Map<string, { qty: number; costKrw: number; marketKrw: number }>();
  for (const p of positions) {
    const canonical = canonicalTickerForMatch(p.ticker);
    if (!canonical) continue;
    const isUsd = isUSDStock(p.ticker);
    const costKrw = isUsd
      ? p.totalBuyAmountKRW ?? (fxRate ? p.totalBuyAmount * fxRate : 0)
      : p.totalBuyAmount;
    const marketKrw = positionMarketValueKRW(p, fxRate);
    const prev = curByCanonical.get(canonical) ?? { qty: 0, costKrw: 0, marketKrw: 0 };
    curByCanonical.set(canonical, {
      qty: prev.qty + p.quantity,
      costKrw: prev.costKrw + costKrw,
      marketKrw: prev.marketKrw + marketKrw,
    });
  }

  // 5. 실현 손익을 canonical ticker로 집계
  const realizedByTicker = new Map<
    string,
    { sum: number; count: number; wins: number; holdingDaysSum: number }
  >();
  for (const rec of closedRecords) {
    const canonical = canonicalTickerForMatch(rec.ticker);
    if (!canonical) continue;
    const prev = realizedByTicker.get(canonical) ?? { sum: 0, count: 0, wins: 0, holdingDaysSum: 0 };
    realizedByTicker.set(canonical, {
      sum: prev.sum + rec.realizedPnlKRW,
      count: prev.count + 1,
      wins: prev.wins + (rec.realizedPnlKRW >= 0 ? 1 : 0),
      holdingDaysSum: prev.holdingDaysSum + rec.holdingDays,
    });
  }

  // 6. 배당을 canonical ticker로 집계 (거래가 있던 티커만)
  const toKrw = (entry: LedgerEntry): number =>
    entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
  const dividendsByTicker = new Map<string, number>();
  for (const entry of ledger) {
    if (!isDividendIncomeEntry(entry)) continue;
    const sourceTicker =
      extractTickerFromText(entry.description ?? "") ??
      extractTickerFromText(entry.subCategory ?? "") ??
      extractTickerFromText(entry.category ?? "");
    if (!sourceTicker) continue;
    const canonical = canonicalTickerForMatch(sourceTicker);
    if (!canonical || !byTicker.has(canonical)) continue;
    dividendsByTicker.set(canonical, (dividendsByTicker.get(canonical) ?? 0) + toKrw(entry));
  }

  // 7. 조립 — 현재 보유 수량 > 0인 종목만
  const out: TickerPerformance[] = [];
  for (const [canonical, info] of byTicker) {
    const cur = curByCanonical.get(canonical) ?? { qty: 0, costKrw: 0, marketKrw: 0 };
    if (cur.qty <= 0) continue; // 완전 청산 종목은 숨김 (사용자 요구)

    const realized = realizedByTicker.get(canonical) ?? { sum: 0, count: 0, wins: 0, holdingDaysSum: 0 };
    const dividendsKRW = dividendsByTicker.get(canonical) ?? 0;
    const unrealizedPnlKRW = cur.marketKrw - cur.costKrw;
    const totalReturnKRW = realized.sum + unrealizedPnlKRW + dividendsKRW;

    const sorted = [...info.trades].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    out.push({
      tickerDisplay: info.ticker,
      tickerCanonical: canonical,
      name: info.name,
      isUsd: info.isUsd,
      currentQuantity: cur.qty,
      currentCostBasisKRW: cur.costKrw,
      currentMarketValueKRW: cur.marketKrw,
      unrealizedPnlKRW,
      realizedPnlKRW: realized.sum,
      dividendsKRW,
      totalReturnKRW,
      tradeCount: info.trades.length,
      closedCount: realized.count,
      winCount: realized.wins,
      lossCount: realized.count - realized.wins,
      winRate: realized.count > 0 ? (realized.wins / realized.count) * 100 : null,
      avgHoldingDays: realized.count > 0 ? realized.holdingDaysSum / realized.count : null,
      firstTradeDate: first.date,
      lastActionDate: last.date,
      lastActionSide: last.side,
    });
  }

  out.sort((a, b) => b.totalReturnKRW - a.totalReturnKRW);
  return out;
}
