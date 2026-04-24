import type { Account, StockTrade } from "../types";
import { canonicalTickerForMatch, isUSDStock } from "./finance";

/** 청산(매도)된 단일 거래 한 건의 실현 수익 기록. USD 종목은 거래시점 환율로 원화 환산. */
export interface ClosedTradeRecord {
  tradeId: string;
  ticker: string;
  name: string;
  accountId: string;
  sellDate: string;
  buyDateWeighted: string;
  holdingDays: number;
  sellQuantity: number;
  costBasisKRW: number;
  proceedsKRW: number;
  realizedPnlKRW: number;
  returnPct: number;
  isUsd: boolean;
}

export interface PeriodSummary {
  totalPnl: number;
  totalCost: number;
  returnPct: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitLossRatio: number;
  avgHoldingDays: number;
}

export type HoldingBucket = "1주 이하" | "1주~1개월" | "1~3개월" | "3~12개월" | "1년 이상";

export const HOLDING_BUCKETS: HoldingBucket[] = [
  "1주 이하",
  "1주~1개월",
  "1~3개월",
  "3~12개월",
  "1년 이상",
];

function bucketForDays(days: number): HoldingBucket {
  if (days <= 7) return "1주 이하";
  if (days <= 30) return "1주~1개월";
  if (days <= 90) return "1~3개월";
  if (days <= 365) return "3~12개월";
  return "1년 이상";
}

function tradeKey(accountId: string, ticker: string): string {
  const norm = canonicalTickerForMatch(ticker);
  return norm ? `${accountId}::${norm}` : "";
}

function parseDayMs(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr ?? "");
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getTime();
}

function toDateStr(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/**
 * 매도 거래를 FIFO로 매수 로트와 매칭하여 보유기간·실현손익(KRW)을 산출.
 * - USD 종목: 각 거래의 `fxRateAtTrade`로 개별 환산. 없으면 `fallbackFx`(현재 환율) 사용.
 * - KRW 종목: totalAmount 그대로.
 * - buyDateWeighted = FIFO 소비된 매수 로트 날짜들의 수량 가중평균.
 */
export function buildClosedTradeRecords(
  trades: StockTrade[],
  accounts: Account[],
  fallbackFx?: number
): ClosedTradeRecord[] {
  const accountById = new Map<string, Account>();
  for (const a of accounts) accountById.set(a.id, a);

  const groups = new Map<string, StockTrade[]>();
  for (const t of trades) {
    const key = tradeKey(t.accountId, t.ticker);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const records: ClosedTradeRecord[] = [];

  for (const [, list] of groups) {
    const sorted = [...list].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      if (a.side === "buy" && b.side === "sell") return -1;
      if (a.side === "sell" && b.side === "buy") return 1;
      return 0;
    });

    type Lot = { qty: number; totalAmountKRW: number; dateMs: number };
    const queue: Lot[] = [];

    for (const t of sorted) {
      const usd = isUSDStock(t.ticker);
      const tradeFx = t.fxRateAtTrade ?? 0;
      const fx = tradeFx > 0 ? tradeFx : (fallbackFx && fallbackFx > 0 ? fallbackFx : 0);
      const toKRW = usd ? (fx > 0 ? t.totalAmount * fx : 0) : t.totalAmount;

      if (t.side === "buy") {
        queue.push({
          qty: t.quantity,
          totalAmountKRW: toKRW,
          dateMs: parseDayMs(t.date),
        });
        continue;
      }

      let remaining = t.quantity;
      let costBasisKRW = 0;
      let weightSum = 0;
      let weightedDateMs = 0;

      while (remaining > 0 && queue.length > 0) {
        const lot = queue[0];
        const use = Math.min(remaining, lot.qty);
        const unitCost = lot.qty > 0 ? lot.totalAmountKRW / lot.qty : 0;
        const cost = unitCost * use;
        costBasisKRW += cost;
        if (Number.isFinite(lot.dateMs)) {
          weightedDateMs += lot.dateMs * use;
          weightSum += use;
        }
        remaining -= use;
        lot.qty -= use;
        lot.totalAmountKRW = unitCost * lot.qty;
        if (lot.qty <= 0) queue.shift();
      }

      const sellDateMs = parseDayMs(t.date);
      const buyDateMs = weightSum > 0 ? weightedDateMs / weightSum : sellDateMs;
      const holdingDays =
        Number.isFinite(sellDateMs) && Number.isFinite(buyDateMs)
          ? Math.max(0, Math.round((sellDateMs - buyDateMs) / 86_400_000))
          : 0;
      const proceedsKRW = toKRW;
      const realizedPnlKRW = proceedsKRW - costBasisKRW;
      const returnPct = costBasisKRW > 0 ? realizedPnlKRW / costBasisKRW : 0;
      const account = accountById.get(t.accountId);
      void account;

      records.push({
        tradeId: t.id,
        ticker: t.ticker,
        name: t.name,
        accountId: t.accountId,
        sellDate: t.date,
        buyDateWeighted: toDateStr(buyDateMs) || t.date,
        holdingDays,
        sellQuantity: t.quantity,
        costBasisKRW,
        proceedsKRW,
        realizedPnlKRW,
        returnPct,
        isUsd: usd,
      });
    }
  }

  records.sort((a, b) => b.sellDate.localeCompare(a.sellDate));
  return records;
}

