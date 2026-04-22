import React, { Suspense, lazy, useMemo, useState } from "react";
import type { Account, StockPrice, StockTrade } from "../../types";
import { buildHalfMonthSnapshotDates } from "../../utils/date";
import { canonicalTickerForMatch, isUSDStock } from "../../utils/finance";
import { formatKRW } from "../../utils/formatter";
import type { CostVsMarketRow } from "./DashboardInlineCharts";

const LazyCostVsMarketValueChart = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.CostVsMarketValueChart }))
);

interface Props {
  today: string;
  accounts: Account[];
  trades: StockTrade[];
  prices: StockPrice[];
  fxRate: number | null;
}

interface HoldingDetail {
  ticker: string;
  name: string;
  accountName: string;
  quantity: number;
  avgPriceNative: number; // 매입 평단가 (USD 종목=USD, KRW 종목=KRW)
  currentPriceNative: number | null; // 현재 시세 (USD 또는 KRW, 없으면 null)
  isUsd: boolean;
  costKrw: number;
  marketKrw: number;
}

function labelFor(dateStr: string): string {
  return dateStr.slice(2, 4) + "-" + dateStr.slice(5, 7) + "-" + dateStr.slice(8, 10);
}

function buildPriceIndex(prices: StockPrice[]): Map<string, { price: number; currency?: string }> {
  const map = new Map<string, { price: number; currency?: string; updatedAt?: string }>();
  for (const p of prices) {
    const key = canonicalTickerForMatch(p.ticker) ?? p.ticker.toUpperCase();
    if (!key) continue;
    if (typeof p.price !== "number" || !Number.isFinite(p.price)) continue;
    const prev = map.get(key);
    if (!prev || (p.updatedAt ?? "") >= (prev.updatedAt ?? "")) {
      map.set(key, { price: p.price, currency: p.currency, updatedAt: p.updatedAt });
    }
  }
  const out = new Map<string, { price: number; currency?: string }>();
  map.forEach((v, k) => out.set(k, { price: v.price, currency: v.currency }));
  return out;
}

