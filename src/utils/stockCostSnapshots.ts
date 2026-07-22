/**
 * 주식 매입액 vs 평가액 — 월 1일·15일 "진짜 스냅샷" 시계열 (순수 모듈).
 *
 * 각 스냅샷 날짜의 값은 다음으로 고정된다:
 *  - 보유 종목·수량·원가: 그 날짜까지의 거래만 FIFO 적용 (이후 매도가 과거를 바꾸지 않음)
 *  - 시세·환율: 그 날짜의 박제(marketEnvSnapshots) 우선 → 없으면 현재 시세/환율 폴백
 *
 * ⚠ 예전 버그: 평가액·USD 환산이 전부 '현재' 시세·환율이라 과거 점이 매일 다시 그려졌다
 *   ("1일에 A·B, 15일에 B·C를 들고 있었다"는 사실은 맞았지만 그 평가액이 박제가 아니었다).
 *   박제가 있는 날짜의 점은 이제 불변이다. 박제가 없는 옛 날짜만 현재 시세 폴백으로 움직인다
 *   — TotalAssetTrendCard와 동일 정책(박제 우선, 폴백 시 출처 표시).
 */
import type { Account, MarketEnvSnapshot, StockPrice, StockTrade } from "../types";
import { canonicalTickerForMatch, isUSDStock } from "./finance";
import { buildHalfMonthSnapshotDates } from "./date";

export type PriceSource = "snapshot" | "current" | "none";

export interface StockSnapshotHolding {
  ticker: string;
  name: string;
  accountName: string;
  quantity: number;
  /** 매입 평단가 (USD 종목=USD, KRW 종목=KRW) */
  avgPriceNative: number;
  /** 적용 시세 (박제 우선, 원통화). 없으면 null */
  priceNative: number | null;
  /** 적용 시세의 출처 — 박제/현재/없음 */
  priceSource: PriceSource;
  isUsd: boolean;
  costKrw: number;
  marketKrw: number;
}

export interface StockSnapshotPoint {
  date: string; // YYYY-MM-DD (매월 1일·15일 + 오늘)
  cost: number; // 매입액 합계 (KRW)
  market: number; // 평가액 합계 (KRW)
  /** 이 점의 환율 출처 — 박제 스냅샷이 있으면 "snapshot" (점이 불변), 없으면 "current" */
  fxSource: "snapshot" | "current";
  holdings: StockSnapshotHolding[];
}

/** 박제 스냅샷의 시세를 정규 티커 키로 인덱싱 (TotalAssetTrendCard와 동일 규칙) */
export function buildSnapshotPriceIndex(
  snap: MarketEnvSnapshot
): Map<string, { price: number; currency?: string }> {
  const out = new Map<string, { price: number; currency?: string }>();
  for (const p of snap.prices) {
    const key = canonicalTickerForMatch(p.ticker) ?? p.ticker.toUpperCase();
    if (!key) continue;
    if (typeof p.price !== "number" || !Number.isFinite(p.price)) continue;
    out.set(key, { price: p.price, currency: p.currency });
  }
  return out;
}

function buildCurrentPriceIndex(prices: StockPrice[]): Map<string, { price: number }> {
  const latest = new Map<string, { price: number; updatedAt?: string }>();
  for (const p of prices) {
    const key = canonicalTickerForMatch(p.ticker) ?? p.ticker.toUpperCase();
    if (!key) continue;
    if (typeof p.price !== "number" || !Number.isFinite(p.price)) continue;
    const prev = latest.get(key);
    if (!prev || (p.updatedAt ?? "") >= (prev.updatedAt ?? "")) {
      latest.set(key, { price: p.price, updatedAt: p.updatedAt });
    }
  }
  const out = new Map<string, { price: number }>();
  latest.forEach((v, k) => out.set(k, { price: v.price }));
  return out;
}

interface BuildStockCostSnapshotsParams {
  trades: StockTrade[];
  accounts: Account[];
  prices: StockPrice[];
  marketEnvSnapshots?: MarketEnvSnapshot[];
  fxRate: number | null;
  today: string; // YYYY-MM-DD (KST)
  /** 연금계좌(isPension) 보유분 제외 */
  excludePension?: boolean;
}

