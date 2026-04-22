import React, { Suspense, lazy } from "react";
import { formatKRW } from "../../utils/formatter";

const LazyDividendTrendChart = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.DividendTrendChart }))
);

export interface DividendTrendRow {
  month: string;
  shares: number;
  dividend: number;
  costBasis: number;
  yieldRate: number | null;
}

export interface DividendTrendData {
  ticker: string;
  rows: DividendTrendRow[];
  latest: DividendTrendRow | null;
  previous: DividendTrendRow | null;
  shareChange: number;
  shareChangeRate: number | null;
  dividendChange: number;
  changeRate: number | null;
  yieldChangeRate: number | null;
  yieldSumLast12Months: number | null;
}

interface Props {
  title: string;
  trend: DividendTrendData;
}

export const DividendTrendCard: React.FC<Props> = ({ title, trend }) => {
  return (
    <div className="card" style={{ minHeight: 320 }}>
      <div className="card-title" style={{ marginBottom: 12 }}>{title}</div>
      <div
        className="dashboard-two-col"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 280px) 1fr",
          gap: 20,
          alignItems: "stretch"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
          <div
            className={`card-value ${trend.changeRate == null ? "" : trend.changeRate >= 0 ? "positive" : "negative"}`}
            style={{ marginBottom: 0 }}
          >
            {trend.changeRate == null
              ? "-"
              : `${trend.changeRate >= 0 ? "+" : ""}${trend.changeRate.toFixed(1)}%`}
          </div>
          <div className="hint" style={{ marginTop: 0 }}>
            {trend.latest && trend.previous
              ? `${trend.previous.month} ${formatKRW(Math.round(trend.previous.dividend))} → ${trend.latest.month} ${formatKRW(Math.round(trend.latest.dividend))}`
              : `${trend.ticker} 배당 데이터가 없습니다.`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 15 }}>
            <div className={trend.shareChange >= 0 ? "positive" : "negative"}>
              주식수 {trend.shareChange >= 0 ? "+" : ""}{trend.shareChange.toLocaleString()}
              {trend.shareChangeRate == null ? "" : ` (${trend.shareChangeRate >= 0 ? "+" : ""}${trend.shareChangeRate.toFixed(1)}%)`}
            </div>
            <div className={trend.dividendChange >= 0 ? "positive" : "negative"}>
              배당 {trend.dividendChange >= 0 ? "+" : ""}{formatKRW(Math.round(trend.dividendChange))}
            </div>
            <div className={trend.yieldChangeRate != null && trend.yieldChangeRate >= 0 ? "positive" : "negative"}>
              배당율 변화 {trend.yieldChangeRate == null ? "-" : `${trend.yieldChangeRate >= 0 ? "+" : ""}${trend.yieldChangeRate.toFixed(1)}%`}
            </div>
            <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 15, fontWeight: 600 }}>
              최근 12개월간 총 배당율 {trend.yieldSumLast12Months == null ? "-" : `${trend.yieldSumLast12Months.toFixed(2)}%`}
            </div>
            {trend.latest && trend.latest.shares > 0 && (
              <div className="hint" style={{ marginTop: 8, padding: 10, background: "var(--surface)", borderRadius: 8, fontSize: 14 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{trend.latest.month} 산식</div>
                <div>평단가 {formatKRW(Math.round(trend.latest.costBasis / trend.latest.shares))}</div>
                <div>주당 배당금 {formatKRW(Math.round(trend.latest.dividend / trend.latest.shares))}</div>
                <div>매입금액 {formatKRW(Math.round(trend.latest.costBasis))} → 배당률 {trend.latest.yieldRate != null ? `${trend.latest.yieldRate.toFixed(2)}%` : "-"}</div>
              </div>
            )}
          </div>
        </div>
        <div style={{ minHeight: 260 }}>
          <Suspense fallback={<div style={{ height: 260 }} />}>
            <LazyDividendTrendChart rows={trend.rows} />
          </Suspense>
        </div>
      </div>
    </div>
  );
};
