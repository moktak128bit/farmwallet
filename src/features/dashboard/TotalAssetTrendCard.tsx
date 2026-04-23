import React, { Suspense, lazy, useMemo, useState } from "react";
import type { Account, AccountType, LedgerEntry, MarketEnvSnapshot, StockPrice, StockTrade } from "../../types";
import { computeAccountBalances } from "../../calculations";
import { buildHalfMonthSnapshotDates } from "../../utils/date";
import { canonicalTickerForMatch, isUSDStock } from "../../utils/finance";
import { formatKRW } from "../../utils/formatter";
import type { TotalAssetRow } from "./DashboardInlineCharts";

const LazyTotalAssetValueChart = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.TotalAssetValueChart }))
);

interface Props {
  today: string;
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  fxRate: number | null;
  marketEnvSnapshots?: MarketEnvSnapshot[];
}

interface HoldingDetail {
  ticker: string;
  name: string;
  accountName: string;
  quantity: number;
  avgPriceNative: number;
  priceNative: number | null;
  priceSource: "snapshot" | "current" | "none";
  isUsd: boolean;
  costKrw: number;
  marketKrw: number;
}

interface PerAccountRow {
  accountId: string;
  accountName: string;
  type: AccountType;
  cashKrw: number;
  costKrw: number;   // securities/crypto only; 0 otherwise
  marketKrw: number; // securities/crypto only; 0 otherwise
}

interface SnapshotDetailData {
  cashKrw: number;
  costKrw: number;
  marketKrw: number;
  fxRateUsed: number;
  fxRateSource: "snapshot" | "current";
  holdings: HoldingDetail[];
  perAccount: PerAccountRow[];
}

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "입출금",
  savings: "저축",
  card: "카드",
  securities: "증권",
  crypto: "코인",
  other: "기타",
};

function labelFor(dateStr: string): string {
  return dateStr.slice(2, 4) + "-" + dateStr.slice(5, 7) + "-" + dateStr.slice(8, 10);
}

function buildCurrentPriceIndex(prices: StockPrice[]): Map<string, { price: number; currency?: string }> {
  const latest = new Map<string, { price: number; currency?: string; updatedAt?: string }>();
  for (const p of prices) {
    const key = canonicalTickerForMatch(p.ticker) ?? p.ticker.toUpperCase();
    if (!key) continue;
    if (typeof p.price !== "number" || !Number.isFinite(p.price)) continue;
    const prev = latest.get(key);
    if (!prev || (p.updatedAt ?? "") >= (prev.updatedAt ?? "")) {
      latest.set(key, { price: p.price, currency: p.currency, updatedAt: p.updatedAt });
    }
  }
  const out = new Map<string, { price: number; currency?: string }>();
  latest.forEach((v, k) => out.set(k, { price: v.price, currency: v.currency }));
  return out;
}