export function buildStockCostSnapshots(params: BuildStockCostSnapshotsParams): StockSnapshotPoint[] {
  const { trades, accounts, prices, marketEnvSnapshots, fxRate, today, excludePension } = params;

  const securitiesAccountIds = new Set<string>();
  const pensionAccountIds = new Set<string>();
  const accountNameById = new Map<string, string>();
  for (const a of accounts) {
    if (a.type === "securities" || a.type === "crypto") securitiesAccountIds.add(a.id);
    if (a.isPension) pensionAccountIds.add(a.id);
    accountNameById.set(a.id, a.name ?? a.id);
  }
  if (securitiesAccountIds.size === 0) return [];

  const sortedTrades = [...trades]
    .filter((t) => !!t.date && !!t.ticker)
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      // 같은 날은 매수 먼저 — computePositions·FIFO 실현손익과 동일 규칙 (오버셀 방지)
      if (a.side === "buy" && b.side === "sell") return -1;
      if (a.side === "sell" && b.side === "buy") return 1;
      return a.id.localeCompare(b.id);
    });
  if (sortedTrades.length === 0) return [];

  const dates = buildHalfMonthSnapshotDates(sortedTrades[0].date.slice(0, 10), today);
  if (dates.length === 0) dates.push(today);

  const currentPriceIndex = buildCurrentPriceIndex(prices);
  const snapByDate = new Map<string, MarketEnvSnapshot>();
  for (const s of marketEnvSnapshots ?? []) snapByDate.set(s.date, s);

  type Lot = { qty: number; totalAmount: number; fxRateAtTrade?: number };
  type GroupMeta = { accountId: string; tickerNorm: string; name: string; usd: boolean };
  const queues = new Map<string, Lot[]>();
  const metaByKey = new Map<string, GroupMeta>();

  let tradeIdx = 0;
  const applyTradesThrough = (upTo: string) => {
    while (tradeIdx < sortedTrades.length && sortedTrades[tradeIdx].date.slice(0, 10) <= upTo) {
      const t = sortedTrades[tradeIdx];
      const norm = canonicalTickerForMatch(t.ticker) ?? t.ticker.toUpperCase();
      const key = `${t.accountId}::${norm}`;
      let q = queues.get(key);
      if (!q) {
        q = [];
        queues.set(key, q);
      }
      const existingMeta = metaByKey.get(key);
      if (!existingMeta) {
        metaByKey.set(key, {
          accountId: t.accountId,
          tickerNorm: norm,
          name: t.name || norm,
          usd: isUSDStock(norm),
        });
      } else if (t.name) {
        existingMeta.name = t.name;
      }
      if (t.side === "buy") {
        q.push({ qty: t.quantity, totalAmount: t.totalAmount, fxRateAtTrade: t.fxRateAtTrade });
      } else {
        let remaining = t.quantity;
        while (remaining > 0 && q.length > 0) {
          const lot = q[0];
          const use = Math.min(remaining, lot.qty);
          const unitCost = lot.qty > 0 ? lot.totalAmount / lot.qty : 0;
          lot.qty -= use;
          lot.totalAmount = unitCost * lot.qty;
          remaining -= use;
          if (lot.qty <= 0) q.shift();
        }
      }
      tradeIdx += 1;
    }
  };

  const out: StockSnapshotPoint[] = [];

  for (const snapDate of dates) {
    applyTradesThrough(snapDate);

    const savedSnap = snapByDate.get(snapDate);
    // 그 날짜의 박제 환율 우선 — 현재 환율로 과거 USD 점이 흔들리지 않게
    const effectiveFx = savedSnap?.fxRate ?? (fxRate ?? 0);
    const snapshotPriceIndex = savedSnap ? buildSnapshotPriceIndex(savedSnap) : null;

    let cost = 0;
    let market = 0;
    const holdings: StockSnapshotHolding[] = [];

    for (const [key, q] of queues.entries()) {
      if (q.length === 0) continue;
      const meta = metaByKey.get(key);
      if (!meta) continue;
      if (!securitiesAccountIds.has(meta.accountId)) continue;
      if (excludePension && pensionAccountIds.has(meta.accountId)) continue;

      const qty = q.reduce((s, lot) => s + lot.qty, 0);
      if (qty <= 0) continue;
      const totalNative = q.reduce((s, lot) => s + lot.totalAmount, 0);
      const avgPriceNative = qty > 0 ? totalNative / qty : 0;

      // 원가(KRW) — USD는 로트별 매입 당시 환율, 없으면 그 날짜의 유효 환율(박제 우선)
      const costKrw = meta.usd
        ? q.reduce((s, lot) => {
            const fx = lot.fxRateAtTrade && lot.fxRateAtTrade > 0 ? lot.fxRateAtTrade : effectiveFx;
            return s + lot.totalAmount * fx;
          }, 0)
        : totalNative;

      // 시세: 박제 우선 → 현재 → 없으면 원가와 동일 처리(손익 0)
      let priceNative: number | null = null;
      let priceSource: PriceSource = "none";
      if (snapshotPriceIndex) {
        const p = snapshotPriceIndex.get(meta.tickerNorm);
        if (p) {
          priceNative = p.price;
          priceSource = "snapshot";
        }
      }
      if (priceNative == null) {
        const p = currentPriceIndex.get(meta.tickerNorm);
        if (p) {
          priceNative = p.price;
          priceSource = "current";
        }
      }

      let marketKrw: number;
      if (priceNative == null) {
        marketKrw = costKrw;
      } else if (meta.usd) {
        marketKrw = effectiveFx > 0 ? priceNative * qty * effectiveFx : costKrw;
      } else {
        marketKrw = priceNative * qty;
      }

      cost += costKrw;
      market += marketKrw;
      holdings.push({
        ticker: meta.tickerNorm,
        name: meta.name,
        accountName: accountNameById.get(meta.accountId) ?? meta.accountId,
        quantity: qty,
        avgPriceNative,
        priceNative,
        priceSource,
        isUsd: meta.usd,
        costKrw,
        marketKrw,
      });
    }

    holdings.sort((a, b) => b.marketKrw - a.marketKrw);
    out.push({
      date: snapDate,
      cost,
      market,
      fxSource: savedSnap ? "snapshot" : "current",
      holdings,
    });
  }

  return out;
}