/** 승/패 집계. 0원 손익 거래는 승패에서 제외하되 총합/건수엔 포함. */
export function summarizeRecords(records: ClosedTradeRecord[]): PeriodSummary {
  let totalPnl = 0;
  let totalCost = 0;
  let winCount = 0;
  let lossCount = 0;
  let winSum = 0;
  let lossSum = 0;
  let weightedDays = 0;
  let weightSum = 0;

  for (const r of records) {
    totalPnl += r.realizedPnlKRW;
    totalCost += r.costBasisKRW;
    if (r.realizedPnlKRW > 0) {
      winCount += 1;
      winSum += r.realizedPnlKRW;
    } else if (r.realizedPnlKRW < 0) {
      lossCount += 1;
      lossSum += r.realizedPnlKRW;
    }
    const weight = r.costBasisKRW > 0 ? r.costBasisKRW : 1;
    weightedDays += r.holdingDays * weight;
    weightSum += weight;
  }

  const tradeCount = records.length;
  const decided = winCount + lossCount;
  const winRate = decided > 0 ? winCount / decided : 0;
  const avgWin = winCount > 0 ? winSum / winCount : 0;
  const avgLoss = lossCount > 0 ? lossSum / lossCount : 0;
  const profitLossRatio = avgLoss < 0 ? avgWin / Math.abs(avgLoss) : 0;
  const avgHoldingDays = weightSum > 0 ? weightedDays / weightSum : 0;
  const returnPct = totalCost > 0 ? totalPnl / totalCost : 0;

  return {
    totalPnl,
    totalCost,
    returnPct,
    tradeCount,
    winCount,
    lossCount,
    winRate,
    avgWin,
    avgLoss,
    profitLossRatio,
    avgHoldingDays,
  };
}

export function groupByMonth(records: ClosedTradeRecord[]): Map<string, PeriodSummary> {
  const buckets = new Map<string, ClosedTradeRecord[]>();
  for (const r of records) {
    const ym = r.sellDate.slice(0, 7);
    const list = buckets.get(ym) ?? [];
    list.push(r);
    buckets.set(ym, list);
  }
  const out = new Map<string, PeriodSummary>();
  for (const [k, v] of buckets) out.set(k, summarizeRecords(v));
  return out;
}

export function groupByYear(records: ClosedTradeRecord[]): Map<string, PeriodSummary> {
  const buckets = new Map<string, ClosedTradeRecord[]>();
  for (const r of records) {
    const y = r.sellDate.slice(0, 4);
    const list = buckets.get(y) ?? [];
    list.push(r);
    buckets.set(y, list);
  }
  const out = new Map<string, PeriodSummary>();
  for (const [k, v] of buckets) out.set(k, summarizeRecords(v));
  return out;
}

export function groupByHoldingBucket(
  records: ClosedTradeRecord[]
): Map<HoldingBucket, PeriodSummary> {
  const buckets = new Map<HoldingBucket, ClosedTradeRecord[]>();
  for (const b of HOLDING_BUCKETS) buckets.set(b, []);
  for (const r of records) {
    const b = bucketForDays(r.holdingDays);
    buckets.get(b)!.push(r);
  }
  const out = new Map<HoldingBucket, PeriodSummary>();
  for (const b of HOLDING_BUCKETS) out.set(b, summarizeRecords(buckets.get(b)!));
  return out;
}

export interface PeriodFilter {
  kind: "all" | "year" | "month";
  year?: number;
  month?: number;
}

export function filterByPeriod(
  records: ClosedTradeRecord[],
  period: PeriodFilter
): ClosedTradeRecord[] {
  if (period.kind === "all") return records;
  if (period.kind === "year" && period.year != null) {
    const y = String(period.year);
    return records.filter((r) => r.sellDate.slice(0, 4) === y);
  }
  if (period.kind === "month" && period.year != null && period.month != null) {
    const ym = `${period.year}-${String(period.month).padStart(2, "0")}`;
    return records.filter((r) => r.sellDate.slice(0, 7) === ym);
  }
  return records;
}

/** 보유기간 max/min. 기록 없으면 0. NaN/Infinity 입력은 무시. */
export function holdingRange(records: ClosedTradeRecord[]): { min: number; max: number } {
  if (records.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = 0;
  let validCount = 0;
  for (const r of records) {
    const days = r.holdingDays;
    if (!Number.isFinite(days)) continue;
    validCount++;
    if (days < min) min = days;
    if (days > max) max = days;
  }
  if (validCount === 0) return { min: 0, max: 0 };
  return { min: min === Infinity ? 0 : min, max };
}