export const StockCostVsMarketCard: React.FC<Props> = ({
  today,
  accounts,
  trades,
  prices,
  fxRate,
}) => {
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

  const priceIndex = useMemo(() => buildPriceIndex(prices), [prices]);

  const { rows, holdingsByDate } = useMemo(() => {
    const emptyResult = { rows: [] as CostVsMarketRow[], holdingsByDate: new Map<string, HoldingDetail[]>() };
    if (securitiesAccountIds.size === 0) return emptyResult;

    const sortedTrades = [...trades]
      .filter((t) => !!t.date && !!t.ticker)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        if (a.side === "buy" && b.side === "sell") return -1;
        if (a.side === "sell" && b.side === "buy") return 1;
        return a.id.localeCompare(b.id);
      });

    if (sortedTrades.length === 0) return emptyResult;
    const firstTradeDate = sortedTrades[0].date.slice(0, 10);
    const dates = buildHalfMonthSnapshotDates(firstTradeDate, today);
    if (dates.length === 0) dates.push(today);

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

    const out: CostVsMarketRow[] = [];
    const byDate = new Map<string, HoldingDetail[]>();

    for (const snapDate of dates) {
      applyTradesThrough(snapDate);

      let cost = 0;
      let market = 0;
      const holdings: HoldingDetail[] = [];

      for (const [key, q] of queues.entries()) {
        if (q.length === 0) continue;
        const meta = metaByKey.get(key);
        if (!meta) continue;
        if (!securitiesAccountIds.has(meta.accountId)) continue;

        const qty = q.reduce((s, lot) => s + lot.qty, 0);
        if (qty <= 0) continue;
        const totalNative = q.reduce((s, lot) => s + lot.totalAmount, 0);
        const avgPriceNative = qty > 0 ? totalNative / qty : 0;

        // 원가(KRW) — USD는 로트별 매입 당시 환율(없으면 현재 환율), KRW는 그대로
        const costKrw = meta.usd
          ? q.reduce((s, lot) => {
              const fx = lot.fxRateAtTrade && lot.fxRateAtTrade > 0 ? lot.fxRateAtTrade : (fxRate ?? 0);
              return s + lot.totalAmount * fx;
            }, 0)
          : totalNative;

        // 현재 시세 (USD/KRW 원통화) 조회
        const priceInfo = priceIndex.get(meta.tickerNorm);
        const currentPriceNative = priceInfo ? priceInfo.price : null;

        // 평가액(KRW) — 현재가 × 수량, 통화 환산 적용. 시세 없으면 원가와 동일 처리(손익 0)
        let marketKrw: number;
        if (currentPriceNative == null) {
          marketKrw = costKrw;
        } else if (meta.usd) {
          marketKrw = fxRate ? currentPriceNative * qty * fxRate : 0;
        } else {
          marketKrw = currentPriceNative * qty;
        }

        cost += costKrw;
        market += marketKrw;
        holdings.push({
          ticker: meta.tickerNorm,
          name: meta.name,
          accountName: accountNameById.get(meta.accountId) ?? meta.accountId,
          quantity: qty,
          avgPriceNative,
          currentPriceNative,
          isUsd: meta.usd,
          costKrw,
          marketKrw,
        });
      }

      holdings.sort((a, b) => b.marketKrw - a.marketKrw);
      byDate.set(snapDate, holdings);
      out.push({ date: snapDate, label: labelFor(snapDate), cost, market });
    }

    return { rows: out, holdingsByDate: byDate };
  }, [today, trades, fxRate, securitiesAccountIds, accountNameById, priceIndex]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const activeDate = selectedDate && holdingsByDate.has(selectedDate)
    ? selectedDate
    : rows.length > 0 ? rows[rows.length - 1].date : null;
  const activeRow = activeDate ? rows.find((r) => r.date === activeDate) : undefined;
  const activeHoldings = activeDate ? holdingsByDate.get(activeDate) ?? [] : [];

  const latest = rows[rows.length - 1];
  const unrealized = latest ? latest.market - latest.cost : 0;
  const unrealizedPct = latest && latest.cost > 0 ? (unrealized / latest.cost) * 100 : 0;
  const pnlColor = unrealized >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)";

  return (
    <div className="card" style={{ minHeight: 360 }}>
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
          <div className="card-title" style={{ marginBottom: 4 }}>주식 매입액 vs 평가액 (월 1일·15일)</div>
          <div className="hint" style={{ fontSize: 13 }}>
            매월 1일·15일 스냅샷 · 매입액 = 그 시점 보유 종목의 원가 · 평가액 = 그 보유 종목을 현재 시세로 환산
          </div>
        </div>
        {latest && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
            <div style={{ textAlign: "right" }}>
              <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>매입액</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>
                {formatKRW(Math.round(latest.cost))}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>평가액</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb" }}>
                {formatKRW(Math.round(latest.market))}
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
            증권 계좌 거래 내역이 없습니다.
          </div>
        ) : (
          <Suspense fallback={<div style={{ height: 300 }} />}>
            <LazyCostVsMarketValueChart
              rows={rows}
              activeDate={activeDate}
              onPointClick={(d) => setSelectedDate(d)}
            />
          </Suspense>
        )}
      </div>
      {activeRow && activeHoldings.length > 0 && (
        <SnapshotDetail
          row={activeRow}
          holdings={activeHoldings}
          isLatest={latest?.date === activeRow.date}
          onReset={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
};

interface SnapshotDetailProps {
  row: CostVsMarketRow;
  holdings: HoldingDetail[];
  isLatest: boolean;
  onReset: () => void;
}

const formatNativePrice = (value: number, isUsd: boolean): string => {
  const symbol = isUsd ? "$" : "₩";
  return symbol + value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const SnapshotDetail: React.FC<SnapshotDetailProps> = ({ row, holdings, isLatest, onReset }) => {
  const pnl = row.market - row.cost;
  const pnlPct = row.cost > 0 ? (pnl / row.cost) * 100 : 0;
  const pnlColor = pnl >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)";
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{row.date} 보유 종목</div>
          <div className="hint" style={{ fontSize: 12 }}>{holdings.length}종목 · 평가액은 현재 시세 기준</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ fontSize: 13 }}>
            <span className="hint">매입 </span>
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>{formatKRW(Math.round(row.cost))}</span>
            <span className="hint" style={{ marginLeft: 8 }}>평가 </span>
            <span style={{ color: "#2563eb", fontWeight: 700 }}>{formatKRW(Math.round(row.market))}</span>
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
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "right", fontWeight: 600 }}>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>종목</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>계좌</th>
              <th style={{ padding: "6px 8px" }}>수량</th>
              <th style={{ padding: "6px 8px" }}>평단가</th>
              <th style={{ padding: "6px 8px" }}>현재가</th>
              <th style={{ padding: "6px 8px" }}>매입액(원)</th>
              <th style={{ padding: "6px 8px" }}>평가액(원)</th>
              <th style={{ padding: "6px 8px" }}>손익</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const hPnl = h.marketKrw - h.costKrw;
              const hPct = h.costKrw > 0 ? (hPnl / h.costKrw) * 100 : 0;
              const hColor = hPnl >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)";
              const priceChangePct =
                h.currentPriceNative != null && h.avgPriceNative > 0
                  ? ((h.currentPriceNative - h.avgPriceNative) / h.avgPriceNative) * 100
                  : null;
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
                    {h.currentPriceNative == null ? (
                      <span className="hint">-</span>
                    ) : (
                      <>
                        {formatNativePrice(h.currentPriceNative, h.isUsd)}
                        {priceChangePct != null && (
                          <span
                            style={{
                              marginLeft: 4,
                              fontSize: 11,
                              color: priceChangePct >= 0 ? "var(--success, #059669)" : "var(--danger, #dc2626)",
                            }}
                          >
                            ({priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(1)}%)
                          </span>
                        )}
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
        {holdings.some((h) => h.currentPriceNative == null) && (
          <div className="hint" style={{ fontSize: 11, marginTop: 6 }}>현재 시세가 없는 종목은 평가액을 원가와 동일 처리 (손익 0)</div>
        )}
      </div>
    </div>
  );
};
