import React, { Suspense, lazy, useMemo, useState } from "react";
import type { Account, MarketEnvSnapshot, StockPrice, StockTrade } from "../../types";
import {
  buildStockCostSnapshots,
  type StockSnapshotHolding,
  type StockSnapshotPoint,
} from "../../utils/stockCostSnapshots";
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
  /** 월 1일·15일 시세 환경 박제 — 과거 점을 그 날짜의 시세·환율로 고정 (TotalAssetTrendCard와 동일 소스) */
  marketEnvSnapshots?: MarketEnvSnapshot[];
}

function labelFor(dateStr: string): string {
  return dateStr.slice(2, 4) + "-" + dateStr.slice(5, 7) + "-" + dateStr.slice(8, 10);
}

// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
export const StockCostVsMarketCard: React.FC<Props> = React.memo(function StockCostVsMarketCard({
  today,
  accounts,
  trades,
  prices,
  fxRate,
  marketEnvSnapshots,
}) {
  // 연금계좌(isPension) — 묶이는 돈이라 '지금 굴리는 주식'만 보고 싶을 때 제외한다.
  const pensionAccountIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) if (a.isPension) set.add(a.id);
    return set;
  }, [accounts]);
  const [excludePension, setExcludePension] = useState(false);
  // 연금계좌에 실제 거래가 있을 때만 토글 노출 — 아무것도 안 바뀌는 버튼을 두지 않는다
  const hasPensionTrades = useMemo(
    () => pensionAccountIds.size > 0 && trades.some((t) => pensionAccountIds.has(t.accountId)),
    [pensionAccountIds, trades]
  );
  const pensionExcluded = excludePension && hasPensionTrades;

  // 계산은 순수 모듈(buildStockCostSnapshots) — 박제 시세·환율 우선, 과거 점 불변
  const points = useMemo<StockSnapshotPoint[]>(
    () =>
      buildStockCostSnapshots({
        trades,
        accounts,
        prices,
        marketEnvSnapshots,
        fxRate,
        today,
        excludePension: pensionExcluded,
      }),
    [trades, accounts, prices, marketEnvSnapshots, fxRate, today, pensionExcluded]
  );

  const rows = useMemo<CostVsMarketRow[]>(
    () => points.map((p) => ({ date: p.date, label: labelFor(p.date), cost: p.cost, market: p.market })),
    [points]
  );
  const pointByDate = useMemo(() => {
    const m = new Map<string, StockSnapshotPoint>();
    for (const p of points) m.set(p.date, p);
    return m;
  }, [points]);
  const pinnedCount = useMemo(() => points.filter((p) => p.fxSource === "snapshot").length, [points]);

  // 상세는 차트 점 클릭 시에만 표시. 자동으로 최신을 선택하지 않음.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const activePoint = selectedDate ? pointByDate.get(selectedDate) ?? null : null;

  const latest = points[points.length - 1];
  const unrealized = latest ? latest.market - latest.cost : 0;
  const unrealizedPct = latest && latest.cost > 0 ? (unrealized / latest.cost) * 100 : 0;
  const pnlColor = unrealized >= 0 ? "var(--danger)" : "var(--accent)"; // 이익=빨강, 손실=파랑 (국내 관례)

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
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              주식 매입액 vs 평가액 (월 1일·15일)
              {pensionExcluded && (
                <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 400 }}> (연금 제외)</span>
              )}
            </div>
            {hasPensionTrades && (
              <button
                type="button"
                onClick={() => setExcludePension((v) => !v)}
                aria-pressed={pensionExcluded}
                style={{
                  fontSize: 12,
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: `1px solid ${pensionExcluded ? "var(--primary)" : "var(--border)"}`,
                  background: pensionExcluded ? "var(--primary-light)" : "var(--surface)",
                  color: pensionExcluded ? "var(--primary)" : "var(--text)",
                  fontWeight: pensionExcluded ? 700 : 400,
                  cursor: "pointer",
                }}
                title="연금계좌(퇴직연금·연금저축) 보유분을 매입액·평가액에서 제외하고 봅니다"
              >
                연금 제외
              </button>
            )}
          </div>
          <div className="hint" style={{ fontSize: 13 }}>
            매월 1일·15일 진짜 스냅샷 · 그 날짜에 들고 있던 종목을 그 날짜의 박제 시세·환율로 평가
            (박제 없는 옛 날짜만 현재 시세 폴백) · 과거 점은 바뀌지 않습니다
            {pinnedCount > 0 && <span> · 박제 {pinnedCount}건</span>}
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
              activeDate={activePoint?.date ?? null}
              onPointClick={(d) => setSelectedDate(d)}
            />
          </Suspense>
        )}
      </div>
      {activePoint && activePoint.holdings.length > 0 && (
        <SnapshotDetail
          point={activePoint}
          isLatest={latest?.date === activePoint.date}
          onReset={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
});

interface SnapshotDetailProps {
  point: StockSnapshotPoint;
  isLatest: boolean;
  onReset: () => void;
}

const formatNativePrice = (value: number, isUsd: boolean): string => {
  const symbol = isUsd ? "$" : "₩";
  return symbol + value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const priceSourceLabel = (s: StockSnapshotHolding["priceSource"]): string =>
  s === "snapshot" ? "박제" : s === "current" ? "현재" : "없음";

const SnapshotDetail: React.FC<SnapshotDetailProps> = ({ point, isLatest, onReset }) => {
  const { holdings } = point;
  const pnl = point.market - point.cost;
  const pnlPct = point.cost > 0 ? (pnl / point.cost) * 100 : 0;
  const pnlColor = pnl >= 0 ? "var(--danger)" : "var(--accent)"; // 이익=빨강, 손실=파랑 (국내 관례)
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{point.date} 보유 종목</div>
          <div className="hint" style={{ fontSize: 12 }}>
            {holdings.length}종목 · 평가액은 {point.fxSource === "snapshot" ? "당시 박제 시세" : "현재 시세"} 기준
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ fontSize: 13 }}>
            <span className="hint">매입 </span>
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>{formatKRW(Math.round(point.cost))}</span>
            <span className="hint" style={{ marginLeft: 8 }}>평가 </span>
            <span style={{ color: "#2563eb", fontWeight: 700 }}>{formatKRW(Math.round(point.market))}</span>
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
              <th style={{ padding: "6px 8px" }}>시세</th>
              <th style={{ padding: "6px 8px" }}>매입액(원)</th>
              <th style={{ padding: "6px 8px" }}>평가액(원)</th>
              <th style={{ padding: "6px 8px" }}>손익</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const hPnl = h.marketKrw - h.costKrw;
              const hPct = h.costKrw > 0 ? (hPnl / h.costKrw) * 100 : 0;
              const hColor = hPnl >= 0 ? "var(--danger)" : "var(--accent)"; // 이익=빨강, 손실=파랑
              const priceChangePct =
                h.priceNative != null && h.avgPriceNative > 0
                  ? ((h.priceNative - h.avgPriceNative) / h.avgPriceNative) * 100
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
                    {h.priceNative == null ? (
                      <span className="hint">-</span>
                    ) : (
                      <>
                        {formatNativePrice(h.priceNative, h.isUsd)}
                        <span className="hint" style={{ marginLeft: 4, fontSize: 11 }}>({priceSourceLabel(h.priceSource)})</span>
                        {priceChangePct != null && (
                          <span
                            style={{
                              marginLeft: 4,
                              fontSize: 11,
                              color: priceChangePct >= 0 ? "var(--danger)" : "var(--accent)", // 상승=빨강, 하락=파랑
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
        {holdings.some((h) => h.priceNative == null) && (
          <div className="hint" style={{ fontSize: 11, marginTop: 6 }}>시세가 없는 종목은 평가액을 원가와 동일 처리 (손익 0)</div>
        )}
      </div>
    </div>
  );
};