function buildSnapshotPriceIndex(
  snap: MarketEnvSnapshot,
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

export const TotalAssetTrendCard: React.FC<Props> = ({
  today,
  accounts,
  ledger,
  trades,
  prices,
  fxRate,
  marketEnvSnapshots,
}) => {
  const cashAccountIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) {
      if (a.type !== "card") set.add(a.id);
    }
    return set;
  }, [accounts]);

  const securitiesAccountIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) {
      if (a.type === "securities" || a.type === "crypto") set.add(a.id);
    }
    return set;
  }, [accounts]);

  const accountNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name ?? a.id);
    return m;
  }, [accounts]);

  const currentPriceIndex = useMemo(() => buildCurrentPriceIndex(prices), [prices]);

  const snapByDate = useMemo(() => {
    const m = new Map<string, MarketEnvSnapshot>();
    for (const s of marketEnvSnapshots ?? []) m.set(s.date, s);
    return m;
  }, [marketEnvSnapshots]);

  const { rows, detailByDate } = useMemo(() => {
    const empty = { rows: [] as TotalAssetRow[], detailByDate: new Map<string, SnapshotDetailData>() };

    // 첫 거래 또는 첫 ledger 항목 이후부터 스냅샷 생성
    const firstTradeDate = trades.length > 0
      ? [...trades].sort((a, b) => a.date.localeCompare(b.date))[0].date.slice(0, 10)
      : "";
    const firstLedgerDate = ledger.length > 0
      ? [...ledger].sort((a, b) => a.date.localeCompare(b.date))[0].date.slice(0, 10)
      : "";
    const candidates = [firstTradeDate, firstLedgerDate].filter(Boolean);
    if (candidates.length === 0) return empty;
    const firstDate = candidates.sort()[0];

    const dates = buildHalfMonthSnapshotDates(firstDate, today);
    if (dates.length === 0) dates.push(today);

    type Lot = { qty: number; totalAmount: number; fxRateAtTrade?: number };
    type GroupMeta = { accountId: string; tickerNorm: string; name: string; usd: boolean };
    const queues = new Map<string, Lot[]>();
    const metaByKey = new Map<string, GroupMeta>();

    const sortedTrades = [...trades]
      .filter((t) => !!t.date && !!t.ticker)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        if (a.side === "buy" && b.side === "sell") return -1;
        if (a.side === "sell" && b.side === "buy") return 1;
        return a.id.localeCompare(b.id);
      });

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

    const outRows: TotalAssetRow[] = [];
    const outDetail = new Map<string, SnapshotDetailData>();

    for (const snapDate of dates) {
      applyTradesThrough(snapDate);

      const savedSnap = snapByDate.get(snapDate);
      const effectiveFx = savedSnap?.fxRate ?? (fxRate ?? 0);
      const fxRateSource: "snapshot" | "current" = savedSnap ? "snapshot" : "current";
      const snapshotPriceIndex = savedSnap ? buildSnapshotPriceIndex(savedSnap) : null;

      // 1) 현금 합계 (KRW) — 해당 날짜까지 반영 · 계좌별로도 기록
      // 잔액 계산에는 ticker 필터를 안 건 원본 trades를 써야 cashImpact가 모두 반영됨.
      const filteredLedger = ledger.filter((l) => l.date && l.date <= snapDate);
      const filteredTradesForBalance = trades.filter((t) => !!t.date && t.date.slice(0, 10) <= snapDate);
      const balances = computeAccountBalances(accounts, filteredLedger, filteredTradesForBalance);
      let cashKrw = 0;
      const cashByAccount = new Map<string, number>();
      for (const row of balances) {
        if (!cashAccountIds.has(row.account.id)) continue;
        let accCash = row.currentBalance;
        const usd =
          row.account.type === "securities" || row.account.type === "crypto"
            ? (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0)
            : 0;
        if (usd && effectiveFx > 0) accCash += usd * effectiveFx;
        cashByAccount.set(row.account.id, accCash);
        cashKrw += accCash;
      }

      // 2) 주식 원가·평가액 (FIFO 적용된 queues 사용) · 계좌별 합계도 함께
      let stockCostKrw = 0;
      let stockMarketKrw = 0;
      const holdings: HoldingDetail[] = [];
      const costByAccount = new Map<string, number>();
      const marketByAccount = new Map<string, number>();

      for (const [key, q] of queues.entries()) {
        if (q.length === 0) continue;
        const meta = metaByKey.get(key);
        if (!meta) continue;
        if (!securitiesAccountIds.has(meta.accountId)) continue;

        const qty = q.reduce((s, lot) => s + lot.qty, 0);
        if (qty <= 0) continue;
        const totalNative = q.reduce((s, lot) => s + lot.totalAmount, 0);
        const avgPriceNative = qty > 0 ? totalNative / qty : 0;

        const costKrw = meta.usd
          ? q.reduce((s, lot) => {
              const fx = lot.fxRateAtTrade && lot.fxRateAtTrade > 0 ? lot.fxRateAtTrade : effectiveFx;
              return s + lot.totalAmount * fx;
            }, 0)
          : totalNative;

        // 시세: 스냅샷 우선 → 없으면 현재 시세 → 없으면 원가와 동일 처리
        let priceNative: number | null = null;
        let priceSource: HoldingDetail["priceSource"] = "none";
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
          marketKrw = effectiveFx > 0 ? priceNative * qty * effectiveFx : 0;
        } else {
          marketKrw = priceNative * qty;
        }

        stockCostKrw += costKrw;
        stockMarketKrw += marketKrw;
        costByAccount.set(meta.accountId, (costByAccount.get(meta.accountId) ?? 0) + costKrw);
        marketByAccount.set(meta.accountId, (marketByAccount.get(meta.accountId) ?? 0) + marketKrw);
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

      const perAccount: PerAccountRow[] = [];
      for (const account of accounts) {
        if (!cashAccountIds.has(account.id)) continue;
        const accCash = cashByAccount.get(account.id) ?? 0;
        const accCost = costByAccount.get(account.id) ?? 0;
        const accMarket = marketByAccount.get(account.id) ?? 0;
        if (accCash === 0 && accCost === 0 && accMarket === 0) continue;
        perAccount.push({
          accountId: account.id,
          accountName: account.name,
          type: account.type,
          cashKrw: accCash,
          costKrw: accCost,
          marketKrw: accMarket,
        });
      }
      perAccount.sort(
        (a, b) => (b.cashKrw + b.marketKrw) - (a.cashKrw + a.marketKrw),
      );

      outDetail.set(snapDate, {
        cashKrw,
        costKrw: stockCostKrw,
        marketKrw: stockMarketKrw,
        fxRateUsed: effectiveFx,
        fxRateSource,
        holdings,
        perAccount,
      });
      outRows.push({
        date: snapDate,
        label: labelFor(snapDate),
        cashPlusCost: cashKrw + stockCostKrw,
        cashPlusMarket: cashKrw + stockMarketKrw,
      });
    }

    return { rows: outRows, detailByDate: outDetail };
  }, [
    today,
    accounts,
    ledger,
    trades,
    fxRate,
    cashAccountIds,
    securitiesAccountIds,
    accountNameById,
    currentPriceIndex,
    snapByDate,
  ]);

  // 상세는 차트 점 클릭 시에만 표시. 자동으로 최신을 선택하지 않음.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const activeDate = selectedDate && detailByDate.has(selectedDate) ? selectedDate : null;
  const activeRow = activeDate ? rows.find((r) => r.date === activeDate) : undefined;
  const activeDetail = activeDate ? detailByDate.get(activeDate) : undefined;

  const latest = rows[rows.length - 1];
  const unrealized = latest ? latest.cashPlusMarket - latest.cashPlusCost : 0;
  const unrealizedPct = latest && latest.cashPlusCost > 0 ? (unrealized / latest.cashPlusCost) * 100 : 0;
  const pnlColor = unrealized >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)";

  const savedCount = marketEnvSnapshots?.length ?? 0;

  return (
    <div className="card" style={{ minHeight: 360, marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>총자산 추이 (현금 + 주식 원가 vs 현금 + 평가액)</div>
          <div className="hint" style={{ fontSize: 13 }}>
            매월 1일·15일 · 현금 = 계좌별 잔액 합계 · 평가액 = 박제 시세 우선(없으면 현재가) · <strong>부채 미차감</strong>
            {savedCount > 0 && <span> · 박제 {savedCount}건</span>}
          </div>
        </div>
        {latest && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ textAlign: "right" }}>
              <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>현금+원가</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>
                {formatKRW(Math.round(latest.cashPlusCost))}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>현금+평가액</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb" }}>
                {formatKRW(Math.round(latest.cashPlusMarket))}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>평가손익</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: pnlColor }}>
                {unrealized >= 0 ? "+" : ""}
                {formatKRW(Math.round(unrealized))}
                <span style={{ fontSize: 13, marginLeft: 6 }}>
                  ({unrealized >= 0 ? "+" : ""}
                  {unrealizedPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ width: "100%", height: 300 }}>
        {rows.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
            거래 내역이 없습니다.
          </div>
        ) : (
          <Suspense fallback={<div style={{ height: 300 }} />}>
            <LazyTotalAssetValueChart
              rows={rows}
              activeDate={activeDate}
              onPointClick={(d) => setSelectedDate(d)}
            />
          </Suspense>
        )}
      </div>
      {activeRow && activeDetail && (
        <SnapshotDetail
          row={activeRow}
          detail={activeDetail}
          isLatest={latest?.date === activeRow.date}
          onReset={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
};

interface SnapshotDetailProps {
  row: TotalAssetRow;
  detail: SnapshotDetailData;
  isLatest: boolean;
  onReset: () => void;
}

const formatNativePrice = (value: number, isUsd: boolean): string => {
  const symbol = isUsd ? "$" : "₩";
  return symbol + value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const SnapshotDetail: React.FC<SnapshotDetailProps> = ({ row, detail, isLatest, onReset }) => {
  const pnl = row.cashPlusMarket - row.cashPlusCost;
  const pnlPct = row.cashPlusCost > 0 ? (pnl / row.cashPlusCost) * 100 : 0;
  const pnlColor = pnl >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)";
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{row.date} 스냅샷</div>
          <div className="hint" style={{ fontSize: 12 }}>
            보유 {detail.holdings.length}종목 · 환율 {detail.fxRateUsed > 0 ? detail.fxRateUsed.toLocaleString() : "-"}
            {" "}({detail.fxRateSource === "snapshot" ? "박제" : "현재"})
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13 }}>
            <span className="hint">현금 </span>
            <span style={{ fontWeight: 700 }}>{formatKRW(Math.round(detail.cashKrw))}</span>
            <span className="hint" style={{ marginLeft: 8 }}>원가 </span>
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>{formatKRW(Math.round(detail.costKrw))}</span>
            <span className="hint" style={{ marginLeft: 8 }}>평가 </span>
            <span style={{ color: "#2563eb", fontWeight: 700 }}>{formatKRW(Math.round(detail.marketKrw))}</span>
            <span style={{ marginLeft: 8, color: pnlColor, fontWeight: 700 }}>
              ({pnl >= 0 ? "+" : ""}{formatKRW(Math.round(pnl))} · {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
            </span>
          </div>
          {!isLatest && (
            <button
              type="button"
              onClick={onReset}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}
            >
              최신으로
            </button>
          )}
        </div>
      </div>
      {detail.perAccount.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--text-muted)" }}>계좌별 내역</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "right", fontWeight: 600 }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>계좌</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>유형</th>
                <th style={{ padding: "6px 8px" }}>현금(원)</th>
                <th style={{ padding: "6px 8px" }}>원금(원)</th>
                <th style={{ padding: "6px 8px" }}>평가(원)</th>
                <th style={{ padding: "6px 8px" }}>손익</th>
                <th style={{ padding: "6px 8px" }}>합계(현금+평가)</th>
              </tr>
            </thead>
            <tbody>
              {detail.perAccount.map((a) => {
                const isInvest = a.type === "securities" || a.type === "crypto";
                const aPnl = a.marketKrw - a.costKrw;
                const aPct = a.costKrw > 0 ? (aPnl / a.costKrw) * 100 : 0;
                const aColor = aPnl >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)";
                return (
                  <tr key={a.accountId} style={{ borderTop: "1px solid var(--border)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>{a.accountName}</td>
                    <td style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-muted)" }}>{ACCOUNT_TYPE_LABEL[a.type] ?? a.type}</td>
                    <td style={{ padding: "6px 8px" }}>{formatKRW(Math.round(a.cashKrw))}</td>
                    <td style={{ padding: "6px 8px", color: isInvest ? "#f59e0b" : "var(--text-muted)" }}>
                      {isInvest ? formatKRW(Math.round(a.costKrw)) : "-"}
                    </td>
                    <td style={{ padding: "6px 8px", color: isInvest ? "#2563eb" : "var(--text-muted)" }}>
                      {isInvest ? formatKRW(Math.round(a.marketKrw)) : "-"}
                    </td>
                    <td style={{ padding: "6px 8px", color: isInvest ? aColor : "var(--text-muted)", fontWeight: isInvest ? 600 : 400 }}>
                      {isInvest
                        ? `${aPnl >= 0 ? "+" : ""}${formatKRW(Math.round(aPnl))}${a.costKrw > 0 ? ` (${aPnl >= 0 ? "+" : ""}${aPct.toFixed(1)}%)` : ""}`
                        : "-"}
                    </td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>
                      {formatKRW(Math.round(a.cashKrw + a.marketKrw))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {detail.holdings.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--text-muted)" }}>종목별 내역</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "right", fontWeight: 600 }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>종목</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>계좌</th>
                <th style={{ padding: "6px 8px" }}>수량</th>
                <th style={{ padding: "6px 8px" }}>평단가</th>
                <th style={{ padding: "6px 8px" }}>시세</th>
                <th style={{ padding: "6px 8px" }}>원가(원)</th>
                <th style={{ padding: "6px 8px" }}>평가(원)</th>
                <th style={{ padding: "6px 8px" }}>손익</th>
              </tr>
            </thead>
            <tbody>
              {detail.holdings.map((h) => {
                const hPnl = h.marketKrw - h.costKrw;
                const hPct = h.costKrw > 0 ? (hPnl / h.costKrw) * 100 : 0;
                const hColor = hPnl >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)";
                const sourceLabel =
                  h.priceSource === "snapshot" ? "박제" : h.priceSource === "current" ? "현재" : "없음";
                return (
                  <tr key={`${h.ticker}-${h.accountName}`} style={{ borderTop: "1px solid var(--border)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>
                      {h.ticker}
                      <span className="hint" style={{ marginLeft: 6, fontWeight: 400 }}>{h.name}</span>
                    </td>
                    <td style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-muted)" }}>{h.accountName}</td>
                    <td style={{ padding: "6px 8px" }}>{h.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td style={{ padding: "6px 8px" }}>{formatNativePrice(h.avgPriceNative, h.isUsd)}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {h.priceNative == null ? (
                        <span className="hint">-</span>
                      ) : (
                        <>
                          {formatNativePrice(h.priceNative, h.isUsd)}
                          <span className="hint" style={{ marginLeft: 4, fontSize: 11 }}>({sourceLabel})</span>
                        </>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{formatKRW(Math.round(h.costKrw))}</td>
                    <td style={{ padding: "6px 8px" }}>{formatKRW(Math.round(h.marketKrw))}</td>
                    <td style={{ padding: "6px 8px", color: hColor, fontWeight: 600 }}>
                      {hPnl >= 0 ? "+" : ""}{formatKRW(Math.round(hPnl))}
                      <span style={{ marginLeft: 4, fontSize: 12 }}>({hPnl >= 0 ? "+" : ""}{hPct.toFixed(1)}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
